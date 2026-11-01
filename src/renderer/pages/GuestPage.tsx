import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { ArrowLeft, Bookmark, Car, CircleUserRound, Map, ScrollText, SquareParking, Wrench } from 'lucide-react';
import { Button, Dialog, EmptyState, RetryPanel, SkeletonRows } from '../components/ui';
import { useAuth } from '../store/auth';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { MyHistoryPage } from './MyHistoryPage';
import { MyReservationsPage } from './MyReservationsPage';
import { MyVehiclesPage } from './MyVehiclesPage';
import { ProfilePage } from './ProfilePage';
import type { SpotMapCell, ZoneAvailability } from '../types';

type Status = 'loading' | 'error' | 'ready';

// Customer area P1/P2 (spec ./specs/customer-area.md §0.3): customer đăng nhập
// có tab row dưới header 56px — Sơ đồ hiện tại + Xe của tôi + Lịch sử + Hồ sơ.
// Guest ẩn danh + shell preview (admin/staff) giữ nguyên, không tabs.
type CustomerTab = 'map' | 'vehicles' | 'history' | 'reserve' | 'profile';

const CUSTOMER_TABS: Array<{ id: CustomerTab; label: string; Icon: typeof Map }> = [
  { id: 'map', label: 'Sơ đồ', Icon: Map },
  { id: 'vehicles', label: 'Xe của tôi', Icon: Car },
  { id: 'history', label: 'Lịch sử', Icon: ScrollText },
  { id: 'reserve', label: 'Đặt chỗ', Icon: Bookmark },
  { id: 'profile', label: 'Hồ sơ', Icon: CircleUserRound },
];

const POLL_MS = 30000;

interface GuestPageProps {
  /** Shell gọi khi bấm "Trở lại" (admin/staff xem Sơ đồ → về trang trước đó). */
  onBack?: () => void;
}

