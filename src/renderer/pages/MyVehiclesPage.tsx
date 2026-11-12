import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Car } from 'lucide-react';
import { Alert, Badge, Button, Dialog, EmptyState, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { useAuth } from '../store/auth';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateTime, formatVND, normalizePlate } from '../lib/format';
import { BuyPassDialog } from './BuyPassDialog';
import { NotifyFallbackBanner, NotifyRationaleDialog } from '../components/NotifyBanner';
import { shouldShowNotifyRationale } from '../lib/notify';
import type { CustomerSessionRow, CustomerVehicle, MonthlyPass, ParkingZone } from '../types';

type Status = 'loading' | 'error' | 'ready';
type TypeFilter = 'all' | 'car' | 'motorbike';

const TYPE_LABEL: Record<string, string> = { car: 'Ô tô', motorbike: 'Xe máy' };

interface MyVehiclesPageProps {
  phone: string;
  onGoMap: () => void;
}

export function MyVehiclesPage({ phone, onGoMap, highlightPassCode = null }: MyVehiclesPageProps & { highlightPassCode?: string | null }): JSX.Element {
  const { logout } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  // "Khu gần nhất" — frontend-join từ lượt gửi mới nhất (backend P2 không trả
  // zone cho vehicle; không phát minh cột mới — tái dùng customer:sessions).
  const [latestZone, setLatestZone] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [detail, setDetail] = useState<CustomerVehicle | null>(null);
  const [recent, setRecent] = useState<CustomerSessionRow[]>([]);
  // FE-014 (customer P3): zones cho dialog mua vé + vé pending ("Chờ xác nhận").
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const [pending, setPending] = useState<MonthlyPass[]>([]);
  const [buyTarget, setBuyTarget] = useState<CustomerVehicle | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MonthlyPass | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // FE-025 (spec §5.1): rationale sau đăng ký vé thành công đầu tiên (tối đa 2 lần).
  const [rationale, setRationale] = useState(false);
  const toastSeq = useRef(1);
  const rowTrigger = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string): void => {
    const id = toastSeq.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setForbidden(false);
    const [vRes, sRes, zRes, pRes] = await Promise.all([
      callApi((a) => a.customerVehicles(), () => mockApi.customerVehicles()),
      callApi((a) => a.customerSessions({ limit: 100 }), () => mockApi.customerSessions({ limit: 100 })),
      callApi((a) => a.listZones(), () => mockApi.listZones()),
      callApi((a) => a.myPendingPasses(), () => mockApi.myPendingPasses()),
    ]);
    if (!vRes.ok) {
      if (/quyền|forbidden|đăng nhập|liên kết/i.test(vRes.error ?? '')) setForbidden(true);
      setError(vRes.error ?? 'Không tải được danh sách xe');
      setStatus('error');
      return;
    }
    setVehicles(vRes.data?.vehicles ?? []);
    setTotalSpent(vRes.data?.total_spent ?? 0);
    const zones: Record<string, string> = {};
    for (const r of sRes.ok ? (sRes.data?.rows ?? []) : []) {
      // rows đã ORDER BY check_in_at DESC — gặp đầu tiên = mới nhất.
      if (!(r.license_plate in zones)) {
        zones[r.license_plate] = r.zone_code ? `Khu ${r.zone_code}` : '—';
      }
    }
    setLatestZone(zones);
    if (zRes.ok) setZones((zRes.data ?? []).filter((z) => z.is_active === 1));
    // Vé pending: backend chưa có IPC list (đọc store local) nên lỗi ở đây
    // không chặn màn hình — chỉ ẩn badge, vẫn cho đăng ký mới.
    if (pRes.ok) setPending(pRes.data ?? []);
    setStatus('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // FE-025: deep-link E1 (tab passes customer) — scroll tới alert vé sau khi render.
  useEffect(() => {
    if (!highlightPassCode) return;
    const el = document.querySelector(`[data-pass-code="${highlightPassCode}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [highlightPassCode, pending]);

  // Drawer a11y: Esc đóng + focus nút đóng khi mở + trả focus về row + khóa scroll nền.
  useEffect(() => {
    if (!detail) return;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDetail(null);
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (rowTrigger.current) rowTrigger.current.focus();
    };
  }, [detail]);

  function openDetail(v: CustomerVehicle, trigger: HTMLElement): void {
    rowTrigger.current = trigger;
    setDetail(v);
    // 5 lượt gửi gần nhất của xe này (tái dùng customer:sessions + search).
    void (async () => {
      const res = await callApi(
        (a) => a.customerSessions({ search: v.license_plate, limit: 5 }),
        () => mockApi.customerSessions({ search: v.license_plate, limit: 5 }),
      );
      if (res.ok) setRecent(res.data?.rows ?? []);
    })();
  }

  const q = normalizePlate(search);
  const filtered = vehicles.filter((v) => {
    if (typeFilter !== 'all' && v.vehicle_type !== typeFilter) return false;
    if (q && !v.license_plate.toUpperCase().includes(q)) return false;
    return true;
  });

  // FE-014: vé pending theo xe (badge "Chờ xác nhận" + nút Hủy đăng ký).
  const pendingByVehicle = new Map<number, MonthlyPass>();
  for (const p of pending) {
    if (!pendingByVehicle.has(p.vehicle_id)) pendingByVehicle.set(p.vehicle_id, p);
  }

  async function handleCancelPending(): Promise<void> {
    if (!cancelTarget) return;
    setCancelBusy(true);
    const res = await callApi(
      (a) => a.cancelPass(cancelTarget.pass_code, 'Khách hủy đăng ký'),
      () => mockApi.cancelPass(cancelTarget.pass_code),
    );
    setCancelBusy(false);
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Hủy đăng ký thất bại');
      return;
    }
    setCancelTarget(null);
    pushToast('success', `Đã hủy đăng ký vé ${cancelTarget.pass_code}.`);
    void load();
  }

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Đang tải xe của tôi">
        <div className="toolbar">
          <div className="skeleton" style={{ height: 40, width: 240 }} />
          <div className="skeleton" style={{ height: 40, width: 160 }} />
        </div>
        <div className="card"><SkeletonRows rows={6} height={40} /></div>
      </div>
    );
  }

  if (status === 'error') {
    return (
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
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Bạn chưa có xe nào"
          hint={`Xe do quầy nhập với đúng SĐT ${phone || 'của bạn'} sẽ tự hiện ở đây.`}
          action={<Button variant="neutral" onClick={onGoMap}>Xem Sơ đồ</Button>}
        />
      </div>
    );
  }

  return (
    <div>
      {/* FE-025 (spec §5.2): banner fallback khi toast bị chặn/tắt (E1 vé sắp hết). */}
      <NotifyFallbackBanner surface="passes" />
      {/* FE-014: vé đang chờ xác nhận — banner info + nút Hủy đăng ký. */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.map((p) => (
            <div
              key={p.pass_code}
              data-pass-code={p.pass_code}
              style={highlightPassCode === p.pass_code ? { outline: '2px solid var(--color-primary)', outlineOffset: 2, borderRadius: 8 } : undefined}
            >
            <Alert tone="warning">
              <span>
                Đã gửi đăng ký <strong className="mono">{p.pass_code}</strong> — mang{' '}
                <strong className="mono">{formatVND(p.price)}</strong> ra quầy để kích hoạt.
              </span>{' '}
              <button
                type="button"
                className="btn btn-neutral btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => setCancelTarget(p)}
                aria-label={`Hủy đăng ký vé ${p.pass_code}`}
              >
                Hủy đăng ký
              </button>
            </Alert>
            </div>
          ))}
        </div>
      )}
      <div className="toolbar">
        <span role="search">
          <input
            id="global-search"
            className="input input-mono search-input"
            type="search"
            aria-label="Tìm biển số xe"
            placeholder="Tìm biển số…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </span>
        <select
          className="select"
          style={{ width: 160 }}
          aria-label="Loại xe"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
        >
          <option value="all">Tất cả loại xe</option>
          <option value="car">Ô tô</option>
          <option value="motorbike">Xe máy</option>
        </select>
        <span className="spacer" />
        <span className="mono" style={{ fontSize: 14 }} aria-label={`Tổng tiền đã gửi: ${formatVND(totalSpent)}`}>
          Tổng đã gửi: <strong>{formatVND(totalSpent)}</strong>
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Không tìm thấy xe"
            hint="Thử từ khóa hoặc bộ lọc loại xe khác."
            action={(
              <Button
                variant="neutral"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('all');
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <caption className="sr-only">Xe của tôi — {filtered.length} xe</caption>
            <thead>
              <tr>
                <th scope="col">Biển số</th>
                <th scope="col">Loại</th>
                <th scope="col">Khu gần nhất</th>
                <th scope="col">Lượt gửi</th>
                <th scope="col">Tổng tiền</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Vé tháng</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  aria-label={`Xe ${v.license_plate} — nhấn Enter để xem chi tiết`}
                  onClick={(e) => openDetail(v, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDetail(v, e.currentTarget);
                    }
                  }}
                >
                  <td className="mono" style={{ fontSize: 14, textTransform: 'uppercase' }}>{v.license_plate}</td>
                  <td>{TYPE_LABEL[v.vehicle_type] ?? v.vehicle_type}</td>
                  <td>{latestZone[v.license_plate] ?? '—'}</td>
                  <td className="mono">{v.session_count}</td>
                  <td className="mono">{formatVND(v.total_spent)}</td>
                  <td>
                    {v.is_parked === 1 ? (
                      <Badge tone="primary">Đang đỗ</Badge>
                    ) : (
                      <Badge tone="muted">Đang trống</Badge>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {pendingByVehicle.get(v.id) ? (
                      <Badge tone="warning">Chờ xác nhận</Badge>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-neutral btn-sm"
                        onClick={(e) => {
                          setBuyTarget(v);
                          rowTrigger.current = e.currentTarget;
                        }}
                        aria-label={`Mua vé tháng cho xe ${v.license_plate}`}
                      >
                        Mua vé tháng
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="drawer" role="dialog" aria-modal="false" aria-label={`Chi tiết xe ${detail.license_plate}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Car size={16} strokeWidth={2} aria-hidden="true" />
            <h2 className="mono" style={{ margin: 0, fontSize: 16, textTransform: 'uppercase' }}>{detail.license_plate}</h2>
            <span style={{ flex: 1 }} />
            <button ref={closeBtnRef} className="btn btn-neutral btn-sm" onClick={() => setDetail(null)} aria-label="Đóng chi tiết xe">
              Đóng
            </button>
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: 14, margin: '0 0 16px' }}>
            <dt style={{ color: 'var(--color-text-60)' }}>Loại xe</dt>
            <dd style={{ margin: 0 }}>{TYPE_LABEL[detail.vehicle_type] ?? detail.vehicle_type}</dd>
            <dt style={{ color: 'var(--color-text-60)' }}>Trạng thái</dt>
            <dd style={{ margin: 0 }}>
              {detail.is_parked === 1 ? <Badge tone="primary">Đang đỗ</Badge> : <Badge tone="muted">Đang trống</Badge>}
            </dd>
            <dt style={{ color: 'var(--color-text-60)' }}>Vé tháng</dt>
            <dd style={{ margin: 0 }}>
              {pendingByVehicle.get(detail.id) ? (
                <Badge tone="warning">Chờ xác nhận</Badge>
              ) : (
                'Chưa có vé'
              )}
            </dd>
            <dt style={{ color: 'var(--color-text-60)' }}>Lượt gửi</dt>
            <dd className="mono" style={{ margin: 0 }}>{detail.session_count}</dd>
            <dt style={{ color: 'var(--color-text-60)' }}>Tổng tiền</dt>
            <dd className="mono" style={{ margin: 0 }}>{formatVND(detail.total_spent)}</dd>
          </dl>
          <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>5 lượt gửi gần nhất</h3>
          {recent.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Chưa có lượt gửi nào.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recent.map((r) => (
                <li key={r.ticket_code} className="receipt">
                  <div className="row">
                    <span className="mono" style={{ fontSize: 12 }}>{r.ticket_code}</span>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {r.is_monthly === 1 ? 'Vé tháng (0₫)' : r.total_fee !== null ? formatVND(r.total_fee) : 'Đang đỗ'}
                    </span>
                  </div>
                  <div className="row" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>
                    <span>Vào {formatDateTime(r.check_in_at)}</span>
                    <span>{r.check_out_at ? `Ra ${formatDateTime(r.check_out_at)}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {buyTarget && (
        <BuyPassDialog
          vehicle={buyTarget}
          zones={zones}
          onClose={() => setBuyTarget(null)}
          onSuccess={(pass) => {
            setBuyTarget(null);
            pushToast('success', `Đã gửi đăng ký ${pass.pass_code} — mang ${formatVND(pass.price)} ra quầy để kích hoạt.`);
            if (shouldShowNotifyRationale()) setRationale(true);
            void load();
          }}
        />
      )}

      {cancelTarget && (
        <Dialog title={`Hủy đăng ký vé ${cancelTarget.pass_code}?`} onClose={() => setCancelTarget(null)} label="Xác nhận hủy đăng ký vé tháng">
          <p style={{ fontSize: 14, color: 'var(--color-text-60)', margin: '0 0 16px' }}>
            Đăng ký đang chờ xác nhận sẽ bị hủy. Bạn có thể đăng ký lại bất cứ lúc nào.
          </p>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setCancelTarget(null)}>Giữ đăng ký</button>
            <button className="btn btn-danger" onClick={() => void handleCancelPending()} disabled={cancelBusy} aria-busy={cancelBusy}>
              {cancelBusy ? 'Đang hủy…' : 'Xác nhận hủy'}
            </button>
          </div>
        </Dialog>
      )}

      <Toasts items={toasts} />

      {/* FE-025 (spec §5.1): rationale sau đăng ký vé thành công đầu tiên. */}
      {rationale && (
        <NotifyRationaleDialog
          trigger="pass"
          onDone={(granted) => {
            setRationale(false);
            if (granted) pushToast('success', 'Đã bật thông báo.');
          }}
        />
      )}
    </div>
  );
}
