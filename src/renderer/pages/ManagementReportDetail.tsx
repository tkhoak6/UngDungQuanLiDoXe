// Management M1 — bảng chi tiết giao dịch (tab Chi tiết): 9 cột spec M1.1 +
// sort Thời gian DESC/ASC + pager server-side 50/100. V1 bỏ qua row-click
// drawer (frontend được bỏ qua mà vẫn PASS, pattern DS-007 §2).

import type { JSX } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge, EmptyState } from '../components/ui';
import { formatDateTime, formatVND } from '../lib/format';
import { TX_KIND_LABEL } from '../lib/management';
import { METHOD_LABEL } from '../lib/management-export';
import type { TxRow } from '../types';

interface Props {
  rows: TxRow[];
  total: number;
  page: number;
  perPage: 50 | 100;
  asc: boolean;
  onToggleSort: () => void;
  onPage: (p: number) => void;
  onPerPage: (n: 50 | 100) => void;
  onClearFilter: () => void;
}

export function ManagementReportDetail({
  rows, total, page, perPage, asc, onToggleSort, onPage, onPerPage, onClearFilter,
}: Props): JSX.Element {
  if (total === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Kỳ này không có giao dịch chi tiết"
          hint="Thử nới phương thức hoặc khu vực."
          action={<button className="btn btn-neutral" onClick={onClearFilter}>Xóa bộ lọc</button>}
        />
      </div>
    );
  }
  return (
    <>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col" aria-sort={asc ? 'ascending' : 'descending'}>
                <button
                  type="button"
                  className="th-sort"
                  aria-label={asc ? 'Thời gian — đang cũ nhất trước, nhấn để đảo' : 'Thời gian — đang mới nhất trước, nhấn để đảo'}
                  onClick={onToggleSort}
                >
                  Thời gian {asc ? <ChevronUp size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />}
                </button>
              </th>
              <th scope="col">Mã GD</th>
              <th scope="col">Loại</th>
              <th scope="col">Khu vực</th>
              <th scope="col">Biển số</th>
              <th scope="col">Thu ngân</th>
              <th scope="col">Phương thức</th>
              <th scope="col">Số tiền</th>
              <th scope="col">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.payment_id}>
                <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(r.paid_at)}</td>
                <td className="mono" style={{ fontSize: 12 }}>GD-{String(r.payment_id).padStart(6, '0')}</td>
                <td>
                  <Badge tone={r.kind === 'casual' ? 'primary' : r.kind === 'monthly' ? 'secondary' : 'warning'}>
                    {TX_KIND_LABEL[r.kind]}
                  </Badge>
                </td>
                <td>{[r.zone_code, r.zone_name].filter(Boolean).join(' — ') || '—'}</td>
                <td className="mono">{(r.license_plate ?? '').toUpperCase() || '—'}</td>
                <td>
                  {r.received_by_name ?? <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>— (đã xóa)</span>}
                  {r.received_by_username && <><br /><span className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{r.received_by_username}</span></>}
                </td>
                <td>{r.payment_method ? METHOD_LABEL[r.payment_method] : '—'}</td>
                <td className="mono"><strong>{formatVND(r.amount)}</strong></td>
                <td>
                  <span style={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note ?? undefined}>
                    {r.note ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager" aria-label="Phân trang chi tiết">
        <span className="mono" style={{ fontSize: 12 }}>Hiển thị {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} / {total}</span>
        <span className="spacer" />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          Số dòng
          <select className="select" style={{ width: 90, height: 32 }} aria-label="Số dòng mỗi trang" value={perPage} onChange={(e) => onPerPage(Number(e.target.value) as 50 | 100)}>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <button className="btn btn-neutral btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước">‹ Trước</button>
        <span className="mono" style={{ fontSize: 12 }} aria-live="polite">Trang {page}/{Math.max(1, Math.ceil(total / perPage))}</span>
        <button className="btn btn-neutral btn-sm" disabled={page * perPage >= total} onClick={() => onPage(page + 1)} aria-label="Trang sau">Sau ›</button>
      </div>
    </>
  );
}
