import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { allPassPlates, lookupPassPlate } from '../lib/api';
import { mockApi, mockPassPlates } from '../lib/mockApi';
import { formatDateShort, formatVND, isValidVNPhone, todayLocal } from '../lib/format';
import type { MonthlyPass, ParkingZone, PassStatus, PaymentMethod, VehicleType } from '../types';
import { NotifyFallbackBanner } from '../components/NotifyBanner';

type Status = 'loading' | 'error' | 'ready';

const PACKS = [1, 3, 6, 12] as const;
type PackMonths = (typeof PACKS)[number];
const BASE_MONTHLY = 300000;

function passTone(p: MonthlyPass, daysLeft: number): 'success' | 'warning' | 'danger' | 'muted' {
  if (p.status === 'pending') return 'warning';
  if (p.status === 'cancelled' || p.status === 'suspended') return 'muted';
  if (p.status === 'expired' || daysLeft < 0) return 'danger';
  if (daysLeft <= 7) return 'warning';
  return 'success';
}

function passLabel(p: MonthlyPass, daysLeft: number): string {
  if (p.status === 'pending') return 'Chờ xác nhận';
  if (p.status === 'cancelled') return 'Đã hủy';
  if (p.status === 'suspended') return 'Tạm khóa';
  if (p.status === 'expired' || daysLeft < 0) return 'Hết hạn';
  if (daysLeft <= 7) return `Sắp hết (${daysLeft} ngày)`;
  return 'Còn hạn';
}

function daysUntil(endDate: string): number {
  const diff = new Date(endDate).getTime() - new Date(todayLocal()).getTime();
  return Math.round(diff / 86400000);
}

function addDays(yyyyMmDd: string, n: number): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Spec §e: renew starts at max(today, expiry + 1 day) — never in the past.
function renewStart(expiry: string): string {
  const today = todayLocal();
  return expiry <= today ? addDays(today, 1) : addDays(expiry, 1);
}

let toastSeq = 200;

