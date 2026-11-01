import { useCallback, useDeferredValue, useEffect, useMemo, useState, type JSX } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { allSessionPlates, lookupSessionPlate, rememberSessionPlate } from '../lib/api';
import { mockApi, mockSessionPlates } from '../lib/mockApi';
import { formatDateTime, formatVND, normalizePlate } from '../lib/format';
import { previewFee } from '../lib/fee';
import { useAuth } from '../store/auth';
import type { FeePreview, ParkingSession, ParkingZone, PaymentMethod, VehicleType, ZoneAvailability } from '../types';

type Tab = 'in' | 'out';
type Status = 'loading' | 'error' | 'ready';

let toastSeq = 100;

export function SessionsPage(): JSX.Element {
  const { perms } = useAuth();
  // FE-020 S4: staff mất `reservation` → ẩn ô mã giữ chỗ (check-in kèm mã
  // cần quyền reservation — BE-014). Admin/perms chưa tải → hiện như cũ.
  const canUseReservation = !perms || perms.reservation === 1;
  const [tab, setTab] = useState<Tab>('in');
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const [avail, setAvail] = useState<ZoneAvailability[]>([]);

  // check-in form
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ticketType, setTicketType] = useState<'casual' | 'monthly'>('casual');
  const [passCode, setPassCode] = useState('');
  // FE-016 P4: mã giữ chỗ R-… (optional) — truyền reservation_code cho backend
  // consume pending → completed; lỗi mã sai hiện inline từ server (inError).
  const [reservationCode, setReservationCode] = useState('');
  const [note, setNote] = useState('');
  const [inError, setInError] = useState<string | null>(null);
  const [dupPlate, setDupPlate] = useState<string | null>(null);
  const [inBusy, setInBusy] = useState(false);

  // check-out form
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<ParkingSession[]>([]);
  const [selected, setSelected] = useState<ParkingSession | null>(null);
  const [discount, setDiscount] = useState('0');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [outBusy, setOutBusy] = useState(false);
  const [outError, setOutError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ session: ParkingSession; amount: number } | null>(null);

  // A2: server fee receipt (sessions:preview-fee) — source of truth.
  // Local previewFee stays as instant fallback while this loads / on error.
  const [serverFee, setServerFee] = useState<FeePreview | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  useEffect(() => {
    if (!selected) {
      setServerFee(null);
      setFeeLoading(false);
      return;
    }
    const ticket = selected.ticket_code;
    const disc = Number(discount) || 0;
    setFeeLoading(true);
    const t = window.setTimeout(() => {
      void callApi(
        (a) => a.previewFee(ticket, disc),
        () => mockApi.previewFee(ticket, disc),
      ).then((res) => {
        setFeeLoading(false);
        setServerFee(res.ok ? (res.data ?? null) : null);
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [selected, discount]);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const [plates, setPlates] = useState<Record<number, string>>(mockSessionPlates());

  const plateOf = useCallback((vehicleId: number): string => {
    return plates[vehicleId] ?? lookupSessionPlate(vehicleId) ?? '—';
  }, [plates]);

  // Live clock for the fee preview (spec §d: elapsed ticks live; 30s cadence).
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) setNowIso(new Date().toISOString());
    }, 30000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    const [zRes, aRes] = await Promise.all([
      callApi((a) => a.listZones(), () => mockApi.listZones()),
      callApi((a) => a.zoneAvailability(), () => mockApi.zoneAvailability()),
    ]);
    if (!zRes.ok) {
      setError(zRes.error ?? 'Lỗi tải dữ liệu');
      setStatus('error');
      return;
    }
    setZones(zRes.data ?? []);
    setAvail(aRes.ok ? (aRes.data ?? []) : []);
    setPlates({ ...mockSessionPlates(), ...allSessionPlates() });
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const zoneOptions = useMemo(() => {
    return zones
      .filter((z) => z.is_active === 1 && (z.vehicle_type_allowed === vehicleType || z.vehicle_type_allowed === 'both'))
      .map((z) => {
        const av = avail.find((a) => a.zone_id === z.id);
        const free = av ? av.free_spots : z.capacity;
        return { zone: z, free, full: free <= 0 };
      });
  }, [zones, avail, vehicleType]);

  useEffect(() => {
    if (zoneId === null && zoneOptions.length > 0) setZoneId(zoneOptions[0].zone.id);
  }, [zoneOptions, zoneId]);

  const selectedZone = zones.find((z) => z.id === zoneId) ?? null;
  const fee = useMemo(() => {
    if (!selected || !selectedZone) return null;
    return previewFee(selected.check_in_at.replace(' ', 'T'), nowIso, selected.hourly_rate_applied, selected.daily_rate_applied, Number(discount) || 0, selected.monthly_pass_id !== null);
  }, [selected, selectedZone, discount, nowIso]);
  // Screen-reader announcement is deferred so rapid discount typing
  // doesn't chatter (spec §d: announce total, debounced ~1s).
  const announcedTotal = useDeferredValue(fee?.total);

  const inValid = plate.trim().length >= 4 && zoneId !== null && (ticketType === 'casual' || passCode.trim().length >= 3);

  async function handleCheckIn(): Promise<void> {
    setInError(null);
    setDupPlate(null);
    const normalized = normalizePlate(plate);
    if (normalized.length < 4) {
      setInError('Biển số tối thiểu 4 ký tự. VD 51H-12345');
      return;
    }
    if (zoneId === null) {
      setInError('Vui lòng chọn khu vực');
      return;
    }
    setInBusy(true);
    // FE-020 S4: staff mất `reservation` không gửi mã (ô đã ẩn — phòng state cũ).
    const resCode = canUseReservation ? reservationCode.trim().toUpperCase() : '';
    const res = await callApi(
      (a) => a.checkIn({
        license_plate: normalized,
        vehicle_type: vehicleType,
        zone_id: zoneId,
        owner_name: ownerName.trim() === '' ? undefined : ownerName.trim(),
        owner_phone: ownerPhone.trim() === '' ? undefined : ownerPhone.trim(),
        reservation_code: resCode === '' ? undefined : resCode,
      }),
      () => mockApi.checkIn({
        license_plate: normalized,
        vehicle_type: vehicleType,
        zone_id: zoneId,
        owner_name: ownerName.trim() === '' ? undefined : ownerName.trim(),
        owner_phone: ownerPhone.trim() === '' ? undefined : ownerPhone.trim(),
        reservation_code: resCode === '' ? undefined : resCode,
      }),
    );
    setInBusy(false);
    if (!res.ok) {
      const msg = res.error ?? 'Check-in thất bại';
      setInError(msg);
      // Spec §d: duplicate error must offer a shortcut into the Check-out tab.
      if (/đã check-in/i.test(msg)) setDupPlate(normalized);
      return;
    }
    setPlates((p) => ({ ...p, [res.data?.vehicle_id ?? 0]: normalized }));
    rememberSessionPlate(res.data?.vehicle_id ?? 0, normalized);
    pushToast('success', `Check-in ${normalized} — vé ${res.data?.ticket_code}`);
    setPlate('');
    setNote('');
    setOwnerName('');
    setOwnerPhone('');
    setReservationCode('');
    void load();
  }

  async function handleLookup(): Promise<void> {
    setOutError(null);
    setSelected(null);
    const res = await callApi((a) => a.findParked(lookup), () => mockApi.findParked(lookup));
    if (!res.ok) {
      setOutError(res.error ?? 'Tra cứu thất bại');
      return;
    }
    setFound(res.data ?? []);
    if ((res.data ?? []).length === 0) setOutError('Không tìm thấy xe đang đỗ');
  }

  async function handleCheckOut(): Promise<void> {
    if (!selected) return;
    setOutBusy(true);
    setOutError(null);
    const res = await callApi(
      (a) => a.checkOut({ ticket_code: selected.ticket_code, discount_amount: Number(discount) || 0, payment_method: payMethod }),
      () => mockApi.checkOut({ ticket_code: selected.ticket_code, discount_amount: Number(discount) || 0, payment_method: payMethod }),
    );
    setOutBusy(false);
    if (!res.ok) {
      setOutError(res.error ?? 'Check-out thất bại');
      return;
    }
    setReceipt(res.data ?? null);
    pushToast('success', `Đã thu ${formatVND(res.data?.amount ?? 0)} — vé ${selected.ticket_code}`);
    setSelected(null);
    setFound([]);
    setLookup('');
    void load();
  }

  if (status === 'loading') return <div className="card" aria-busy="true" aria-label="Đang tải"><SkeletonRows rows={6} /></div>;
  if (status === 'error') return <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>;

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Check-in / Check-out">
        <button className="tab" role="tab" aria-selected={tab === 'in'} onClick={() => setTab('in')}>Check-in</button>
        <button className="tab" role="tab" aria-selected={tab === 'out'} onClick={() => setTab('out')}>Check-out</button>
      </div>

      {tab === 'in' ? (
        <div className="two-col">
          <div className="card" role="tabpanel" aria-label="Form check-in">
            {inError && (
              <div style={{ marginBottom: 12 }}>
                <Alert tone="danger">
                  {inError}
                  {dupPlate !== null && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => { setTab('out'); setLookup(dupPlate); setDupPlate(null); }}
                        style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', fontWeight: 700, cursor: 'pointer', fontSize: 'inherit' }}
                      >
                        Chuyển sang Check-out
                      </button>
                    </>
                  )}
                </Alert>
              </div>
            )}
            <Field label="Biển số xe *" mono value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="VD 51H-12345" autoComplete="off" hint="Tự viết hoa. VD 51H-12345" />
            <div className="field">
              <label id="ci-vt">Loại xe *</label>
              <div className="seg" role="group" aria-labelledby="ci-vt">
                <button type="button" aria-pressed={vehicleType === 'car'} onClick={() => setVehicleType('car')}>Ô tô</button>
                <button type="button" aria-pressed={vehicleType === 'motorbike'} onClick={() => setVehicleType('motorbike')}>Xe máy</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ci-zone">Khu vực *</label>
              <select id="ci-zone" className="select" value={zoneId ?? ''} onChange={(e) => setZoneId(Number(e.target.value))}>
                {zoneOptions.map(({ zone, free, full }) => (
                  <option key={zone.id} value={zone.id} disabled={full}>
                    {zone.name} — còn {free}{full ? ' (ĐẦY)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Tên chủ xe (tùy chọn)" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nguyễn Văn An" autoComplete="off" hint="Lưu cùng hồ sơ xe — để trống nếu khách vãng lai" />
            <Field label="SĐT chủ xe (tùy chọn)" inputMode="tel" value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="0901234567" autoComplete="off" />
            <div className="field">
              <label id="ci-tt">Loại vé</label>
              <div className="seg" role="group" aria-labelledby="ci-tt">
                <button type="button" aria-pressed={ticketType === 'casual'} onClick={() => setTicketType('casual')}>Vé lượt</button>
                <button type="button" aria-pressed={ticketType === 'monthly'} onClick={() => setTicketType('monthly')}>Vé tháng</button>
              </div>
            </div>
            {ticketType === 'monthly' && (
              <Field label="Mã vé tháng *" mono value={passCode} onChange={(e) => setPassCode(e.target.value.toUpperCase())} placeholder="MT-2026-0001" />
            )}
            {canUseReservation ? (
              <Field label="Mã đặt chỗ (nếu có)" mono value={reservationCode} onChange={(e) => setReservationCode(e.target.value.toUpperCase())} placeholder="R-20261024-0001" autoComplete="off" hint="Khách đã giữ chỗ trước — nhập mã R-… để dùng đúng ô giữ" />
            ) : (
              <Alert tone="warning">Tài khoản của bạn không có quyền Xác nhận đặt chỗ — liên hệ quản lý.</Alert>
            )}
            <div className="field">
              <label htmlFor="ci-note">Ghi chú</label>
              <textarea id="ci-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button block onClick={() => void handleCheckIn()} disabled={!inValid || inBusy} aria-disabled={!inValid} title={!inValid ? 'Nhập biển số và chọn khu vực trước' : undefined} aria-busy={inBusy}>
              {inBusy ? 'Đang check-in…' : 'Check-in'}
            </Button>
          </div>
          <div>
            <div className="receipt" aria-label="Phiếu check-in xem trước">
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Phiếu vào — xem trước</h3>
              <div className="row"><span>Khu vực</span><strong>{selectedZone?.name ?? '—'}</strong></div>
              <div className="row"><span>Giờ vào (tự động)</span><span className="mono">{formatDateTime(nowIso)}</span></div>
              <div className="row"><span>Giá giờ / ngày</span><span className="mono">{selectedZone ? `${formatVND(selectedZone.price_per_hour)} / ${formatVND(selectedZone.price_per_day)}` : '—'}</span></div>
              <div className="row"><span>Quy tắc tính phí</span><span style={{ fontSize: 12 }}>≤30 phút đầu: làm tròn 1 giờ. Qua đêm: áp giá ngày.</span></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="two-col">
          <div className="card" role="tabpanel" aria-label="Form check-out">
            {outError && <div style={{ marginBottom: 12 }}><Alert tone="danger">{outError}</Alert></div>}
            <div className="field">
              <label htmlFor="co-lookup">Biển số hoặc mã vé *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="co-lookup" className="input input-mono" value={lookup} onChange={(e) => setLookup(e.target.value.toUpperCase())} placeholder="51H-12345 hoặc T-2026…" autoComplete="off" />
                <Button variant="neutral" onClick={() => void handleLookup()}>Tìm</Button>
              </div>
            </div>
            {found.length > 0 && !selected && (
              <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
                {found.map((s) => (
                  <li key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="mono"><strong>{plateOf(s.vehicle_id)}</strong></span>
                    <span className="mono" style={{ fontSize: 12 }}>{s.ticket_code}</span>
                    <span style={{ flex: 1 }} />
                    <button className="btn btn-neutral btn-sm" onClick={() => setSelected(s)}>Chọn</button>
                  </li>
                ))}
              </ul>
            )}
            {found.length === 0 && lookup === '' && (
              <EmptyState title="Chưa tra cứu" hint="Nhập biển số hoặc mã vé để tính phí và thu tiền." />
            )}
            {selected && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Badge tone="primary">{selected ? plateOf(selected.vehicle_id) : '—'}</Badge>{' '}
                  <span className="mono" style={{ fontSize: 12 }}>vào {formatDateTime(selected.check_in_at)}</span>
                </div>
                <Field label="Giảm giá (VND)" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                <div className="field">
                  <label htmlFor="co-pay">Phương thức thanh toán</label>
                  <select id="co-pay" className="select" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}>
                    <option value="cash">Tiền mặt</option>
                    <option value="transfer">Chuyển khoản</option>
                    <option value="card">Thẻ</option>
                    <option value="e_wallet">Ví điện tử</option>
                  </select>
                </div>
                <Button block onClick={() => void handleCheckOut()} disabled={outBusy} aria-busy={outBusy}>
                  {outBusy ? 'Đang thu phí…' : 'Thu phí & Check-out'}
                </Button>
              </>
            )}
          </div>
          <div>
            <div className="receipt" aria-label="Xem trước phí">
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Hóa đơn — fee preview (bắt buộc)</h3>
              {!selected || (!serverFee && !fee) ? (
                <p style={{ fontSize: 14, color: 'var(--color-text-60)' }}>Chọn xe để xem chi tiết phí trước khi thu.</p>
              ) : serverFee ? (
                <>
                  <div className="row"><span>Mã vé</span><span className="mono">{serverFee.ticket_code}</span></div>
                  {serverFee.uses_monthly_pass ? (
                    <div className="row"><span>Vé tháng còn hiệu lực{serverFee.pass_code ? ` (${serverFee.pass_code})` : ''}</span><span className="mono">{formatVND(0)}</span></div>
                  ) : serverFee.applied_daily_rate ? (
                    <div className="row"><span>Qua đêm / ≥12 giờ — áp giá ngày{serverFee.day_count > 1 ? ` × ${serverFee.day_count} ngày` : ''}</span><span className="mono">{formatVND(serverFee.gross_fee)}</span></div>
                  ) : (
                    <div className="row"><span>{serverFee.billed_hours} giờ × {formatVND(serverFee.hourly_rate)}</span><span className="mono">{formatVND(serverFee.gross_fee)}</span></div>
                  )}
                  {serverFee.discount_amount > 0 && (
                    <div className="row"><span>Giảm giá</span><span className="mono">−{formatVND(serverFee.discount_amount)}</span></div>
                  )}
                  <div className="row" style={{ borderTop: '1px dashed var(--color-border-strong)', marginTop: 8, paddingTop: 12 }}>
                    <span><strong>Tổng thu</strong></span>
                    <span className="total">{formatVND(serverFee.total_fee)}</span>
                  </div>
                  <div className="row"><span>Thời gian đỗ</span><span className="mono">{serverFee.minutes >= 60 ? `${Math.floor(serverFee.minutes / 60)} giờ ${serverFee.minutes % 60} phút` : `${serverFee.minutes} phút`}</span></div>
                  <span className="sr-only" aria-live="polite" aria-atomic="true">
                    {`Tổng phí ${formatVND(serverFee.total_fee)}`}
                  </span>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--color-text-60)', margin: '0 0 8px' }}>
                    {feeLoading ? 'Đang tải giá từ máy chủ… (hiển thị tạm tính)' : 'Không tải được giá máy chủ — hiển thị tạm tính'}
                  </p>
                  {fee && (
                    <>
                      {fee.lines.map((l, i) => (
                        <div className="row" key={i}><span>{l.label}</span><span className="mono">{formatVND(l.amount)}</span></div>
                      ))}
                      {(Number(discount) || 0) > 0 && (
                        <div className="row"><span>Giảm giá</span><span className="mono">−{formatVND(Number(discount))}</span></div>
                      )}
                      <div className="row" style={{ borderTop: '1px dashed var(--color-border-strong)', marginTop: 8, paddingTop: 12 }}>
                        <span><strong>Tổng thu (tạm tính)</strong></span>
                        <span className="total">{formatVND(fee.total)}</span>
                      </div>
                      <div className="row"><span>Thời gian đỗ</span><span className="mono">{fee.minutes >= 60 ? `${Math.floor(fee.minutes / 60)} giờ ${fee.minutes % 60} phút` : `${fee.minutes} phút`}</span></div>
                      <span className="sr-only" aria-live="polite" aria-atomic="true">
                        {announcedTotal !== undefined ? `Tổng phí tạm tính ${formatVND(announcedTotal)}` : ''}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <Dialog title="Thu phí thành công" onClose={() => setReceipt(null)} label="Hóa đơn">
          <div className="receipt">
            <div className="row"><span>Vé</span><span className="mono">{receipt.session.ticket_code}</span></div>
            <div className="row"><span>Thực thu</span><span className="total">{formatVND(receipt.amount)}</span></div>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setReceipt(null)}>Đóng</button>
            <Button onClick={() => { setReceipt(null); pushToast('success', 'Đã gửi lệnh in vé'); }}>In vé</Button>
          </div>
        </Dialog>
      )}

      <Toasts items={toasts} />
    </div>
  );
}
