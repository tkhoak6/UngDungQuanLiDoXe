// Tab "Hiệu suất" trong màn Nhật ký (spec `./specs/staff-area.md` S2).
// Tái dùng 100% `activity:list` — fetch 1 lần limit 5000 rồi aggregate
// client-side (không API mới). Staff V1 chỉ thấy số của mình (backend ép
// mine_only; component này KHÔNG render bảng xếp hạng cho staff).

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, Badge, EmptyState, RetryPanel, SkeletonRows } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatVND } from '../lib/format';
import type { ActivityRow } from '../types';

export const PERF_LIMIT = 5000;

export interface PerfStat {
  key: string;
  userId: number | null;
  username: string | null;
  fullName: string | null;
  checkIn: number;
  checkOut: number;
  passSale: number;
  revenue: number;
}

export function aggregateActivity(rows: ActivityRow[]): PerfStat[] {
  const map = new Map<string, PerfStat>();
  for (const r of rows) {
    // User đã xóa gom 1 dòng cuối (key 'deleted', không rank).
    const key = r.user_id === null ? 'deleted' : `u:${r.user_id}`;
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        userId: r.user_id,
        username: r.username,
        fullName: r.full_name,
        checkIn: 0,
        checkOut: 0,
        passSale: 0,
        revenue: 0,
      };
      map.set(key, s);
    }
    if (r.action === 'check_in') s.checkIn += 1;
    else if (r.action === 'check_out') s.checkOut += 1;
    else s.passSale += 1;
    // Mỗi event 1 dòng — check-in vé tháng/null bỏ qua tự nhiên (?? 0).
    s.revenue += r.amount ?? 0;
  }
  return [...map.values()];
}

type PerfSortKey = 'revenue' | 'checkIn' | 'checkOut' | 'passSale' | 'closeRate';
type SortDir = 'asc' | 'desc';

function closeRate(s: PerfStat): number | null {
  if (s.checkIn === 0) return null;
  return s.passSale / s.checkIn;
}

function rateLabel(s: PerfStat): string {
  const r = closeRate(s);
  return r === null ? '—' : `${(r * 100).toFixed(1)}%`;
}

interface PerfProps {
  staffId?: number;
  from: string;
  to: string;
  isStaff: boolean;
  onExpandRange: () => void;
}

const SORT_LABEL: Record<PerfSortKey, string> = {
  revenue: 'Doanh thu',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  passSale: 'Vé bán',
  closeRate: 'Tỉ lệ chốt vé',
};