export function PassesPage({ highlightPassCode = null }: { highlightPassCode?: string | null } = {}): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [passes, setPasses] = useState<MonthlyPass[]>([]);
  const [plates, setPlates] = useState<Record<string, string>>(mockPassPlates());
  const [query, setQuery] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  // FE-014 (staff P3): lọc theo trạng thái — tab "Chờ xác nhận" duyệt vé
  // customer đăng ký (passes:confirm: pending → active/cancelled).
  const [statusFilter, setStatusFilter] = useState<'all' | PassStatus>('all');
  const [approveTarget, setApproveTarget] = useState<MonthlyPass | null>(null);
  const [rejectTarget, setRejectTarget] = useState<MonthlyPass | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [rejectReason, setRejectReason] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [detail, setDetail] = useState<MonthlyPass | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState<MonthlyPass | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MonthlyPass | null>(null);
  const [cancelReason, setCancelReason] = useState('Xe bán / đổi chủ');

  // form fields
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('motorbike');
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const [months, setMonths] = useState<PackMonths>(1);
  const [startDate, setStartDate] = useState(todayLocal());
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Drawer a11y (spec §e): Esc closes + focus returns to the row trigger.
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTrigger = useRef<Element | null>(null);
  const drawerOpen = detail !== null;
  useEffect(() => {
    if (!drawerOpen) return;
    drawerTrigger.current = document.activeElement;
    drawerCloseRef.current?.focus();
    // Scroll-lock nền khi drawer mở (spec ui-fixes-001 §C2.5).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDetail(null);
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (drawerTrigger.current instanceof HTMLElement) drawerTrigger.current.focus();
    };
  }, [drawerOpen]);

  const load = useCallback(async () => {
    setStatus('loading');
    const [pRes, zRes] = await Promise.all([
      callApi((a) => a.listPasses(), () => mockApi.listPasses()),
      callApi((a) => a.listZones(), () => mockApi.listZones()),
    ]);
    if (!pRes.ok) {
      setError(pRes.error ?? 'Lỗi tải vé tháng');
      setStatus('error');
      return;
    }
    setPasses(pRes.data ?? []);
    if (zRes.ok) setZones((zRes.data ?? []).filter((z) => z.is_active === 1));
    // Merge plates learned via backend (localStorage cache) over mock seeds.
    setPlates({ ...mockPassPlates(), ...allPassPlates() });
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return passes.filter((p) => {
      const plate = plates[p.pass_code] ?? lookupPassPlate(p.pass_code) ?? '';
      if (q && !`${p.pass_code} ${p.customer_name} ${plate.toLowerCase()}`.includes(q)) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (expiringOnly) {
        const d = daysUntil(p.end_date);
        if (!(p.status === 'active' && d >= 0 && d <= 7)) return false;
      }
      return true;
    });
  }, [passes, query, expiringOnly, statusFilter, plates]);

  const pendingCount = useMemo(() => passes.filter((p) => p.status === 'pending').length, [passes]);

  // FE-025: deep-link E1 — scroll tới row vé sau khi rows render (filter có thể
  // ẩn vé; row-flash chỉ áp khi row hiển thị — user bỏ filter để thấy).
  useEffect(() => {
    if (!highlightPassCode) return;
    const el = document.querySelector(`[data-pass-code="${highlightPassCode}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [highlightPassCode, rows]);

  const total = months === 12 ? Math.round(BASE_MONTHLY * months * 0.9) : BASE_MONTHLY * months;

  function openCreate(): void {
    setRenewTarget(null);
    setCustomerName('');
    setCustomerPhone('');
    setPlate('');
    setVehicleType('motorbike');
    setZoneId(null);
    setMonths(1);
    setStartDate(todayLocal());
    setFormError(null);
    setFormOpen(true);
  }

  function openRenew(p: MonthlyPass): void {
    setRenewTarget(p);
    setCustomerName(p.customer_name);
    setCustomerPhone(p.customer_phone);
    setPlate(plates[p.pass_code] ?? lookupPassPlate(p.pass_code) ?? '');
    setZoneId(p.zone_id);
    setMonths(1);
    setStartDate(renewStart(p.end_date));
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    if (!customerName.trim()) {
      setFormError('Chủ xe là bắt buộc');
      return;
    }
    if (!isValidVNPhone(customerPhone)) {
      setFormError('SĐT chưa đúng — VD 0901234567 (10 số, bắt đầu bằng 0)');
      return;
    }
    if (plate.trim().length < 4) {
      setFormError('Biển số tối thiểu 4 ký tự');
      return;
    }
    setBusy(true);
    const res = renewTarget
      ? await callApi((a) => a.renewPass(renewTarget.pass_code, months), () => mockApi.renewPass(renewTarget.pass_code, months))
      : await callApi(
          (a) => a.createPass({ customer_name: customerName.trim(), customer_phone: customerPhone.trim(), license_plate: plate.trim().toUpperCase(), vehicle_type: vehicleType, zone_id: zoneId, months, start_date: startDate }),
          () => mockApi.createPass({ customer_name: customerName.trim(), customer_phone: customerPhone.trim(), license_plate: plate.trim().toUpperCase(), vehicle_type: vehicleType, zone_id: zoneId, months, start_date: startDate }),
        );
    setBusy(false);
    if (!res.ok) {
      setFormError(res.error ?? 'Lưu vé thất bại');
      return;
    }
    setFormOpen(false);
    pushToast('success', renewTarget ? `Đã gia hạn vé ${renewTarget.pass_code}` : `Đã bán vé mới ${typeof res.data !== 'undefined' && res.data && 'pass_code' in res.data ? (res.data as MonthlyPass).pass_code : ''}`);
    void load();
  }

  async function handleCancel(): Promise<void> {
    if (!cancelTarget) return;
    const res = await callApi((a) => a.cancelPass(cancelTarget.pass_code, cancelReason), () => mockApi.cancelPass(cancelTarget.pass_code));
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Hủy vé thất bại');
      return;
    }
    setCancelTarget(null);
    pushToast('success', `Đã hủy vé ${cancelTarget.pass_code} — lý do: ${cancelReason}`);
    void load();
  }

  // FE-014: staff duyệt/từ chối vé pending (passes:confirm). Approve thu tiền
  // tại quầy (payment_method) trong cùng transaction backend; reject echo lý
  // do vào message (KHÔNG persist — cùng quy ước passes:cancel).
  async function handleConfirm(action: 'approve' | 'reject'): Promise<void> {
    const target = action === 'approve' ? approveTarget : rejectTarget;
    if (!target) return;
    if (action === 'reject' && !rejectReason.trim()) {
      pushToast('danger', 'Vui lòng nhập lý do từ chối.');
      return;
    }
    setConfirmBusy(true);
    const res = await callApi(
      (a) => a.confirmPass({
        pass_code: target.pass_code,
        action,
        payment_method: payMethod,
        reason: action === 'reject' ? rejectReason.trim() : undefined,
      }),
      () => mockApi.confirmPass({
        pass_code: target.pass_code,
        action,
        payment_method: payMethod,
        reason: action === 'reject' ? rejectReason.trim() : undefined,
      }),
    );
    setConfirmBusy(false);
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Xác nhận vé thất bại');
      return;
    }
    setApproveTarget(null);
    setRejectTarget(null);
    pushToast(
      'success',
      action === 'approve'
        ? `Đã duyệt vé ${target.pass_code} — đã thu ${formatVND(target.price)} tại quầy.`
        : `Đã từ chối vé ${target.pass_code}.`,
    );
    void load();
  }

  if (status === 'loading') return <div className="card" aria-busy="true" aria-label="Đang tải vé tháng"><SkeletonRows rows={8} /></div>;
  if (status === 'error') return <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>;

  return (
    <div>
      {/* FE-025 (spec §5.2): banner fallback khi toast bị chặn/tắt (E1 vé sắp hết). */}
      <NotifyFallbackBanner surface="passes" />
      <div className="toolbar" role="search">
        <input id="global-search" className="input search-input" aria-label="Tìm vé tháng" placeholder="Tìm biển số / tên / mã vé…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select
          className="select"
          style={{ width: 170 }}
          aria-label="Lọc theo trạng thái"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | PassStatus)}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="pending">Chờ xác nhận{pendingCount > 0 ? ` (${pendingCount})` : ''}</option>
          <option value="active">Còn hạn</option>
          <option value="expired">Hết hạn</option>
          <option value="cancelled">Đã hủy</option>
          <option value="suspended">Tạm khóa</option>
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
          Hết hạn ≤ 7 ngày
        </label>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} strokeWidth={2} aria-hidden="true" /> Đăng ký vé mới</button>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title={passes.length === 0 ? 'Chưa có vé tháng nào' : 'Không tìm thấy vé'}
            hint={passes.length === 0 ? 'Bán vé tháng đầu tiên để giữ chân khách quen.' : 'Thử từ khóa khác hoặc bỏ lọc hết hạn.'}
            action={passes.length === 0 ? <button className="btn btn-primary" onClick={openCreate}>Đăng ký vé mới</button> : undefined}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Mã vé</th>
                <th scope="col">Chủ xe</th>
                <th scope="col">Biển số</th>
                <th scope="col">Khu vực</th>
                <th scope="col">Hiệu lực</th>
                <th scope="col">Trạng thái</th>
                <th scope="col"><span className="sr-only">Hành động</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const d = daysUntil(p.end_date);
                const tone = passTone(p, d);
                // FE-025: highlight row từ deep-link E1 (scroll tới + pulse 1 lần).
                const flashed = highlightPassCode !== null && p.pass_code === highlightPassCode;
                return (
                  <tr
                    key={p.id}
                    data-pass-code={p.pass_code}
                    className={flashed ? 'row-flash' : undefined}
                    onClick={() => setDetail(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetail(p);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Xem chi tiết vé ${p.pass_code}`}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="mono">{p.pass_code}</td>
                    <td style={{ fontSize: 16 }}>{p.customer_name}</td>
                    <td className="mono">{plates[p.pass_code] ?? lookupPassPlate(p.pass_code) ?? '—'}</td>
                    <td>{p.zone_id === null ? 'Mọi khu' : (zones.find((z) => z.id === p.zone_id)?.code ?? `Khu ${p.zone_id}`)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{formatDateShort(p.start_date)} → {formatDateShort(p.end_date)}</td>
                    <td><Badge tone={tone}>{passLabel(p, d)}</Badge></td>
                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {p.status === 'pending' ? (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setPayMethod('cash');
                              setApproveTarget(p);
                            }}
                            aria-label={`Duyệt vé ${p.pass_code}`}
                          >
                            Duyệt
                          </button>{' '}
                          <button
                            className="btn btn-neutral btn-sm"
                            onClick={() => {
                              setRejectReason('');
                              setRejectTarget(p);
                            }}
                            aria-label={`Từ chối vé ${p.pass_code}`}
                          >
                            Từ chối
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-neutral btn-sm" onClick={() => openRenew(p)}>Gia hạn</button>{' '}
                          <button className="icon-btn" title="Hủy vé" aria-label={`Hủy vé ${p.pass_code}`} onClick={() => setCancelTarget(p)}><Trash2 size={16} strokeWidth={2} aria-hidden="true" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="drawer" role="complementary" aria-label={`Chi tiết vé ${detail.pass_code}`}>
          <h2 className="mono" style={{ margin: '0 0 12px' }} tabIndex={-1}>{detail.pass_code}</h2>
          <p style={{ fontSize: 16, margin: '0 0 4px' }}><strong>{detail.customer_name}</strong> · {detail.customer_phone}</p>
          <p className="mono" style={{ fontSize: 14 }}>Hiệu lực: {formatDateShort(detail.start_date)} → {formatDateShort(detail.end_date)}</p>
          <p className="mono" style={{ fontSize: 14 }}>Giá: {formatVND(detail.price)}</p>
          <div style={{ margin: '8px 0' }}><Badge tone={passTone(detail, daysUntil(detail.end_date))}>{passLabel(detail, daysUntil(detail.end_date))}</Badge></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button onClick={() => { const p = detail; setDetail(null); openRenew(p); }}>Gia hạn</Button>
            <button ref={drawerCloseRef} className="btn btn-neutral" onClick={() => setDetail(null)}>Đóng (Esc)</button>
          </div>
        </div>
      )}

      {formOpen && (
        <Dialog title={renewTarget ? `Gia hạn vé ${renewTarget.pass_code}` : 'Đăng ký vé mới'} onClose={() => setFormOpen(false)}>
          {renewTarget && <Alert tone="warning">Nối tiếp từ {formatDateShort(renewTarget.end_date)}</Alert>}
          {formError && <div style={{ margin: '12px 0' }}><Alert tone="danger">{formError}</Alert></div>}
          <Field label="Chủ xe *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <Field label="SĐT *" inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} hint="VD 0901234567" />
          <Field label="Biển số *" mono value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="pass-zone">Khu vực áp dụng</label>
              <select
                id="pass-zone"
                className="select"
                value={zoneId ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  setZoneId(v);
                  const z = zones.find((zz) => zz.id === v);
                  if (z?.vehicle_type_allowed === 'car') setVehicleType('car');
                  else if (z?.vehicle_type_allowed === 'motorbike') setVehicleType('motorbike');
                }}
              >
                <option value="">Mọi khu vực</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label id="pass-vt">Loại xe *</label>
              <div className="seg" role="group" aria-labelledby="pass-vt">
                <button type="button" aria-pressed={vehicleType === 'car'} onClick={() => setVehicleType('car')}>Ô tô</button>
                <button type="button" aria-pressed={vehicleType === 'motorbike'} onClick={() => setVehicleType('motorbike')}>Xe máy</button>
              </div>
            </div>
          </div>
          <div className="field">
            <label id="pack-label">Gói</label>
            <div className="seg" role="group" aria-labelledby="pack-label">
              {PACKS.map((m) => (
                <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)}>{m}T</button>
              ))}
            </div>
            {months === 12 && <span className="field-hint">Gói 12 tháng −10%</span>}
          </div>
          <div className="field">
            <label htmlFor="pass-start">Ngày bắt đầu * (dd/mm/yyyy)</label>
            <input id="pass-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-describedby="pass-start-hint" />
            <span id="pass-start-hint" className="field-hint">Mặc định hôm nay; gia hạn tự nối tiếp ngày hết hạn cũ (nếu đã quá hạn thì từ ngày mai).</span>
          </div>
          <div className="receipt" style={{ marginTop: 8 }}>
            <div className="row"><span>Tạm tính</span><span className="mono" style={{ fontSize: 20, fontWeight: 700 }} aria-live="polite">{formatVND(total)}</span></div>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setFormOpen(false)}>Hủy</button>
            <Button onClick={() => void handleSubmit()} disabled={busy} aria-busy={busy}>{renewTarget ? 'Xác nhận gia hạn' : 'Bán vé'}</Button>
          </div>
        </Dialog>
      )}

      {cancelTarget && (
        <Dialog title={`Hủy vé ${cancelTarget.pass_code}?`} onClose={() => setCancelTarget(null)} label="Xác nhận hủy vé tháng">
          <div className="field">
            <label htmlFor="cancel-reason">Lý do hủy *</label>
            <select id="cancel-reason" className="select" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} aria-describedby="cancel-guard">
              <option>Xe bán / đổi chủ</option>
              <option>Khách yêu cầu hoàn tiền</option>
              <option>Vi phạm nội quy</option>
            </select>
            <span id="cancel-guard" className="field-hint">Hủy vé cần lý do để đối soát. Không xóa dữ liệu đã thu.</span>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setCancelTarget(null)}>Giữ vé</button>
            <button className="btn btn-danger" onClick={() => void handleCancel()}>Xác nhận hủy</button>
          </div>
        </Dialog>
      )}

      {approveTarget && (
        <Dialog title={`Duyệt vé ${approveTarget.pass_code}`} onClose={() => setApproveTarget(null)} label="Xác nhận duyệt vé tháng">
          <p style={{ fontSize: 14, margin: '0 0 4px' }}>
            <strong>{approveTarget.customer_name}</strong> · <span className="mono">{plates[approveTarget.pass_code] ?? lookupPassPlate(approveTarget.pass_code) ?? ''}</span>
          </p>
          <p className="mono" style={{ fontSize: 14, margin: '0 0 4px' }}>
            Hiệu lực: {formatDateShort(approveTarget.start_date)} → {formatDateShort(approveTarget.end_date)}
          </p>
          <p className="mono" style={{ fontSize: 14, margin: '0 0 12px' }}>
            Thu tại quầy: <strong>{formatVND(approveTarget.price)}</strong>
          </p>
          <div className="field">
            <label htmlFor="confirm-pay-method">Hình thức thu tiền *</label>
            <select
              id="confirm-pay-method"
              className="select"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
            >
              <option value="cash">Tiền mặt</option>
              <option value="transfer">Chuyển khoản</option>
              <option value="card">Thẻ</option>
              <option value="e_wallet">Ví điện tử</option>
            </select>
            <span className="field-hint">Duyệt = kích hoạt vé + ghi nhận đã thu tiền tại quầy.</span>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setApproveTarget(null)}>Để sau</button>
            <Button onClick={() => void handleConfirm('approve')} disabled={confirmBusy} aria-busy={confirmBusy}>
              {confirmBusy ? 'Đang duyệt…' : 'Xác nhận duyệt + thu tiền'}
            </Button>
          </div>
        </Dialog>
      )}

      {rejectTarget && (
        <Dialog title={`Từ chối vé ${rejectTarget.pass_code}?`} onClose={() => setRejectTarget(null)} label="Xác nhận từ chối vé tháng">
          <p style={{ fontSize: 14, margin: '0 0 12px' }}>
            <strong>{rejectTarget.customer_name}</strong> · <span className="mono">{plates[rejectTarget.pass_code] ?? lookupPassPlate(rejectTarget.pass_code) ?? ''}</span>
          </p>
          <div className="field">
            <label htmlFor="reject-reason">Lý do từ chối *</label>
            <input
              id="reject-reason"
              className="input"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="VD: Khu đã hết chỗ vé tháng"
            />
            <span className="field-hint">Lý do chỉ hiện trong thông báo, không lưu vào vé.</span>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setRejectTarget(null)}>Giữ vé</button>
            <button className="btn btn-danger" onClick={() => void handleConfirm('reject')} disabled={confirmBusy} aria-busy={confirmBusy}>
              {confirmBusy ? 'Đang từ chối…' : 'Xác nhận từ chối'}
            </button>
          </div>
        </Dialog>
      )}

      <Toasts items={toasts} />
    </div>
  );
}

export type { PassStatus };
