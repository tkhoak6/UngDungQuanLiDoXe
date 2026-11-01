// Management M1 — Báo cáo nâng cao: so sánh 2 kỳ + chi tiết + xuất Excel/PDF.
// Spec ./specs/management-area.md §M1 (nối BE-015 `reports:transactions`).
// Tab Tổng hợp tái dùng 2 views §10 (gọi 2 lần cho kỳ A/B, không IPC compare).

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Download } from 'lucide-react';
import { Alert, Badge, EmptyState, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateShort, formatVND, todayLocal } from '../lib/format';
import { ManagementReportDetail } from './ManagementReportDetail';
import {
  composeAggregate,
  daySpanDays,
  defaultPrevPeriod,
  deltaPct,
  periodsOverlap,
  shiftDate,
  summarizeAgg,
  type DayAgg,
  type Granularity,
} from '../lib/management';
import { exportTransactionsXls, openSummaryPrint } from '../lib/management-export';
import type { PaymentMethod, TxKind, TxRow } from '../types';

type Status = 'loading' | 'error' | 'ready';
type Mode = 'agg' | 'detail';
type Range = 'today' | '7d' | '30d' | 'quarter' | 'year' | 'custom';

let toastSeq = 500;

function fmtDelta(d: number | null): string {
  if (d === null) return '—';
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(1).replace('.', ',')}%`;
}

export function ManagementReports(): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('agg');
  const [granularity, setGranularity] = useState<Granularity>('day');
  // Kỳ A
  const [range, setRange] = useState<Range>('30d');
  const [from, setFrom] = useState(shiftDate(todayLocal(), -29));
  const [to, setTo] = useState(todayLocal());
  // Kỳ B (so sánh)
  const [compare, setCompare] = useState(true);
  const [fromB, setFromB] = useState(shiftDate(shiftDate(todayLocal(), -29), -30));
  const [toB, setToB] = useState(shiftDate(shiftDate(todayLocal(), -29), -1));
  // Filter chung
  const [zoneChecks, setZoneChecks] = useState<number[]>([]);
  const [zones, setZones] = useState<Array<{ id: number; name: string }>>([]);
  const [kind, setKind] = useState<'all' | TxKind>('all');
  const [method, setMethod] = useState<'all' | PaymentMethod>('all');
  const [search, setSearch] = useState('');
  // Dữ liệu
  const [aggA, setAggA] = useState<DayAgg[]>([]);
  const [aggB, setAggB] = useState<DayAgg[]>([]);
  const [bFailed, setBFailed] = useState(false);
  const [detail, setDetail] = useState<TxRow[]>([]);
  const [detailTotal, setDetailTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<50 | 100>(50);
  const [asc, setAsc] = useState(false);
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
    let f = today; let t = today;
    if (r === 'today') { f = today; t = today; }
    else if (r === '7d') { f = shiftDate(today, -6); t = today; }
    else if (r === '30d') { f = shiftDate(today, -29); t = today; }
    else if (r === 'quarter') { f = shiftDate(today, -89); t = today; }
    else if (r === 'year') { f = shiftDate(today, -364); t = today; }
    setFrom(f); setTo(t);
    if (r !== 'custom') {
      const prev = defaultPrevPeriod(f, t);
      setFromB(prev.from); setToB(prev.to);
    }
  }, []);

  const invalidRange = from !== '' && to !== '' && from > to;
  const span = daySpanDays(from, to);
  const overlapWarn = compare && !invalidRange && periodsOverlap(from, to, fromB, toB);

  const load = useCallback(async () => {
    if (invalidRange) return;
    setStatus('loading');
    setBFailed(false);
    const [rA, zRes, pRes] = await Promise.all([
      callApi((a) => a.revenue(from, to), () => mockApi.revenue(from, to)),
      callApi((a) => a.listZones(), () => mockApi.listZones()),
      callApi((a) => a.listPasses(), () => mockApi.listPasses()),
    ]);
    if (!rA.ok || !rA.data) {
      setError(rA.error ?? 'Lỗi tải báo cáo');
      setStatus('error');
      return;
    }
    const zList = zRes.ok ? (zRes.data ?? []) : [];
    setZones(zList.map((z) => ({ id: z.id, name: z.name })));
    const passes = pRes.ok ? (pRes.data ?? []) : [];
    setAggA(composeAggregate(rA.data.daily, rA.data.sessions, passes, from, to, zoneChecks));
    // Kỳ B: partial-fail được — giữ Kỳ A + badge thử lại (spec M1.4).
    if (compare) {
      const rB = await callApi((a) => a.revenue(fromB, toB), () => mockApi.revenue(fromB, toB));
      if (!rB.ok || !rB.data) {
        setBFailed(true);
        setAggB([]);
      } else {
        setAggB(composeAggregate(rB.data.daily, rB.data.sessions, passes, fromB, toB, zoneChecks));
      }
    } else {
      setAggB([]);
    }
    // Tab Chi tiết: detail Kỳ A theo filter (server DESC sẵn).
    if (mode === 'detail') {
      const txFilter = {
        from, to,
        zone_ids: zoneChecks.length > 0 ? zoneChecks : undefined,
        kind: kind === 'all' ? undefined : kind,
        payment_method: method === 'all' ? undefined : method,
        search: search.trim() || undefined,
        granularity,
      };
      const tx = await callApi(
        (a) => a.listTransactions({ ...txFilter, limit: perPage, offset: (page - 1) * perPage }),
        () => mockApi.listTransactions({ ...txFilter, limit: perPage, offset: (page - 1) * perPage }),
      );
      if (!tx.ok || !tx.data) {
        setError(tx.error ?? 'Lỗi tải chi tiết giao dịch');
        setStatus('error');
        return;
      }
      setDetail(tx.data.rows);
      setDetailTotal(tx.data.total);
    }
    setStatus('ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, fromB, toB, compare, mode, zoneChecks, kind, method, search, granularity, page, perPage, invalidRange]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [from, to, zoneChecks, kind, method, search]);

  const sumA = useMemo(() => summarizeAgg(aggA), [aggA]);
  const sumB = useMemo(() => summarizeAgg(aggB), [aggB]);
  const viewDetail = useMemo(() => (asc ? [...detail].reverse() : detail), [detail, asc]);
  const maxTotal = Math.max(1, ...aggA.map((r) => r.total), ...aggB.map((r) => r.total));
  const mergedDays = useMemo(() => {
    const keys = new Set([...aggA.map((r) => r.day), ...aggB.map((r) => r.day)]);
    return [...keys].sort();
  }, [aggA, aggB]);
  const byA = useMemo(() => new Map(aggA.map((r) => [r.day, r])), [aggA]);
  const byB = useMemo(() => new Map(aggB.map((r) => [r.day, r])), [aggB]);

  const canExport = status === 'ready' && !invalidRange && sumA.revenue > 0;
  const txFilter = {
    from, to,
    zone_ids: zoneChecks.length > 0 ? zoneChecks : undefined,
    kind: kind === 'all' ? undefined : kind,
    payment_method: method === 'all' ? undefined : method,
    search: search.trim() || undefined,
  };

  async function handleExportExcel(): Promise<void> {
    setExporting('excel');
    const out = await exportTransactionsXls(txFilter, setProgress);
    setExporting(null);
    if (!out.ok) {
      pushToast('danger', `Xuất thất bại: ${out.error} — bấm Xuất Excel để thử lại.`);
      return;
    }
    pushToast('success', `Xuất xong: ${out.filename} (${out.count} dòng)`);
  }

  function handleExportPdf(): void {
    setExporting('pdf');
    const out = openSummaryPrint(txFilter, sumA, detail, detailTotal);
    setExporting(null);
    if (!out.ok) {
      pushToast('danger', out.error ?? 'Xuất PDF thất bại.');
      return;
    }
    pushToast('success', 'Đã mở bản in tổng hợp — chọn "Lưu thành PDF" ở hộp thoại in.');
  }

  const kpis: Array<{ label: string; value: string; delta: number | null; subB: string }> = [
    { label: 'Tổng doanh thu', value: formatVND(sumA.revenue), delta: compare ? deltaPct(sumA.revenue, sumB.revenue) : null, subB: `Kỳ B: ${formatVND(sumB.revenue)}` },
    { label: 'Tổng lượt xe', value: String(sumA.entries), delta: compare ? deltaPct(sumA.entries, sumB.entries) : null, subB: `Kỳ B: ${sumB.entries}` },
    { label: 'Trung bình/lượt', value: formatVND(sumA.avg), delta: compare ? deltaPct(sumA.avg, sumB.avg) : null, subB: `Kỳ B: ${formatVND(sumB.avg)}` },
    { label: 'Vé lượt', value: `${sumA.revenue === 0 ? 0 : Math.round((sumA.casual / sumA.revenue) * 100)}%`, delta: null, subB: `Kỳ A: ${formatVND(sumA.casual)}` },
    { label: 'Vé tháng', value: `${sumA.revenue === 0 ? 0 : Math.round((sumA.monthly / sumA.revenue) * 100)}%`, delta: null, subB: `Kỳ A: ${formatVND(sumA.monthly)}` },
  ];

  return (
    <div>
      <div className="toolbar">
        <div className="seg" style={{ width: 300 }} role="group" aria-label="Độ chi tiết">
          {([['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng'], ['year', 'Năm']] as Array<[Granularity, string]>).map(([g, label]) => (
            <button key={g} type="button" aria-pressed={granularity === g} onClick={() => setGranularity(g)}>{label}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Khoảng ngày kỳ A">
          {([['today', 'Hôm nay'], ['7d', '7 ngày'], ['30d', '30 ngày'], ['quarter', 'Quý'], ['year', 'Năm'], ['custom', 'Tùy chọn']] as Array<[Range, string]>).map(([r, label]) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => applyRange(r)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <span style={{ fontSize: 14, fontWeight: 600 }}>Kỳ A</span>
        <input className="input" style={{ width: 150 }} type="date" aria-label="Kỳ A từ ngày" value={from} onChange={(e) => { setFrom(e.target.value); setRange('custom'); }} />
        <input className="input" style={{ width: 150 }} type="date" aria-label="Kỳ A đến ngày" value={to} onChange={(e) => { setTo(e.target.value); setRange('custom'); }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> So sánh
        </label>
        {compare && (
          <>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Kỳ B</span>
            <input className="input" style={{ width: 150 }} type="date" aria-label="Kỳ B từ ngày" value={fromB} onChange={(e) => setFromB(e.target.value)} />
            <input className="input" style={{ width: 150 }} type="date" aria-label="Kỳ B đến ngày" value={toB} onChange={(e) => setToB(e.target.value)} />
          </>
        )}
      </div>
      {invalidRange && <Alert tone="danger">Ngày bắt đầu phải ≤ ngày kết thúc.</Alert>}
      {overlapWarn && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Hai kỳ giao nhau — Δ% có thể gây hiểu lầm.
        </div>
      )}
      {span > 90 && granularity === 'day' && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Khoảng &gt;90 ngày ở độ chi tiết Ngày — gợi ý chuyển sang Tuần.
        </div>
      )}
      {granularity === 'year' && span > 3 * 365 && span <= 5 * 365 && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          Khoảng rộng — tổng hợp có thể chậm.
        </div>
      )}
      <div className="toolbar">
        <fieldset style={{ border: '1px solid var(--color-border-strong)', borderRadius: 8, padding: '6px 10px' }}>
          <legend style={{ fontSize: 12 }}>Khu vực (bỏ chọn hết = tất cả)</legend>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {zones.map((z) => (
              <label key={z.id} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={zoneChecks.includes(z.id)}
                  onChange={(e) => setZoneChecks((prev) => (e.target.checked ? [...prev, z.id] : prev.filter((x) => x !== z.id)))}
                />
                {z.name}
              </label>
            ))}
          </div>
        </fieldset>
        <select className="select" style={{ width: 150 }} aria-label="Loại vé" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Mọi loại vé</option>
          <option value="casual">Vé lượt</option>
          <option value="monthly">Vé tháng</option>
          <option value="adjust">Điều chỉnh</option>
        </select>
        <select className="select" style={{ width: 160 }} aria-label="Phương thức" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="all">Mọi phương thức</option>
          <option value="cash">Tiền mặt</option>
          <option value="transfer">Chuyển khoản</option>
          <option value="card">Thẻ</option>
          <option value="e_wallet">Ví điện tử</option>
        </select>
        <input
          className="input input-mono"
          style={{ width: 220 }}
          type="search"
          aria-label="Tìm mã vé, biển số"
          placeholder="Tìm mã vé, biển số…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="spacer" />
        <button className="btn btn-neutral" disabled={!canExport || exporting !== null} aria-busy={exporting === 'excel'} title={canExport ? undefined : 'Không có dữ liệu để xuất'} onClick={() => void handleExportExcel()}>
          <Download size={16} strokeWidth={2} aria-hidden="true" />
          {exporting === 'excel' ? `Đang xuất ${progress}%` : 'Xuất Excel'}
        </button>
        <button className="btn btn-neutral" disabled={!canExport || exporting !== null} aria-busy={exporting === 'pdf'} title={canExport ? undefined : 'Không có dữ liệu để xuất'} onClick={handleExportPdf}>
          <Download size={16} strokeWidth={2} aria-hidden="true" />
          Xuất PDF
        </button>
      </div>

      <div className="seg" style={{ width: 280, marginBottom: 12 }} role="group" aria-label="Chế độ xem">
        <button type="button" aria-pressed={mode === 'agg'} onClick={() => setMode('agg')}>Tổng hợp</button>
        <button type="button" aria-pressed={mode === 'detail'} onClick={() => setMode('detail')}>Chi tiết</button>
      </div>

      {status === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải báo cáo nâng cao"><SkeletonRows rows={8} /></div>
      )}
      {status === 'error' && <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>}
      {status === 'ready' && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {kpis.map((k) => (
              <div className="card" key={k.label}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value mono" style={{ fontSize: 22 }}>{k.value}</div>
                {k.delta !== null && !bFailed && (
                  <div>
                    <Badge tone={k.delta >= 0 ? 'success' : 'danger'}>
                      <span aria-hidden="true">{k.delta >= 0 ? '▲' : '▼'}</span> {fmtDelta(k.delta)} vs kỳ B
                    </Badge>
                  </div>
                )}
                {k.delta !== null && bFailed && (
                  <div>
                    <Badge tone="warning">Không tải được kỳ so sánh — <button type="button" className="th-sort" onClick={() => void load()}>Thử lại</button></Badge>
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{k.subB}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>So sánh doanh thu theo ngày</h3>
            <div className="legend" aria-label="Chú thích so sánh">
              <span><span className="swatch" style={{ background: 'var(--color-primary)' }} />Kỳ A</span>
              <span><span className="swatch" style={{ background: 'var(--color-primary)', opacity: 0.35 }} />Kỳ B</span>
            </div>
            <div
              className="bar-chart"
              role="img"
              aria-label={`Kỳ A ${formatVND(sumA.revenue)}${compare && !bFailed ? ` (${fmtDelta(deltaPct(sumA.revenue, sumB.revenue))} vs kỳ B ${formatVND(sumB.revenue)})` : ''}`}
              style={{ height: 240 }}
            >
              {mergedDays.map((day) => {
                const a = byA.get(day)?.total ?? 0;
                const b = byB.get(day)?.total ?? 0;
                return (
                  <div key={day} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '100%' }}>
                    <div
                      style={{ width: '38%', height: `${Math.round((a / maxTotal) * 100)}%`, minHeight: a > 0 ? 4 : 0, background: 'var(--color-primary)' }}
                      title={`Kỳ A ${day}: ${formatVND(a)}`}
                    />
                    {compare && (
                      <div
                        style={{ width: '38%', height: `${Math.round((b / maxTotal) * 100)}%`, minHeight: b > 0 ? 4 : 0, background: 'var(--color-primary)', opacity: 0.35 }}
                        title={`Kỳ B ${day}: ${formatVND(b)}`}
                      />
                    )}
                    <span className="mono sr-only">{day}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {mode === 'detail' && (
            <ManagementReportDetail
              rows={viewDetail}
              total={detailTotal}
              page={page}
              perPage={perPage}
              asc={asc}
              onToggleSort={() => setAsc((v) => !v)}
              onPage={setPage}
              onPerPage={setPerPage}
              onClearFilter={() => { setMethod('all'); setZoneChecks([]); setSearch(''); setKind('all'); }}
            />
          )}
        </>
      )}

      <div aria-live="polite" className="sr-only">{exporting ? `Đang xuất ${progress}%` : ''}</div>
      <Toasts items={toasts} />
    </div>
  );
}
