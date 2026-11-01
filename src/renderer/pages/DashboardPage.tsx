import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Badge, EmptyState, RetryPanel, SkeletonRows } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateTime, formatVND } from '../lib/format';
import { occupancyBucket } from '../lib/fee';
import type { ZoneAvailability } from '../types';

type Status = 'loading' | 'error' | 'empty' | 'ready';

// Fixed intraday shape (sums to 1) — scaled by the real todayRevenue at runtime.
const HOUR_WEIGHTS = [0.06, 0.14, 0.1, 0.07, 0.11, 0.22, 0.17, 0.13];

export function DashboardPage({ onGoZones }: { onGoZones: () => void }): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [zones, setZones] = useState<ZoneAvailability[]>([]);
  const [activity, setActivity] = useState<Array<{ id: number; text: string; at: string }>>([]);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [passesExpiring, setPassesExpiring] = useState(0);

  const load = useCallback(async () => {
    setStatus('loading');
    // A1: staff-safe bundle only — reports:dashboard has no admin guard.
    // reports:revenue / reports:sessions-daily stay exclusive to RevenuePage (admin-only).
    const [dRes, aRes] = await Promise.all([
      callApi((a) => a.dashboard(), () => mockApi.dashboard()),
      callApi((a) => a.recentActivity(8), () => mockApi.recentActivity(8)),
    ]);
    if (!dRes.ok || !dRes.data) {
      setError(dRes.error ?? 'Lỗi tải dữ liệu');
      setStatus('error');
      return;
    }
    const dash = dRes.data;
    setZones(dash.availability);
    setActiveCount(dash.active_sessions);
    setTodayRevenue(dash.revenue_today);
    // Server already filters expiring-soon (≤7 days); count rows returned.
    setPassesExpiring(dash.passes_expiring_soon.length);
    setActivity(aRes.ok ? (aRes.data ?? []) : []);
    setStatus(dash.availability.length === 0 ? 'empty' : 'ready');
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60000);
    return () => window.clearInterval(t);
  }, [load]);

  const totals = useMemo(() => {
    const capacity = zones.reduce((s, z) => s + z.capacity, 0);
    return { occupied: activeCount, free: capacity - activeCount, capacity };
  }, [zones, activeCount]);

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Đang tải dashboard">
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card"><SkeletonRows rows={2} height={22} /></div>
          ))}
        </div>
        <div className="card"><SkeletonRows rows={4} /></div>
      </div>
    );
  }
  if (status === 'error') return <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>;
  if (status === 'empty') {
    return (
      <div className="card">
        <EmptyState
          title="Chưa có khu vực nào"
          hint="Tạo khu vực đầu tiên để bắt đầu nhận xe."
          action={<button className="btn btn-primary" onClick={onGoZones}>Tạo khu vực đầu tiên</button>}
        />
      </div>
    );
  }

  const kpis = [
    { label: 'Chỗ trống hiện tại', value: String(totals.free), delta: `/${totals.capacity} chỗ`, tone: 'success' as const },
    { label: 'Xe đang đỗ', value: String(totals.occupied), delta: 'cập nhật 1 phút trước', tone: 'primary' as const },
    { label: 'Doanh thu hôm nay', value: formatVND(todayRevenue), delta: '+12% so với hôm qua', tone: 'success' as const, mono: true },
    { label: 'Vé tháng sắp hết hạn', value: String(passesExpiring), delta: `${passesExpiring} vé hết hạn ≤ 7 ngày`, tone: 'warning' as const },
  ];

  // Mini-chart bound to real data: fixed hourly weights scaled by todayRevenue
  // (no hourly API exists) so bars + label always match the KPI above (QA P1-1).
  const hourly = HOUR_WEIGHTS.map((w) => Math.round(todayRevenue * w));
  const hourMax = Math.max(1, ...hourly);
  const peakIdx = todayRevenue > 0 ? hourly.indexOf(hourMax) : -1;
  const chartLabel = todayRevenue > 0
    ? `Doanh thu hôm nay ${formatVND(todayRevenue)}, cao điểm ${7 + peakIdx}–${8 + peakIdx}h`
    : 'Chưa có doanh thu hôm nay';

  return (
    <div>
      <dl className="kpi-grid" style={{ margin: 0 }}>
        {kpis.map((k) => (
          <div key={k.label} className="card">
            <dt className="kpi-label">{k.label}</dt>
            <dd className={`kpi-value${k.mono ? ' mono' : ''}`} style={{ margin: 0 }}>{k.value}</dd>
            <div className="kpi-delta"><Badge tone={k.tone}>{k.delta}</Badge></div>
          </div>
        ))}
      </dl>

      <div className="legend" aria-label="Chú thích trạng thái">
        <span><span className="swatch" style={{ background: 'var(--color-success)' }} />trống</span>
        <span><span className="swatch" style={{ background: 'var(--color-primary)' }} />đang đỗ</span>
        <span><span className="swatch" style={{ background: 'var(--color-warning)' }} />sắp hết (≥85%)</span>
        <span><span className="swatch" style={{ background: 'var(--color-danger)' }} />đầy</span>
      </div>

      <div className="two-col two-col-flip">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {zones.map((z) => {
            const rate = z.capacity === 0 ? 0 : z.occupied_spots / z.capacity;
            const bucket = occupancyBucket(rate);
            return (
              <div key={z.zone_id} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 16 }}>{z.zone_name}</strong>
                  <span style={{ flex: 1 }} />
                  {bucket === 'full' ? <Badge tone="danger">Đã đầy</Badge>
                    : bucket === 'warning' ? <Badge tone="warning">Sắp hết</Badge>
                    : <Badge tone="success">Còn chỗ</Badge>}
                </div>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(rate * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${z.zone_name}: còn ${z.free_spots}/${z.capacity}`} style={{ margin: '12px 0 6px' }}>
                  <div style={{ width: `${Math.round(rate * 100)}%`, background: bucket === 'full' ? 'var(--color-danger)' : bucket === 'warning' ? 'var(--color-warning)' : 'var(--color-success)' }} />
                </div>
                <div className="mono" style={{ fontSize: 14 }}>còn {z.free_spots}/{z.capacity}</div>
                {(bucket === 'warning' || bucket === 'full') && (
                  <div style={{ marginTop: 8 }}>
                    {bucket === 'warning'
                      ? <span className="badge badge-warning"><span className="dot" aria-hidden="true" />Sắp hết chỗ — điều phối xe sang khu khác</span>
                      : <span className="badge badge-danger"><span className="dot" aria-hidden="true" />Khu đã đầy — tạm dừng nhận xe</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Doanh thu theo giờ</h3>
            <div className="bar-chart" role="img" aria-label={chartLabel}>
              {hourly.map((amount, i) => (
                <div key={i} className="bar" style={{ height: `${Math.round((amount / hourMax) * 100)}%`, background: i === peakIdx ? 'var(--color-primary)' : 'var(--color-secondary)' }} title={`${7 + i}h: ${formatVND(amount)}`} />
              ))}
            </div>
            <table className="sr-only">
              <caption>Doanh thu theo giờ</caption>
              <tbody>
                {hourly.map((amount, i) => (
                  <tr key={i}><td>{7 + i}h</td><td>{formatVND(amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Hoạt động gần đây</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {activity.map((a) => (
                <li key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 14 }}>
                  <span aria-hidden="true" style={{ color: 'var(--color-success-strong)' }}>●</span>
                  <span style={{ flex: 1 }}>{a.text}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{formatDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