export function ActivityPerf({ staffId, from, to, isStaff, onExpandRange }: PerfProps): JSX.Element {
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sortKey, setSortKey] = useState<PerfSortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const invalidRange = Boolean(from && to && from > to);

  const load = useCallback(async () => {
    if (invalidRange) return;
    setStatus('loading');
    const res = await callApi(
      (a) => a.listActivity({ staff_id: staffId, from: from || undefined, to: to || undefined, limit: PERF_LIMIT, offset: 0 }),
      () => mockApi.listActivity({ staff_id: staffId, from: from || undefined, to: to || undefined, limit: PERF_LIMIT, offset: 0 }),
    );
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Lỗi tải số liệu hiệu suất');
      setStatus('error');
      return;
    }
    setRows(res.data.rows);
    setTotal(res.data.total);
    setStatus('ready');
  }, [staffId, from, to, invalidRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => aggregateActivity(rows), [rows]);
  const capped = total > rows.length;

  const totals = useMemo(
    () => ({
      revenue: stats.reduce((s, x) => s + x.revenue, 0),
      checkIn: stats.reduce((s, x) => s + x.checkIn, 0),
      passSale: stats.reduce((s, x) => s + x.passSale, 0),
    }),
    [stats],
  );

  // Dòng tài khoản đã xóa luôn cuối bảng, không rank (spec S2.2).
  const ranked = useMemo(() => {
    const alive = stats.filter((s) => s.userId !== null);
    const val = (s: PerfStat): number => {
      if (sortKey === 'closeRate') return closeRate(s) ?? -1;
      return s[sortKey];
    };
    return [...alive].sort((a, b) => {
      const d = val(a) - val(b);
      return sortDir === 'desc' ? -d : d;
    });
  }, [stats, sortKey, sortDir]);

  const deletedRow = useMemo(() => stats.find((s) => s.userId === null) ?? null, [stats]);
  const maxRevenue = useMemo(() => ranked.reduce((m, s) => Math.max(m, s.revenue), 0), [ranked]);

  function toggleSort(key: PerfSortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function sortTh(key: PerfSortKey, label: string, numeric = true): JSX.Element {
    const active = sortKey === key;
    return (
      <th scope="col" aria-sort={active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'} style={numeric ? { textAlign: 'right' } : undefined}>
        <button
          type="button"
          className="th-sort"
          style={numeric ? { marginLeft: 'auto' } : undefined}
          aria-label={`${label} — sắp xếp ${active ? (sortDir === 'desc' ? 'giảm dần, nhấn để đảo' : 'tăng dần, nhấn để đảo') : 'nhấn để sắp xếp'}`}
          onClick={() => toggleSort(key)}
        >
          {label}
          {active && (sortDir === 'desc'
            ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            : <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />)}
        </button>
      </th>
    );
  }

  if (invalidRange) {
    return (
      <div className="card">
        <Alert tone="danger">Khoảng ngày chưa đúng (Từ ngày sau Đến ngày) — chọn lại để xem hiệu suất.</Alert>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card" aria-busy="true" aria-label="Đang tải số liệu"><SkeletonRows rows={2} /></div>
          ))}
        </div>
        <div className="card" aria-busy="true" aria-label="Đang tải bảng xếp hạng"><SkeletonRows rows={5} /></div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card">
        <RetryPanel message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Chưa có hoạt động nào trong khoảng này"
          hint="Mở rộng khoảng ngày để xem hiệu suất."
          action={<button className="btn btn-neutral" onClick={onExpandRange}>Mở rộng 30 ngày</button>}
        />
      </div>
    );
  }

  return (
    <div>
      {capped && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Dữ liệu vượt trần {PERF_LIMIT.toLocaleString('vi-VN')} dòng — số liệu tính trên {rows.length.toLocaleString('vi-VN')}/{total.toLocaleString('vi-VN')} dòng. Thu hẹp khoảng ngày để xem đủ.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Tổng doanh thu kỳ</div>
          <div className="kpi-value mono" style={{ fontSize: 24 }}>{formatVND(totals.revenue)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Tổng lượt check-in</div>
          <div className="kpi-value mono" style={{ fontSize: 24 }}>{totals.checkIn.toLocaleString('vi-VN')}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Tổng vé tháng bán</div>
          <div className="kpi-value mono" style={{ fontSize: 24 }}>{totals.passSale.toLocaleString('vi-VN')}</div>
        </div>
      </div>

      {isStaff ? (
        <div className="card">
          <span style={{ fontSize: 14, color: 'var(--color-text-60)' }}>
            Chỉ hiển thị số liệu của bạn trong kỳ — phiên bản hiện tại chưa có xếp hạng.
          </span>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="grid">
              <caption className="sr-only">Bảng xếp hạng nhân viên theo {SORT_LABEL[sortKey]}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 56 }}>#</th>
                  <th scope="col">Nhân viên</th>
                  {sortTh('checkIn', 'Check-in')}
                  {sortTh('checkOut', 'Check-out')}
                  {sortTh('passSale', 'Vé bán')}
                  {sortTh('revenue', 'Doanh thu')}
                  {sortTh('closeRate', 'Tỉ lệ chốt vé')}
                </tr>
              </thead>
              <tbody>
                {ranked.map((s, i) => {
                  const top = i === 0 && sortKey === 'revenue' && sortDir === 'desc';
                  return (
                    <tr key={s.key} style={top ? { background: 'var(--color-secondary-tint)' } : undefined}>
                      <td className="mono" style={{ fontSize: 14 }}>
                        #{i + 1}{' '}
                        {top && <Badge tone="secondary">Top 1</Badge>}
                      </td>
                      <td>
                        <span>
                          <span style={{ fontSize: 16, fontWeight: 500 }}>{s.fullName ?? s.username ?? '—'}</span>
                          <br />
                          <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{s.username ?? '—'}</span>
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{s.checkIn.toLocaleString('vi-VN')}</td>
                      <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{s.checkOut.toLocaleString('vi-VN')}</td>
                      <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{s.passSale.toLocaleString('vi-VN')}</td>
                      <td className="mono" style={{ fontSize: 14, textAlign: 'right', fontWeight: top ? 700 : 400 }}>{formatVND(s.revenue)}</td>
                      <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{rateLabel(s)}</td>
                    </tr>
                  );
                })}
                {deletedRow && (
                  <tr key="deleted">
                    <td className="mono" style={{ fontSize: 14 }}>—</td>
                    <td><span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>— (tài khoản đã xóa)</span></td>
                    <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{deletedRow.checkIn.toLocaleString('vi-VN')}</td>
                    <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{deletedRow.checkOut.toLocaleString('vi-VN')}</td>
                    <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{deletedRow.passSale.toLocaleString('vi-VN')}</td>
                    <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{formatVND(deletedRow.revenue)}</td>
                    <td className="mono" style={{ fontSize: 14, textAlign: 'right' }}>{rateLabel(deletedRow)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-60)', margin: '8px 0 16px' }}>
            *Tỉ lệ chốt vé = vé tháng bán / lượt check-in.
          </p>
          <div className="card" aria-label="Biểu đồ doanh thu theo nhân viên">
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Doanh thu theo nhân viên</div>
            {ranked.map((s) => {
              const pct = maxRevenue > 0 ? Math.round((s.revenue / maxRevenue) * 100) : 0;
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <span style={{ width: 160, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.fullName ?? s.username ?? '—'}
                  </span>
                  <span aria-hidden="true" style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--color-primary-tint)' }}>
                    <span style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 5, background: 'var(--color-primary)' }} />
                  </span>
                  <span className="mono" style={{ width: 140, fontSize: 14, textAlign: 'right' }}>{formatVND(s.revenue)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
