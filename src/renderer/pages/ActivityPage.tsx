import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { ChevronDown, ChevronUp, Download, LogIn, LogOut, Ticket } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateTime, formatVND, todayLocal } from '../lib/format';
import { useAuth } from '../store/auth';
import { ActivityPerf } from './ActivityPerf';
import type { ActivityAction, ActivityRow, PaymentMethod, UserDTO } from '../types';

type Status = 'loading' | 'error' | 'ready';
type Range = 'today' | '7d' | '30d' | 'custom';
type SortDir = 'asc' | 'desc';

let toastSeq = 400;

const ACTION_META: Record<ActivityAction, { label: string; tone: 'primary' | 'success' | 'secondary'; Icon: typeof LogIn }> = {
  check_in: { label: 'Check-in', tone: 'primary', Icon: LogIn },
  check_out: { label: 'Check-out', tone: 'success', Icon: LogOut },
  pass_sale: { label: 'Bán vé tháng', tone: 'secondary', Icon: Ticket },
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  card: 'Thẻ',
  e_wallet: 'Ví điện tử',
};

function shiftDate(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isForbiddenError(err: string): boolean {
  return /FORBIDDEN/i.test(err);
}

function escXls(v: string): string {
  return v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function ActivityPage(): JSX.Element {
  const { role, userId, logout } = useAuth();
  const isStaff = role === 'staff';

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [staffUsers, setStaffUsers] = useState<UserDTO[]>([]);
  const [staffFilter, setStaffFilter] = useState<'all' | number>('all');
  const [range, setRange] = useState<Range>('7d');
  const [from, setFrom] = useState(shiftDate(todayLocal(), -6));
  const [to, setTo] = useState(todayLocal());
  const [actionFilter, setActionFilter] = useState<'all' | ActivityAction>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'detail' | 'perf'>('detail');
  const [perPage, setPerPage] = useState<20 | 50 | 100>(20);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportMsg, setExportMsg] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Debounce search 400ms — filter change reloads table only (toolbar stays).
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  const applyRange = useCallback((r: Range) => {
    setRange(r);
    const today = todayLocal();
    if (r === 'today') {
      setFrom(today);
      setTo(today);
    } else if (r === '7d') {
      setFrom(shiftDate(today, -6));
      setTo(today);
    } else if (r === '30d') {
      setFrom(shiftDate(today, -29));
      setTo(today);
    }
  }, []);

  // Admin-only staff list for the employee filter (staff never calls this —
  // their view is forced mine_only, filter not rendered).
  useEffect(() => {
    if (role !== 'admin') return;
    let cancelled = false;
    void callApi((a) => a.listUsers(), () => mockApi.listUsers()).then((res) => {
      if (!cancelled && res.ok && res.data) setStaffUsers(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const load = useCallback(async () => {
    if (role !== 'admin' && role !== 'staff') return;
    setStatus('loading');
    setForbidden(false);
    const input = {
      // §1: staff ép staff_id = me.id mọi request (backend enforce thêm).
      staff_id: isStaff ? (userId ?? -1) : staffFilter === 'all' ? undefined : staffFilter,
      from: from || undefined,
      to: to || undefined,
      action: actionFilter === 'all' ? undefined : actionFilter,
      search: debounced || undefined,
      limit: perPage,
      offset: (page - 1) * perPage,
    };
    const res = await callApi((a) => a.listActivity(input), () => mockApi.listActivity(input));
    if (!res.ok || !res.data) {
      const msg = res.error ?? 'Lỗi tải nhật ký hoạt động';
      if (isForbiddenError(msg)) {
        setForbidden(true);
        setError(msg);
        setStatus('error');
        return;
      }
      setError(msg);
      setStatus('error');
      return;
    }
    setRows(res.data.rows);
    setTotal(res.data.total);
    setStatus('ready');
  }, [role, isStaff, userId, staffFilter, from, to, actionFilter, debounced, perPage, page]);

  useEffect(() => {
    if (tab !== 'detail') return;
    void load();
  }, [load, tab]);

  // Reset to page 1 whenever filters change (not on page/perPage nav itself).
  useEffect(() => {
    setPage(1);
  }, [staffFilter, from, to, actionFilter, debounced]);

  // Backend has no sort param — contract fixes ORDER BY at DESC. ASC toggle
  // re-sorts the loaded page client-side (V1; consistent while paging DESC).
  const viewRows = useMemo(
    () => (sortDir === 'desc' ? rows : [...rows].reverse()),
    [rows, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const rangeFrom = total === 0 ? 0 : (safePage - 1) * perPage + 1;
  const rangeTo = Math.min(safePage * perPage, total);

  const hasFilter = (!isStaff && staffFilter !== 'all') || actionFilter !== 'all' || debounced !== '';
  const daySpan = useMemo(() => {
    if (!from || !to) return 0;
    const diff = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
    return Number.isFinite(diff) ? diff : 0;
  }, [from, to]);

  function staffCell(r: ActivityRow): JSX.Element {
    if (r.user_id === null || r.username === null) {
      // Spec §6: deleted account keeps its row; a completed check-out with no
      // recorded closer (old shift) shows "unknown" instead.
      const label = r.action === 'check_out' ? '— (không rõ)' : '— (tài khoản đã xóa)';
      return <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{label}</span>;
    }
    return (
      <span>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{r.full_name ?? r.username}</span>
        <br />
        <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{r.username}</span>
      </span>
    );
  }

  function detailCell(r: ActivityRow): JSX.Element {
    const line1 = [r.ticket_code, r.license_plate ? r.license_plate.toUpperCase() : null]
      .filter((x): x is string => x !== null && x !== '')
      .join(' · ');
    let line2: JSX.Element;
    if (r.amount !== null && r.amount !== undefined) {
      line2 = <span className="mono" style={{ fontSize: 14 }}>{formatVND(r.amount)}</span>;
    } else if (r.action === 'check_in' && r.is_monthly_session === 1) {
      line2 = <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Vé tháng (0₫)</span>;
    } else {
      line2 = <span className="mono" style={{ fontSize: 14, color: 'var(--color-text-60)' }}>—</span>;
    }
    return (
      <span>
        <span className="mono" style={{ fontSize: 14 }}>{line1 || '—'}</span>
        <br />
        {line2}
      </span>
    );
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    setProgress(0);
    setExportMsg('');
    const input = {
      staff_id: isStaff ? (userId ?? -1) : staffFilter === 'all' ? undefined : staffFilter,
      from: from || undefined,
      to: to || undefined,
      action: actionFilter === 'all' ? undefined : actionFilter,
      search: debounced || undefined,
      limit: 5000,
      offset: 0,
    };
    const res = await callApi((a) => a.listActivity(input), () => mockApi.listActivity(input));
    setProgress(60);
    if (!res.ok || !res.data) {
      setExporting(false);
      pushToast('danger', `Xuất thất bại: ${res.error ?? 'lỗi không rõ'} — bấm Xuất Excel để thử lại.`);
      return;
    }
    // Zero-dep "Excel": HTML-table .xls — Excel/LibreOffice mở trực tiếp,
    // giữ tiếng Việt (BOM) + đúng filter hiện tại (staff cũng xuất được phần mình).
    const head = ['Thời gian', 'Nhân viên', 'Tên đăng nhập', 'Hành động', 'Mã vé', 'Biển số', 'Khu vực', 'Số tiền (VND)', 'Phương thức', 'Ghi chú'];
    const tds = (cells: string[]): string => cells.map((c) => `<td>${escXls(c)}</td>`).join('');
    const body = res.data.rows.map((r) => {
      const zone = [r.zone_code, r.zone_name].filter(Boolean).join(' — ');
      return `<tr>${tds([
        formatDateTime(r.at),
        r.full_name ?? '',
        r.username ?? '',
        ACTION_META[r.action].label,
        r.ticket_code ?? '',
        (r.license_plate ?? '').toUpperCase(),
        zone,
        r.amount === null || r.amount === undefined ? '' : String(Math.round(r.amount)),
        r.payment_method ? METHOD_LABEL[r.payment_method] : '',
        r.note ?? '',
      ])}</tr>`;
    }).join('');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><tr>${head.map((h) => `<th>${escXls(h)}</th>`).join('')}</tr>${body}</table></body></html>`;
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = todayLocal().replaceAll('-', '');
    a.href = url;
    a.download = `nhat_ky_${stamp}.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setProgress(100);
    setExporting(false);
    setExportMsg(`Xuất xong: nhat_ky_${stamp}.xls (${res.data.rows.length} dòng)`);
    pushToast('success', `Xuất xong: nhat_ky_${stamp}.xls`);
  }

  // ---- route guard: only admin/staff (App.tsx also routes guest away) ----
  if (role !== 'admin' && role !== 'staff') {
    return (
      <div className="card">
        {forbidden || role === 'guest'
          ? <Alert tone="danger">Phiên của bạn không còn quyền — đăng nhập lại.</Alert>
          : <Alert tone="danger">Bạn không có quyền truy cập trang này.</Alert>}
        <div style={{ marginTop: 12 }}>
          <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="tabs"
        role="tablist"
        aria-label="Chế độ xem nhật ký"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setTab((t) => (t === 'detail' ? 'perf' : 'detail'));
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'detail'}
          tabIndex={tab === 'detail' ? 0 : -1}
          className="tab"
          onClick={() => setTab('detail')}
        >
          Chi tiết
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'perf'}
          tabIndex={tab === 'perf' ? 0 : -1}
          className="tab"
          onClick={() => setTab('perf')}
        >
          Hiệu suất
        </button>
      </div>
      <div className="toolbar">
        {!isStaff && (
          <select
            className="select"
            style={{ width: 240 }}
            aria-label="Nhân viên"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">Tất cả nhân viên</option>
            {staffUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
            ))}
          </select>
        )}
        <div className="seg" role="group" aria-label="Khoảng ngày">
          {([['today', 'Hôm nay'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['custom', 'Tùy chọn']] as Array<[Range, string]>).map(([r, label]) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => applyRange(r)}>{label}</button>
          ))}
        </div>
        {range === 'custom' && (
          <>
            <input className="input" style={{ width: 150 }} type="date" aria-label="Từ ngày (dd/mm/yyyy)" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input" style={{ width: 150 }} type="date" aria-label="Đến ngày (dd/mm/yyyy)" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        {tab === 'detail' && (
        <>
        <select
          className="select"
          style={{ width: 170 }}
          aria-label="Hành động"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
        >
          <option value="all">Tất cả hành động</option>
          <option value="check_in">Check-in</option>
          <option value="check_out">Check-out</option>
          <option value="pass_sale">Bán vé tháng</option>
        </select>
        <span role="search">
          <input
            id="global-search"
            className="input input-mono"
            style={{ width: 240 }}
            type="search"
            aria-label="Tìm mã vé, biển số"
            placeholder="Tìm mã vé, biển số…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </span>
        <span className="spacer" />
        <button className="btn btn-neutral" disabled={exporting || status !== 'ready'} aria-busy={exporting} onClick={() => void handleExport()}>
          <Download size={16} strokeWidth={2} aria-hidden="true" />
          {exporting ? `Đang xuất ${progress}%` : 'Xuất Excel'}
        </button>
        </>
        )}
      </div>

      <div aria-live="polite" role="status" className="sr-only">{exportMsg}</div>

      {tab === 'detail' && daySpan > 90 && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Khoảng &gt;90 ngày — file xuất giới hạn 5000 dòng, thu hẹp khoảng để xuất đủ.
        </div>
      )}

      {tab === 'detail' && (
      <>
      {status === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải nhật ký"><SkeletonRows rows={8} /></div>
      )}
      {status === 'error' && (
        <div className="card">
          {forbidden ? (
            <>
              <Alert tone="danger">Phiên của bạn không còn quyền — đăng nhập lại.</Alert>
              <div style={{ marginTop: 12 }}>
                <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
              </div>
            </>
          ) : (
            <RetryPanel message={error} onRetry={() => void load()} />
          )}
        </div>
      )}
      {status === 'ready' && total === 0 && (
        <div className="card">
          {hasFilter ? (
            <EmptyState
              title="Không tìm thấy hoạt động"
              hint="Thử đổi từ khóa, khoảng ngày hoặc bộ lọc hành động."
              action={(
                <button
                  className="btn btn-neutral"
                  onClick={() => {
                    setSearch('');
                    setActionFilter('all');
                    if (!isStaff) setStaffFilter('all');
                    applyRange('7d');
                  }}
                >
                  Xóa bộ lọc
                </button>
              )}
            />
          ) : isStaff ? (
            <EmptyState
              title="Bạn chưa có hoạt động nào"
              hint="Bạn chưa có hoạt động nào — các check-in/check-out của bạn sẽ hiện ở đây."
            />
          ) : (
            <EmptyState
              title="Chưa có hoạt động nào trong khoảng này"
              hint="Mở rộng khoảng ngày để xem thêm lịch sử hoạt động."
              action={<button className="btn btn-neutral" onClick={() => applyRange('30d')}>Mở rộng 30 ngày</button>}
            />
          )}
        </div>
      )}
      {status === 'ready' && total > 0 && (
        <>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col" aria-sort={sortDir === 'desc' ? 'descending' : 'ascending'}>
                    <button
                      type="button"
                      className="th-sort"
                      aria-label={sortDir === 'desc' ? 'Thời gian — đang mới nhất trước, nhấn để đảo' : 'Thời gian — đang cũ nhất trước, nhấn để đảo'}
                      onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                    >
                      Thời gian
                      {sortDir === 'desc'
                        ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                        : <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />}
                    </button>
                  </th>
                  <th scope="col">Nhân viên</th>
                  <th scope="col">Hành động</th>
                  <th scope="col">Chi tiết vé / số tiền</th>
                  <th scope="col">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {viewRows.map((r, i) => {
                  const meta = ACTION_META[r.action];
                  return (
                    <tr key={`${r.at}-${r.ticket_code ?? ''}-${i}`}>
                      <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(r.at)}</td>
                      <td>{staffCell(r)}</td>
                      <td>
                        <Badge tone={meta.tone}>
                          <meta.Icon size={12} strokeWidth={2} aria-hidden="true" />
                          {' '}{meta.label}
                        </Badge>
                      </td>
                      <td>{detailCell(r)}</td>
                      <td>
                        <span
                          style={{ display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={r.note ?? undefined}
                        >
                          {r.note ?? '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>Hiển thị {rangeFrom}–{rangeTo} / {total}</span>
            <span className="spacer" />
            <select
              className="select"
              style={{ width: 110 }}
              aria-label="Số dòng mỗi trang"
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value) as typeof perPage)}
            >
              <option value={20}>20 / trang</option>
              <option value={50}>50 / trang</option>
              <option value={100}>100 / trang</option>
            </select>
            <button className="btn btn-neutral btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Trước
            </button>
            <span className="mono" style={{ fontSize: 12 }} aria-live="polite">Trang {safePage}/{totalPages}</span>
            <button className="btn btn-neutral btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Sau
            </button>
          </div>
        </>
      )}
      </>
      )}
      {tab === 'perf' && (
        <div role="tabpanel" aria-label="Hiệu suất nhân viên">
          <ActivityPerf
            staffId={isStaff ? (userId ?? -1) : staffFilter === 'all' ? undefined : staffFilter}
            from={from}
            to={to}
            isStaff={isStaff}
            onExpandRange={() => applyRange('30d')}
          />
        </div>
      )}
      <Toasts items={toasts} />
    </div>
  );
}
