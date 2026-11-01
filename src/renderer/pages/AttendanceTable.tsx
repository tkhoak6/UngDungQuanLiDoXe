import { useMemo, useState, type JSX } from 'react';
import { Alert, Badge, Button, EmptyState, RetryPanel, SkeletonRows } from '../components/ui';
import type { AttendanceRow, AttendanceStatus, UserDTO } from '../types';
import { elapsedHM, fmtHM, fmtSigned } from '../lib/attendance';
import { formatDateShort, formatVND } from '../lib/format';

export type AttendanceRange = 'today' | '7d' | '30d' | 'custom';
export type AttendanceLoad = 'loading' | 'error' | 'ready';

const STATUS_META: Record<AttendanceStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  present: { label: 'Đúng giờ', tone: 'success' },
  late: { label: 'Trễ', tone: 'warning' },
  missing: { label: 'Vắng', tone: 'danger' },
};

interface Props {
  isAdmin: boolean;
  staffUsers: UserDTO[];
  staffFilter: 'all' | number;
  onStaffFilter: (v: 'all' | number) => void;
  range: AttendanceRange;
  onRange: (r: AttendanceRange) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  listStatus: AttendanceLoad;
  listError: string;
  forbidden: boolean;
  onRetry: () => void;
  onLogout: () => void;
  rows: AttendanceRow[]; // đã fetch (tối đa 200) — filter trạng thái + pager client-side
  total: number;
}

// FE-019 S3 table "Ca của tôi" / admin "Bảng chấm công": toolbar chung
// (staff-filter admin + seg khoảng ngày + filter trạng thái) + pager
// client-side. Chênh lệch = cuối − đầu (tiền két); đối soát trừ thu trong
// ca hiển thị ngay sau khi chốt ca (banner ở page).
export function AttendanceTable(props: Props): JSX.Element {
  const {
    isAdmin, staffUsers, staffFilter, onStaffFilter, range, onRange,
    from, to, onFrom, onTo, listStatus, listError, forbidden,
    onRetry, onLogout, rows, total,
  } = props;
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<10 | 20 | 50>(20);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  // Reset về trang 1 khi filter ngoài đổi (rows mới).
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setPage(1);
  }

  return (
    <>
      <div className="toolbar">
        {isAdmin && (
          <select
            className="select"
            style={{ width: 240 }}
            aria-label="Nhân viên"
            value={staffFilter}
            onChange={(e) => {
              onStaffFilter(e.target.value === 'all' ? 'all' : Number(e.target.value));
            }}
          >
            <option value="all">Tất cả nhân viên</option>
            {staffUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
            ))}
          </select>
        )}
        <div className="seg" role="group" aria-label="Khoảng ngày">
          {([['today', 'Hôm nay'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['custom', 'Tùy chọn']] as Array<[AttendanceRange, string]>).map(([r, label]) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => onRange(r)}>{label}</button>
          ))}
        </div>
        {range === 'custom' && (
          <>
            <input className="input" style={{ width: 150 }} type="date" aria-label="Từ ngày (dd/mm/yyyy)" value={from} onChange={(e) => onFrom(e.target.value)} />
            <input className="input" style={{ width: 150 }} type="date" aria-label="Đến ngày (dd/mm/yyyy)" value={to} onChange={(e) => onTo(e.target.value)} />
          </>
        )}
        <select
          className="select"
          style={{ width: 170 }}
          aria-label="Trạng thái"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as typeof statusFilter);
            setPage(1);
          }}
        >
          <option value="all">Mọi trạng thái</option>
          <option value="present">Đúng giờ</option>
          <option value="late">Trễ</option>
          <option value="missing">Vắng</option>
        </select>
      </div>

      {listStatus === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải bảng chấm công"><SkeletonRows rows={7} /></div>
      )}
      {listStatus === 'error' && (
        <div className="card">
          {forbidden ? (
            <>
              <Alert tone="danger">Phiên của bạn không còn quyền — đăng nhập lại.</Alert>
              <div style={{ marginTop: 12 }}>
                <Button variant="neutral" onClick={onLogout}>Đăng nhập lại</Button>
              </div>
            </>
          ) : (
            <RetryPanel message={listError} onRetry={onRetry} />
          )}
        </div>
      )}
      {listStatus === 'ready' && (
        <>
          {total > rows.length && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="warning">
                Chỉ hiện {rows.length}/{total} dòng gần nhất — thu hẹp khoảng ngày để xem đủ.
              </Alert>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="card">
              <EmptyState
                title={statusFilter === 'all' ? 'Chưa có lượt trực nào trong khoảng này' : `Không có lượt ${STATUS_META[statusFilter].label.toLowerCase()} trong khoảng này`}
                hint={statusFilter === 'all' ? 'Vào ca để bắt đầu ghi nhận chấm công.' : 'Thử chọn trạng thái khác.'}
              />
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Ngày</th>
                      {isAdmin && <th scope="col">Nhân viên</th>}
                      <th scope="col">Ca</th>
                      <th scope="col">Vào</th>
                      <th scope="col">Ra</th>
                      <th scope="col">Giờ trực</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Đầu ca</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Cuối ca</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Chênh lệch</th>
                      <th scope="col">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const diff = r.closing_cash === null ? null : r.closing_cash - r.opening_cash;
                      return (
                        <tr key={r.id}>
                          <td className="mono">{formatDateShort(r.work_date)}</td>
                          {isAdmin && (
                            <td>
                              {r.full_name ?? '— (tài khoản đã xóa)'}
                              {r.username !== null && <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{r.username}</div>}
                            </td>
                          )}
                          <td>
                            {r.shift_name}
                            <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{r.shift_start}–{r.shift_end}</div>
                          </td>
                          <td className="mono">{fmtHM(r.check_in_at)}</td>
                          <td className="mono">{fmtHM(r.check_out_at)}</td>
                          <td className="mono">
                            {r.check_in_at !== null && r.check_out_at !== null
                              ? elapsedHM(r.check_in_at, r.check_out_at)
                              : r.check_in_at !== null
                                ? elapsedHM(r.check_in_at)
                                : '—'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{formatVND(r.opening_cash)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{r.closing_cash === null ? '—' : formatVND(r.closing_cash)}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>
                            {diff === null ? '—' : diff === 0 ? <Badge tone="success">khớp</Badge> : fmtSigned(diff)}
                          </td>
                          <td><Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="field-hint" style={{ marginTop: 8 }}>
                Chênh lệch = cuối − đầu (tiền két). Đối soát trừ thu trong ca hiển thị ngay sau khi chốt ca — lệch chỉ Warning, không chặn.
              </p>
              <div className="pager">
                <span className="spacer" />
                <label htmlFor="att-perpage">Mỗi trang</label>
                <select
                  id="att-perpage"
                  className="select"
                  style={{ width: 90 }}
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value) as typeof perPage);
                    setPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <button type="button" className="btn btn-neutral btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>Trước</button>
                <span aria-live="polite">Trang {safePage}/{pageCount} · {filtered.length} dòng</span>
                <button type="button" className="btn btn-neutral btn-sm" disabled={safePage >= pageCount} onClick={() => setPage((p) => p + 1)}>Sau</button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