export function GuestPage({ onBack }: GuestPageProps = {}): JSX.Element {
  const { role, fullName, logout } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [zones, setZones] = useState<ZoneAvailability[]>([]);
  const [activeZone, setActiveZone] = useState<number | 'all'>('all');
  const [cells, setCells] = useState<SpotMapCell[]>([]);
  const [shownZoneCode, setShownZoneCode] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [kiosk, setKiosk] = useState(false);
  const timer = useRef<number | null>(null);

  // Customer tabs (§0.3) + dirty-guard cho tab Hồ sơ (§P1.4).
  const isCustomer = role === 'customer';
  const [tab, setTab] = useState<CustomerTab>('map');
  const [phone, setPhone] = useState('');
  const [profileDirty, setProfileDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<CustomerTab | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // SĐT cho empty-state "xe do quầy nhập với đúng SĐT …" — 1 lần khi vào.
  useEffect(() => {
    if (!isCustomer) return;
    let cancelled = false;
    void callApi((a) => a.myProfile(), () => mockApi.myProfile()).then((res) => {
      if (!cancelled && res.ok && res.data?.phone) setPhone(res.data.phone);
    });
    return (): void => {
      cancelled = true;
    };
  }, [isCustomer]);

  function requestTab(next: CustomerTab): void {
    // Rời tab Hồ sơ khi form dirty → confirm dialog (P1.4 dirty-guard).
    if (tab === 'profile' && profileDirty && next !== 'profile') {
      setPendingTab(next);
      return;
    }
    setTab(next);
  }

  function onTabKeyDown(e: React.KeyboardEvent): void {
    // Tab row keyboard: ←/→ (Home/End) — spec §0.3.
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const idx = CUSTOMER_TABS.findIndex((t) => t.id === tab);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % CUSTOMER_TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + CUSTOMER_TABS.length) % CUSTOMER_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = CUSTOMER_TABS.length - 1;
    const target = CUSTOMER_TABS[next];
    requestTab(target.id);
    tabRefs.current[next]?.focus();
  }

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    const zRes = await callApi((a) => a.zoneAvailability(), () => mockApi.zoneAvailability());
    if (!zRes.ok) {
      setError(zRes.error ?? 'Mất kết nối — thử lại sau');
      setStatus('error');
      setRetryIn(15);
      if (manual) setRefreshing(false);
      return;
    }
    const list = (zRes.data ?? []).filter((z) => z.is_active === 1);
    setZones(list);
    const zid = activeZone === 'all' ? list[0]?.zone_id : activeZone;
    if (zid !== undefined) {
      const cRes = await callApi((a) => a.spotMap(zid), () => mockApi.spotMap(zid));
      if (cRes.ok) {
        setCells(cRes.data ?? []);
        setShownZoneCode(list.find((z) => z.zone_id === zid)?.zone_code ?? '');
        const now = new Date();
        const p = (n: number): string => String(n).padStart(2, '0');
        setLastUpdated(`${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`);
        setSecondsAgo(0);
      }
    }
    setStatus('ready');
    if (manual) setRefreshing(false);
  }, [activeZone]);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (status !== 'error' || retryIn <= 0) return;
    const t = window.setInterval(() => {
      setRetryIn((v) => {
        if (v <= 1) {
          window.clearInterval(t);
          void load();
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [status, retryIn, load]);

  const totals = zones.reduce(
    (s, z) => ({ free: s.free + z.free_spots, cap: s.cap + z.capacity }),
    { free: 0, cap: 0 },
  );
  const allFull = zones.length > 0 && totals.free === 0;

  // FE-006: admin/staff mở Sơ đồ từ nav → về shell qua onBack;
  // role guest (chưa login) → logout về màn Login/chọn vai trò.
  const handleBack = useCallback((): void => {
    if (onBack) {
      onBack();
      return;
    }
    if (role === 'guest') logout();
  }, [onBack, role, logout]);

  // FE-016 P4: 'reserved' = ô đang giữ chỗ (Warning) — KHÔNG lẫn 'maintenance'.
  const slotLabel = (c: SpotMapCell): string =>
    c.status === 'available'
      ? `${c.spot_number}: trống`
      : c.status === 'occupied'
        ? `${c.spot_number}: đang đỗ`
        : c.status === 'reserved'
          ? `${c.spot_number}: đang giữ chỗ`
          : `${c.spot_number}: bảo trì`;

  const slotClass = (c: SpotMapCell): string =>
    c.status === 'available'
      ? 'slot-free'
      : c.status === 'occupied'
        ? 'slot-occupied'
        : c.status === 'reserved'
          ? 'slot-reserved'
          : 'slot-maintenance';

  return (
    <div className="guest-root">
      <header className="topbar" style={{ position: 'sticky', top: 0 }}>
        <span className="guest-logo"><SquareParking size={20} strokeWidth={2} aria-hidden="true" /> BãiXe</span>
        <span className="topbar-title">Sơ đồ chỗ trống</span>
        <div className="topbar-right">
          {/* FE-012 (spec auth-flow.md §6): logged-in customer has NO "Trở lại" —
              "Đăng xuất" doubles as the way back to Login. Anonymous guest and
              shell preview keep the existing back behavior. */}
          {role === 'customer' ? (
            <>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{fullName}</span>
              <button className="btn btn-neutral btn-sm" onClick={logout}>
                Đăng xuất
              </button>
            </>
          ) : (
            <button className="btn btn-neutral btn-sm" onClick={handleBack} aria-label="Trở lại giao diện chính">
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" /> Trở lại
            </button>
          )}
          <span className="mono" style={{ fontSize: 14 }} aria-label="Giờ hiện tại">{lastUpdated || '--:--:--'}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Tự động làm mới 30s</span>
          <button className="btn btn-neutral btn-sm" onClick={() => void load(true)} disabled={refreshing} aria-busy={refreshing}>
            {refreshing ? 'Đang mới…' : 'Làm mới'}
          </button>
          <button className="btn btn-ghost btn-sm" aria-pressed={kiosk} onClick={() => setKiosk((v) => !v)} title="Chế độ kiosk tương phản cao">
            {kiosk ? 'Kiosk: Bật' : 'Kiosk: Tắt'}
          </button>
        </div>
      </header>

      {isCustomer && (
        <nav aria-label="Khu vực khách hàng" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', padding: '8px 24px 0' }}>
          <div className="tabs" role="tablist" aria-label="Khu vực khách hàng" onKeyDown={onTabKeyDown} style={{ marginBottom: 8 }}>
            {CUSTOMER_TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-current={tab === t.id ? 'page' : undefined}
                tabIndex={tab === t.id ? 0 : -1}
                className="tab"
                style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => requestTab(t.id)}
              >
                <t.Icon size={16} strokeWidth={2} aria-hidden="true" />
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <main className="content" style={{ fontSize: kiosk ? 16 : undefined }}>
        {isCustomer && tab === 'vehicles' && <MyVehiclesPage phone={phone} onGoMap={() => requestTab('map')} />}
        {isCustomer && tab === 'history' && <MyHistoryPage />}
        {isCustomer && tab === 'reserve' && <MyReservationsPage />}
        {isCustomer && tab === 'profile' && <ProfilePage onDirtyChange={setProfileDirty} />}
        {(!isCustomer || tab === 'map') && (
        <>
        {status === 'loading' && (
          <div aria-busy="true" aria-label="Đang tải sơ đồ">
            <div className="skeleton" style={{ height: 36, width: 300, marginBottom: 16 }} />
            <SkeletonRows rows={6} height={40} />
          </div>
        )}

        {status === 'error' && (
          <div className="card">
            <RetryPanel message={`${error} (tự thử lại sau ${retryIn}s)`} onRetry={() => void load(true)} />
          </div>
        )}

        {status === 'ready' && (
          <>
            {allFull && (
              <div className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}>
                Tất cả các khu đã đầy — vui lòng quay lại sau hoặc liên hệ quầy. Gợi ý: khu vực lân cận còn chỗ trong 15 phút tới.
              </div>
            )}
            <div className="zone-chips" role="group" aria-label="Chọn khu vực">
              <button className="chip" aria-pressed={activeZone === 'all'} onClick={() => setActiveZone('all')}>Tất cả</button>
              {zones.map((z) => (
                <button
                  key={z.zone_id}
                  className="chip"
                  aria-pressed={activeZone === z.zone_id || (activeZone === 'all' && zones[0]?.zone_id === z.zone_id)}
                  onClick={() => setActiveZone(z.zone_id)}
                >
                  Khu {z.zone_code} · còn {z.free_spots}
                </button>
              ))}
            </div>

            <div className="legend" aria-label="Chú thích">
              <span><span className="swatch" style={{ background: 'var(--color-success-tint)', border: '1px solid var(--color-success)' }} />trống</span>
              <span><span className="swatch" style={{ background: 'var(--color-primary)' }} />đang đỗ</span>
              <span><span className="swatch" style={{ background: 'var(--color-warning-tint)', border: '1px solid var(--color-warning)' }} />đang giữ</span>
              <span><span className="swatch" style={{ background: 'repeating-linear-gradient(45deg, var(--color-surface), var(--color-surface) 2px, var(--color-bg) 2px, var(--color-bg) 4px)', border: '1px solid var(--color-border-strong)' }} />bảo trì</span>
            </div>

            {cells.length === 0 ? (
              <div className="card">
                <EmptyState title="Chưa có dữ liệu ô đỗ" hint="Khu vực này chưa khởi tạo sơ đồ ô đỗ." />
              </div>
            ) : (
              <div className="card">
                <div className="slot-grid" role="grid" aria-label={`Sơ đồ khu ${shownZoneCode}`}>
                  {cells.map((c) => (
                    <div
                      key={c.spot_id}
                      role="gridcell"
                      aria-label={slotLabel(c)}
                      aria-disabled={c.status !== 'available'}
                      tabIndex={c.status === 'available' ? 0 : -1}
                      className={`slot ${slotClass(c)}`}
                      style={kiosk ? { borderWidth: 3, fontSize: 13 } : undefined}
                      title={slotLabel(c)}
                    >
                      {c.status === 'maintenance' ? <Wrench size={14} strokeWidth={2} aria-hidden="true" /> : (c.occupying_plate ?? c.spot_number)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: 14 }} aria-live="polite" aria-atomic="true">
              Còn <strong className="mono">{totals.free}/{totals.cap}</strong>
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }} aria-hidden="true">
              Cập nhật {secondsAgo}s trước
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Màn hình chỉ xem — vui lòng liên hệ quầy để gửi xe.</p>
          </>
        )}

        <div style={{ marginTop: 16 }}>
          <Button variant="ghost" onClick={() => void load(true)}>Tải lại sơ đồ</Button>
        </div>
        </>
        )}
      </main>

      {pendingTab !== null && (
        <Dialog
          title="Thay đổi chưa lưu"
          label="Thay đổi chưa lưu"
          onClose={() => setPendingTab(null)}
        >
          <p style={{ fontSize: 14, color: 'var(--color-text-60)', margin: '0 0 16px' }}>
            Hồ sơ của bạn có thay đổi chưa lưu. Rời đi sẽ mất các thay đổi này.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="neutral" onClick={() => setPendingTab(null)}>Ở lại</Button>
            <Button
              variant="danger"
              onClick={() => {
                setProfileDirty(false);
                setTab(pendingTab);
                setPendingTab(null);
              }}
            >
              Rời đi
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
