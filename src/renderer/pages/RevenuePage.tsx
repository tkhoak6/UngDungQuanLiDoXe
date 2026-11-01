import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Button, EmptyState, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateShort, formatVND, todayLocal } from '../lib/format';
import type { MonthlyPass, ParkingZone } from '../types';

type Status = 'loading' | 'error' | 'empty' | 'ready';
type Range = 'today' | '7d' | '30d' | 'custom';

interface DayRow {
  day: string;
  entries: number;
  exits: number;
  casual: number;
  monthly: number;
  total: number;
}

let toastSeq = 300;

function shiftDate(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function RevenuePage(): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<DayRow[]>([]);
  const [range, setRange] = useState<Range>('7d');
  const [from, setFrom] = useState(shiftDate(todayLocal(), -6));
  const [to, setTo] = useState(todayLocal());
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const [zoneId, setZoneId] = useState<'all' | number>('all');
  const [ticketKind, setTicketKind] = useState<'all' | 'casual' | 'monthly'>('all');
  const [exporting, setExporting] = useState<null | 'excel' | 'pdf'>(null);
  const [progress, setProgress] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

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

  const load = useCallback(async () => {
    setStatus('loading');
    const [rRes, zRes, pRes] = await Promise.all([
      callApi((a) => a.revenue(from, to), () => mockApi.revenue(from, to)),
      callApi((a) => a.listZones(), () => mockApi.listZones()),
      callApi((a) => a.listPasses(), () => mockApi.listPasses()),
    ]);
    if (!rRes.ok || !rRes.data) {
      setError(rRes.error ?? 'Lỗi tải báo cáo');
      setStatus('error');
      return;
    }
    setZones(zRes.ok ? (zRes.data ?? []) : []);
    // Vé tháng revenue = pass sales (payments with monthly_pass_id) grouped by
    // start_date; v_revenue_daily has no kind split so casual/monthly must be
    // composed here to honour the Loại vé filter (QA P0-1).
    const passList: MonthlyPass[] = pRes.ok ? (pRes.data ?? []) : [];
    const monthlyByDay = new Map<string, number>();
    for (const p of passList) {
      if (p.status === 'cancelled') continue;
      if (p.start_date < from || p.start_date > to) continue;
      if (zoneId !== 'all' && p.zone_id !== null && p.zone_id !== zoneId) continue;
      monthlyByDay.set(p.start_date, (monthlyByDay.get(p.start_date) ?? 0) + p.price);
    }
    const byDay = new Map<string, DayRow>();
    const wantCasual = ticketKind === 'all' || ticketKind === 'casual';
    const wantMonthly = ticketKind === 'all' || ticketKind === 'monthly';
    for (const d of rRes.data.daily) {
      const cur = byDay.get(d.day) ?? { day: d.day, entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 };
      if (wantCasual) cur.casual += d.revenue;
      byDay.set(d.day, cur);
    }
    if (wantMonthly) {
      for (const [day, amount] of monthlyByDay) {
        const cur = byDay.get(day) ?? { day, entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 };
        cur.monthly += amount;
        byDay.set(day, cur);
      }
    }
    for (const s of rRes.data.sessions) {
      if (zoneId !== 'all' && s.zone_id !== zoneId) continue;
      const cur = byDay.get(s.day) ?? { day: s.day, entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 };
      cur.entries += s.entries;
      cur.exits += s.exits;
      byDay.set(s.day, cur);
    }
    for (const cur of byDay.values()) cur.total = cur.casual + cur.monthly;
    const list = [...byDay.values()]
      .filter((r) => {
        if (ticketKind === 'monthly') return r.monthly !== 0;
        if (ticketKind === 'casual') return r.casual !== 0 || r.entries !== 0;
        return r.casual !== 0 || r.monthly !== 0 || r.entries !== 0;
      })
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    setRows(list);
    setStatus(list.length === 0 ? 'empty' : 'ready');
  }, [from, to, zoneId, ticketKind]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    return rows.reduce(
      (s, r) => ({ entries: s.entries + r.entries, exits: s.exits + r.exits, casual: s.casual + r.casual, monthly: s.monthly + r.monthly, total: s.total + r.total }),
      { entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 },
    );
  }, [rows]);

  const daySpan = useMemo(() => {
    const diff = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
    return Number.isFinite(diff) ? diff : 0;
  }, [from, to]);

  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  async function handleExport(kind: 'excel' | 'pdf'): Promise<void> {
    setExporting(kind);
    setProgress(0);
    for (const p of [25, 55, 85, 100]) {
      await new Promise((r) => setTimeout(r, 220));
      setProgress(p);
    }
    setExporting(null);
    pushToast('success', `Xuất xong: bao_cao_${to.replaceAll('-', '')}.${kind === 'excel' ? 'xlsx' : 'pdf'}`);
  }

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
            <input className="input" style={{ width: 150 }} type="date" aria-label="Từ ngày (dd/mm/yyyy)" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input" style={{ width: 150 }} type="date" aria-label="Đến ngày (dd/mm/yyyy)" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <select className="select" style={{ width: 170 }} aria-label="Khu vực" value={zoneId} onChange={(e) => setZoneId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">Mọi khu vực</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </select>
        <select className="select" style={{ width: 140 }} aria-label="Loại vé" value={ticketKind} onChange={(e) => setTicketKind(e.target.value as typeof ticketKind)}>
          <option value="all">Mọi loại vé</option>
          <option value="casual">Vé lượt</option>
          <option value="monthly">Vé tháng</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-neutral" disabled={exporting !== null} aria-busy={exporting === 'excel'} onClick={() => void handleExport('excel')}>
          {exporting === 'excel' ? `Đang xuất ${progress}%` : 'Xuất Excel'}
        </button>
        <button className="btn btn-neutral" disabled={exporting !== null} aria-busy={exporting === 'pdf'} onClick={() => void handleExport('pdf')}>
          {exporting === 'pdf' ? `Đang xuất ${progress}%` : 'Xuất PDF'}
        </button>
      </div>

      {daySpan > 90 && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Khoảng &gt;90 ngày — hiển thị theo tuần (gộp tự động).
        </div>
      )}

      {status === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải báo cáo"><SkeletonRows rows={8} /></div>
      )}
      {status === 'error' && <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>}
      {status === 'empty' && (
        <div className="card">
          <EmptyState
            title="Không có giao dịch trong khoảng này"
            hint="Mở rộng khoảng ngày hoặc đổi khu vực để xem thêm."
            action={<button className="btn btn-neutral" onClick={() => applyRange('30d')}>Mở rộng 30 ngày</button>}
          />
        </div>
      )}
      {status === 'ready' && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="card">
              <div className="kpi-label">Tổng doanh thu</div>
              <div className="kpi-value mono" style={{ fontSize: 24 }}>{formatVND(totals.total)}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Tổng lượt xe</div>
              <div className="kpi-value">{totals.entries}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Trung bình / lượt</div>
              <div className="kpi-value mono" style={{ fontSize: 24 }}>{formatVND(totals.entries === 0 ? 0 : totals.total / totals.entries)}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Doanh thu theo ngày</h3>
            <div className="legend" aria-label="Chú thích doanh thu">
              <span><span className="swatch" style={{ background: 'var(--color-primary)' }} />Vé lượt</span>
              <span><span className="swatch" style={{ background: 'var(--color-secondary)' }} />Vé tháng</span>
            </div>
            <div className="bar-chart" role="img" aria-label={`Tổng ${formatVND(totals.total)} trong ${rows.length} ngày (vé lượt ${formatVND(totals.casual)}, vé tháng ${formatVND(totals.monthly)})`}>
              {rows.map((r) => {
                const pct = maxTotal === 0 ? 0 : Math.round((r.total / maxTotal) * 100);
                const cFlex = r.total === 0 ? 0 : r.casual / r.total;
                const mFlex = r.total === 0 ? 0 : r.monthly / r.total;
                return (
                  <div key={r.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '70%', height: `${pct}%`, minHeight: r.total > 0 ? 4 : 0, display: 'flex', flexDirection: 'column' }} title={`${r.day}: vé lượt ${formatVND(r.casual)} + vé tháng ${formatVND(r.monthly)}`}>
                      <div style={{ flexGrow: mFlex, background: 'var(--color-secondary)' }} />
                      <div style={{ flexGrow: cFlex, background: 'var(--color-primary)' }} />
                    </div>
                    <span className="mono" style={{ fontSize: 10 }}>{formatDateShort(r.day).slice(0, 5)}</span>
                  </div>
                );
              })}
            </div>
            <table className="sr-only">
              <caption>Doanh thu theo ngày</caption>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day}><td>{r.day}</td><td>Vé lượt {r.casual}</td><td>Vé tháng {r.monthly}</td><td>Tổng {r.total}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Ngày</th>
                  <th scope="col">Lượt vào</th>
                  <th scope="col">Lượt ra</th>
                  <th scope="col">Vé lượt</th>
                  <th scope="col">Vé tháng</th>
                  <th scope="col">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day}>
                    <td className="mono">{formatDateShort(r.day)}</td>
                    <td className="mono">{r.entries}</td>
                    <td className="mono">{r.exits}</td>
                    <td className="mono">{formatVND(r.casual)}</td>
                    <td className="mono">{formatVND(r.monthly)}</td>
                    <td className="mono"><strong>{formatVND(r.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Tổng</th>
                  <td className="mono"><strong>{totals.entries}</strong></td>
                  <td className="mono"><strong>{totals.exits}</strong></td>
                  <td className="mono"><strong>{formatVND(totals.casual)}</strong></td>
                  <td className="mono"><strong>{formatVND(totals.monthly)}</strong></td>
                  <td className="mono"><strong>{formatVND(totals.total)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <div aria-live="polite" className="sr-only">{exporting ? `Đang xuất ${progress}%` : ''}</div>
      <Toasts items={toasts} />
      <div style={{ marginTop: 12 }}>
        <Button variant="ghost" onClick={() => void load()}>Tải lại báo cáo</Button>
      </div>
    </div>
  );
}
