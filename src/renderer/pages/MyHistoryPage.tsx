import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Button, EmptyState, RetryPanel, SkeletonRows } from '../components/ui';
import { useAuth } from '../store/auth';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateTime, formatVND, normalizePlate, todayLocal } from '../lib/format';
import type { CustomerSessionRow } from '../types';

type Status = 'loading' | 'error' | 'ready';
type Range = 'today' | '7d' | '30d' | 'custom';
type PerPage = 20 | 50 | 100;

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  card: 'Thẻ',
  e_wallet: 'Ví điện tử',
};

function shiftDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function MyHistoryPage(): JSX.Element {
  const { logout } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [rows, setRows] = useState<CustomerSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [range, setRange] = useState<Range>('30d');
  const [from, setFrom] = useState(() => shiftDays(todayLocal(), -29));
  const [to, setTo] = useState(() => todayLocal());
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<PerPage>(20);
  const searchTimer = useRef<number | null>(null);

  // Search debounce 400ms (reuse activity-log pattern) + reset về trang 1.
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 400);
    return (): void => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [search]);

  function applyRange(r: Range): void {
    setRange(r);
    const today = todayLocal();
    if (r === 'today') {
      setFrom(today);
      setTo(today);
    } else if (r === '7d') {
      setFrom(shiftDays(today, -6));
      setTo(today);
    } else if (r === '30d') {
      setFrom(shiftDays(today, -29));
      setTo(today);
    }
    setPage(1);
  }

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setForbidden(false);
    const res = await callApi(
      (a) => a.customerSessions({
        from: from || undefined,
        to: to || undefined,
        search: normalizePlate(debounced) || undefined,
        limit: perPage,
        offset: (page - 1) * perPage,
      }),
      () => mockApi.customerSessions({
        from: from || undefined,
        to: to || undefined,
        search: normalizePlate(debounced) || undefined,
        limit: perPage,
        offset: (page - 1) * perPage,
      }),
    );
    if (!res.ok) {
      if (/quyền|forbidden|đăng nhập|liên kết/i.test(res.error ?? '')) setForbidden(true);
      setError(res.error ?? 'Không tải được lịch sử');
      setStatus('error');
      return;
    }
    setRows(res.data?.rows ?? []);
    setTotal(res.data?.total ?? 0);
    setTotalSpent(res.data?.total_spent ?? 0);
    setStatus('ready');
  }, [from, to, debounced, perPage, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFilter = debounced.trim() !== '' || range !== '30d';
  const daySpan = (() => {
    if (!from || !to) return 0;
    return Math.max(0, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1);
  })();
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const rangeFrom = total === 0 ? 0 : (safePage - 1) * perPage + 1;
  const rangeTo = Math.min(safePage * perPage, total);

  return (
    <div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Khoảng ngày">
          {([['today', 'Hôm nay'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['custom', 'Tùy chọn']] as Array<[Range, string]>).map(([r, label]) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => applyRange(r)}>{label}</button>
          ))}
        </div>
        {range === 'custom' && (
          <>
            <input
              className="input"
              style={{ width: 150 }}
              type="date"
              aria-label="Từ ngày (dd/mm/yyyy)"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <input
              className="input"
              style={{ width: 150 }}
              type="date"
              aria-label="Đến ngày (dd/mm/yyyy)"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </>
        )}
        <span role="search">
          <input
            id="global-search"
            className="input input-mono search-input"
            type="search"
            aria-label="Tìm mã vé, biển số"
            placeholder="Tìm mã vé, biển số…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </span>
      </div>

      {daySpan > 90 && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Khoảng &gt;90 ngày — thu hẹp để xem đủ (tối đa 100 dòng/trang).
        </div>
      )}

      {status === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải lịch sử"><SkeletonRows rows={8} /></div>
      )}
      {status === 'error' && (
        <div className="card">
          {forbidden ? (
            <>
              <div className="alert alert-danger" role="alert">
                {error || 'Phiên của bạn không còn quyền — đăng nhập lại.'}
              </div>
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
              title="Không tìm thấy lượt gửi"
              hint="Thử từ khóa hoặc khoảng ngày khác."
              action={(
                <Button
                  variant="neutral"
                  onClick={() => {
                    setSearch('');
                    applyRange('30d');
                  }}
                >
                  Xóa bộ lọc
                </Button>
              )}
            />
          ) : (
            <EmptyState
              title="Chưa có lượt gửi nào trong khoảng này"
              hint="Xe của bạn sẽ hiện ở đây sau lần gửi đầu tiên tại quầy."
              action={<Button variant="neutral" onClick={() => applyRange('30d')}>Mở rộng khoảng ngày</Button>}
            />
          )}
        </div>
      )}
      {status === 'ready' && total > 0 && (
        <>
          <div className="table-wrap">
            <table className="grid">
              <caption className="sr-only">Lịch sử gửi xe của tôi — {total} lượt</caption>
              <thead>
                <tr>
                  <th scope="col">Thời gian</th>
                  <th scope="col">Mã vé</th>
                  <th scope="col">Biển số</th>
                  <th scope="col">Khu</th>
                  <th scope="col">Tiền</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ticket_code}>
                    <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(r.check_in_at)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{r.ticket_code}</td>
                    <td className="mono" style={{ fontSize: 14, textTransform: 'uppercase' }}>{r.license_plate}</td>
                    <td>{r.zone_code ? `Khu ${r.zone_code}` : '—'}</td>
                    <td
                      className="mono"
                      title={r.payment_method ? `Đã thu: ${PAYMENT_LABEL[r.payment_method] ?? r.payment_method}` : undefined}
                    >
                      {r.is_monthly === 1 ? (
                        <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Vé tháng (0₫)</span>
                      ) : r.total_fee !== null ? (
                        formatVND(r.total_fee)
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Đang đỗ</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="mono" aria-live="polite">
              Tổng cộng: {total} lượt · {formatVND(totalSpent)}
            </span>
            <span className="spacer" />
            <span>Hiển thị {rangeFrom}–{rangeTo} / {total}</span>
            <select
              className="select"
              style={{ width: 110 }}
              aria-label="Số dòng mỗi trang"
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value) as PerPage);
                setPage(1);
              }}
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
    </div>
  );
}
