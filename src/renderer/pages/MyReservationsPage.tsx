// Customer area P4 — Đặt chỗ 24/24 + qua đêm (nối BE-019, sửa FE-023).
// Giữ chỗ mọi giờ, end <= start = sang hôm sau, duration 15p–4h (UI chips
// nhanh giữ 1/2/3/4h), quota ≤ 2 pending/customer, hết hạn = giờ kết thúc +20p
// (server `expires_at`, countdown theo đó). Không thanh toán — giữ chỗ miễn
// phí, thu phí lúc gửi xe.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateShort, normalizePlate, todayLocal } from '../lib/format';
import type { CustomerReservationRow, CustomerVehicle, Reservation, ZoneAvailability } from '../types';
import { NotifyFallbackBanner, NotifyRationaleDialog } from '../components/NotifyBanner';
import { shouldShowNotifyRationale } from '../lib/notify';

let toastSeq = 500;

// Đặt chỗ 24/24 (BE-019): mọi giờ đều đặt được, end <= start = qua đêm.
// Quick mode đặt start = now + duration chip; detail mode nhập tay.
const QUICK_DURATIONS = [60, 120, 180, 240]; // 1h / 2h / 3h / 4h

type ListStatus = 'loading' | 'error' | 'ready';

function toMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number);
  return h * 60 + m;
}

function nowHHMM(fromMs?: number): string {
  const d = fromMs === undefined ? new Date() : new Date(fromMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Cộng phút vào HH:mm, tràn qua 0h (VD 23:00 + 120p → 01:00). */
function addMinutesHHMM(hhMm: string, min: number): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const t = (toMinutes(hhMm) + min) % (24 * 60);
  return `${p(Math.floor(t / 60))}:${p(t % 60)}`;
}

/** end <= start = khung qua đêm (sang hôm sau). */
function isOvernight(start: string, end: string): boolean {
  return end <= start;
}

/** Duration phút, qua đêm +24h (VD 23:00→01:00 = 120p). */
function durationMin(start: string, end: string): number {
  const d = toMinutes(end) - toMinutes(start);
  return d > 0 ? d : d + 24 * 60;
}

function fmtDur(min: number): string {
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} giờ` : `${h} giờ ${r} phút`;
}

/** Phút còn lại tới expires_at (âm = đã hết). */
function minutesToExpiry(expiresAt: string, nowMs: number): number {
  const t = new Date(expiresAt.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return Number.NaN;
  return Math.floor((t - nowMs) / 60000);
}

export function MyReservationsPage({ highlightCode = null }: { highlightCode?: string | null } = {}): JSX.Element {
  const [zones, setZones] = useState<ZoneAvailability[]>([]);
  const [zoneId, setZoneId] = useState<number | ''>('');
  const [plate, setPlate] = useState('');
  // FE-023 đặt nhanh 1 chạm: mặc định mode nhanh (start = now, chips 1–4h),
  // link "Chỉnh giờ chi tiết" mở form Từ/Đến cũ cho ai cần.
  const [quick, setQuick] = useState(true);
  const [duration, setDuration] = useState(120); // default 2h
  const [myVehicles, setMyVehicles] = useState<CustomerVehicle[]>([]);
  const [plateCustom, setPlateCustom] = useState(false); // dropdown nhiều xe + "nhập khác"
  const [timeFrom, setTimeFrom] = useState('08:00');
  const [timeTo, setTimeTo] = useState('10:00');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<Reservation | null>(null);

  const [rows, setRows] = useState<CustomerReservationRow[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [listError, setListError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<CustomerReservationRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // FE-025 (spec §5.1): rationale sau giữ chỗ thành công đầu tiên (tối đa 2 lần).
  const [rationale, setRationale] = useState(false);
  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Countdown "Hết hạn sau Np" live — tick 30s (aria-live off, tránh spam SR).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(t);
  }, []);

  const codeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (success) codeRef.current?.focus();
  }, [success]);

  const loadZones = useCallback(async () => {
    const res = await callApi((a) => a.zoneAvailability(), () => mockApi.zoneAvailability());
    if (res.ok) {
      const list = (res.data ?? []).filter((z) => z.is_active === 1);
      setZones(list);
      setZoneId((prev) => (prev === '' && list.length > 0 ? list[0].zone_id : prev));
    }
  }, []);

  const loadMine = useCallback(async (quiet = false) => {
    if (!quiet) setListStatus('loading');
    const res = await callApi((a) => a.myReservations({}), () => mockApi.myReservations({}));
    if (!res.ok) {
      setListError(res.error ?? 'Không tải được vé giữ chỗ');
      setListStatus('error');
      return;
    }
    setRows(res.data?.rows ?? []);
    setListStatus('ready');
  }, []);

  const loadVehicles = useCallback(async () => {
    const res = await callApi((a) => a.customerVehicles(), () => mockApi.customerVehicles());
    if (!res.ok) return; // không chặn form — vẫn cho nhập tay
    const list = res.data?.vehicles ?? [];
    setMyVehicles(list);
    setPlate((prev) => {
      if (prev.trim() !== '' || list.length === 0) return prev;
      return list[0].license_plate; // prefill xe đầu tiên của tôi
    });
  }, []);

  useEffect(() => {
    void loadZones();
    void loadMine();
    void loadVehicles();
  }, [loadZones, loadMine, loadVehicles]);

  // Job expiry không realtime-push — poll 60s khi tab mở (spec §P4.5).
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) {
        void loadMine(true);
        void loadZones();
      }
    }, 60000);
    return () => window.clearInterval(t);
  }, [loadMine, loadZones]);

  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const quotaReached = pendingCount >= 2; // chặn mềm phía client (server COUNT là chốt)

  // FE-025: deep-link E2 — scroll tới card mã sau khi rows render.
  useEffect(() => {
    if (!highlightCode) return;
    const el = document.querySelector(`[data-rsv-code="${highlightCode}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [highlightCode, rows]);
  const activeZone = zones.find((z) => z.zone_id === zoneId) ?? null;

  // ---- FE-024 đặt nhanh 24/24: start = now, end = now + duration (tràn qua đêm).
  // Không clamp 22:00, không disable theo giờ — đặt mọi giờ.
  const quickStart = nowHHMM(nowMs);
  const quickEnd = addMinutesHHMM(quickStart, duration);
  const quickOvernight = isOvernight(quickStart, quickEnd);

  async function handleQuickReserve(): Promise<void> {
    setFields({});
    setBanner('');
    setSuccess(null);
    const errs: Record<string, string> = {};
    const normalized = normalizePlate(plate);
    if (normalized.length < 4) errs.license_plate = 'Biển số chưa đúng — VD: 51H-12345.';
    if (zoneId === '') errs.zone_id = 'Vui lòng chọn khu vực.';
    if (quotaReached) errs.quota = 'Bạn đã có 2 chỗ đang giữ.';
    if (Object.keys(errs).length > 0) {
      setFields(errs);
      if (errs.quota) setBanner('Bạn đã có 2 chỗ đang giữ — hủy bớt trước khi giữ thêm.');
      return;
    }
    const snap = nowHHMM(); // chốt giờ gửi — start = ngay bây giờ (24/24, qua đêm tự tràn)
    const from = snap;
    const to = addMinutesHHMM(snap, duration);
    setBusy(true);
    const res = await callApi(
      (a) => a.reserve({ zone_id: Number(zoneId), license_plate: normalized, date: todayLocal(), start_time: from, end_time: to }),
      () => mockApi.reserve({ zone_id: Number(zoneId), license_plate: normalized, date: todayLocal(), start_time: from, end_time: to }),
    );
    setBusy(false);
    if (!res.ok) {
      if (res.fields) setFields(res.fields);
      if (/hết chỗ|2 chỗ đang giữ/i.test(res.error ?? '')) setBanner(res.error ?? '');
      else if (!res.fields) setBanner(res.error ?? 'Giữ chỗ thất bại');
      return;
    }
    setSuccess(res.data ?? null);
    pushToast('success', `Đã giữ chỗ — mã ${res.data?.code}`);
    if (shouldShowNotifyRationale()) setRationale(true);
    void loadMine(true);
    void loadZones();
  }

  async function handleReserve(): Promise<void> {
    setFields({});
    setBanner('');
    setSuccess(null);
    const errs: Record<string, string> = {};
    const normalized = normalizePlate(plate);
    if (normalized.length < 4) errs.license_plate = 'Biển số chưa đúng — VD: 51H-12345.';
    if (zoneId === '') errs.zone_id = 'Vui lòng chọn khu vực.';
    if (!timeFrom || !timeTo) {
      errs.time = 'Vui lòng chọn giờ bắt đầu và kết thúc.';
    } else if (timeFrom === timeTo) {
      errs.time = 'Giờ kết thúc phải sau giờ bắt đầu.';
    } else {
      // 24/24: mọi giờ đều được, end <= start = qua đêm (ngày bắt đầu = hôm nay).
      const dur = durationMin(timeFrom, timeTo);
      if (dur < 15 || dur > 240) errs.time = 'Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ.';
      else if (timeFrom < nowHHMM() && toMinutes(nowHHMM()) - toMinutes(timeFrom) > 15) {
        errs.time = 'Giờ bắt đầu đã qua — chọn giờ còn hiệu lực.';
      }
    }
    if (quotaReached) errs.quota = 'Bạn đã có 2 chỗ đang giữ.';
    if (Object.keys(errs).length > 0) {
      setFields(errs);
      if (errs.quota) setBanner('Bạn đã có 2 chỗ đang giữ — hủy bớt trước khi giữ thêm.');
      return;
    }
    setBusy(true);
    const res = await callApi(
      (a) => a.reserve({ zone_id: Number(zoneId), license_plate: normalized, date: todayLocal(), start_time: timeFrom, end_time: timeTo }),
      () => mockApi.reserve({ zone_id: Number(zoneId), license_plate: normalized, date: todayLocal(), start_time: timeFrom, end_time: timeTo }),
    );
    setBusy(false);
    if (!res.ok) {
      if (res.fields) setFields(res.fields);
      // Hết chỗ / quá quota → Warning (không phải lỗi user) — spec §P4.4.
      if (/hết chỗ|2 chỗ đang giữ/i.test(res.error ?? '')) setBanner(res.error ?? '');
      else if (!res.fields) setBanner(res.error ?? 'Giữ chỗ thất bại');
      return;
    }
    setSuccess(res.data ?? null);
    pushToast('success', `Đã giữ chỗ — mã ${res.data?.code}`);
    if (shouldShowNotifyRationale()) setRationale(true);
    void loadMine(true);
    void loadZones();
  }

  async function handleCancel(): Promise<void> {
    if (!cancelTarget) return;
    setCancelBusy(true);
    const res = await callApi((a) => a.cancelReservation(cancelTarget.code), () => mockApi.cancelReservation(cancelTarget.code));
    setCancelBusy(false);
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Hủy giữ chỗ thất bại');
      return;
    }
    pushToast('success', `Đã hủy vé giữ chỗ ${cancelTarget.code}`);
    setCancelTarget(null);
    if (success?.code === cancelTarget.code) setSuccess(null);
    void loadMine(true);
    void loadZones();
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    pushToast('success', `Đã sao chép mã ${code}.`);
  }

  function refill(row: CustomerReservationRow): void {
    setZoneId(row.zone_id);
    setPlate(row.license_plate);
    setPlateCustom(false);
    setQuick(false); // đặt lại theo khung giờ cụ thể của vé cũ
    setTimeFrom(row.start_time);
    setTimeTo(row.end_time);
    setSuccess(null);
    setFields({});
    setBanner('');
  }

  const today = todayLocal();

  return (
    <div>
      {/* FE-025 (spec §5.2): banner fallback + countdown card đậm hơn là nguồn
          chính khi toast tắt (countdown live đã có ở từng card bên dưới). */}
      <NotifyFallbackBanner surface="reservations" />
      <div className="page-head">
        <div>
          <h1>Đặt chỗ</h1>
          <p>Giữ chỗ 24/24 ngày {formatDateShort(today)} — miễn phí, thu phí lúc gửi xe.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }} role="form" aria-label="Form giữ chỗ">
        {banner && (
          <div style={{ marginBottom: 12 }}>
            <Alert tone="warning">{banner}</Alert>
          </div>
        )}
        <div className="field">
          <label htmlFor="rsv-zone">Khu vực *</label>
          <select
            id="rsv-zone"
            className="select"
            value={zoneId}
            onChange={(e) => {
              setZoneId(e.target.value === '' ? '' : Number(e.target.value));
              setFields((f) => ({ ...f, zone_id: '' }));
            }}
            aria-invalid={Boolean(fields.zone_id)}
            aria-describedby={fields.zone_id ? 'rsv-zone-err' : undefined}
          >
            <option value="">— Chọn khu —</option>
            {zones.map((z) => (
              <option key={z.zone_id} value={z.zone_id} disabled={z.free_spots <= 0}>
                Khu {z.zone_code} — còn {z.free_spots}{z.free_spots <= 0 ? ' (HẾT)' : ''}
              </option>
            ))}
          </select>
          {fields.zone_id && <span id="rsv-zone-err" className="field-error">{fields.zone_id}</span>}
          {activeZone && (
            <span className="field-hint" aria-live="polite">Còn {activeZone.free_spots} chỗ tại khu {activeZone.zone_code}</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="rsv-date">Ngày</label>
          <input id="rsv-date" className="input" value={formatDateShort(today)} readOnly aria-readonly="true" />
          <span className="field-hint">Ngày bắt đầu giữ chỗ — khung qua đêm (VD 23:00→01:00) tính sang hôm sau.</span>
        </div>
        {quick ? (
          <>
            <div className="field">
              <span id="rsv-dur-label" style={{ fontWeight: 600, fontSize: 14 }}>Thời lượng *</span>
              <div role="group" aria-labelledby="rsv-dur-label" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {QUICK_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={duration === d ? 'btn btn-primary' : 'btn btn-neutral'}
                    aria-pressed={duration === d}
                    onClick={() => setDuration(d)}
                  >
                    {d / 60}h
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-hint" aria-live="polite">
                Bắt đầu: ngay bây giờ ({quickStart}) → kết thúc dự kiến {quickEnd} ({fmtDur(duration)}){quickOvernight && ' (qua đêm)'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="rsv-from">Từ giờ *</label>
                <input
                  id="rsv-from"
                  type="time"
                  className="input"
                  value={timeFrom}
                  onChange={(e) => {
                    setTimeFrom(e.target.value);
                    setFields((f) => ({ ...f, time: '' }));
                  }}
                  aria-invalid={Boolean(fields.time)}
                  aria-describedby={fields.time ? 'rsv-time-err' : 'rsv-overnight-hint'}
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label htmlFor="rsv-to">Đến giờ *</label>
                <input
                  id="rsv-to"
                  type="time"
                  className="input"
                  value={timeTo}
                  onChange={(e) => {
                    setTimeTo(e.target.value);
                    setFields((f) => ({ ...f, time: '' }));
                  }}
                  aria-invalid={Boolean(fields.time)}
                  aria-describedby={fields.time ? 'rsv-time-err' : 'rsv-overnight-hint'}
                />
              </div>
            </div>
            {fields.time && <div style={{ margin: '-4px 0 12px' }}><span className="field-error" id="rsv-time-err">{fields.time}</span></div>}
            {!fields.time && timeFrom && timeTo && timeFrom !== timeTo && (
              <div style={{ margin: '-4px 0 12px' }}>
                <span className="field-hint" id="rsv-overnight-hint">
                  {isOvernight(timeFrom, timeTo)
                    ? `Qua đêm: ${timeFrom} hôm nay → ${timeTo} hôm sau (${fmtDur(durationMin(timeFrom, timeTo))}).`
                    : `Trong ngày: ${timeFrom}–${timeTo} (${fmtDur(durationMin(timeFrom, timeTo))}).`}
                </span>
              </div>
            )}
          </>
        )}
        {myVehicles.length > 1 && !plateCustom ? (
          <div className="field">
            <label htmlFor="rsv-plate">Biển số xe *</label>
            <select
              id="rsv-plate"
              className="select mono"
              value={myVehicles.some((v) => v.license_plate === plate) ? plate : '__custom'}
              onChange={(e) => {
                if (e.target.value === '__custom') {
                  setPlateCustom(true);
                  setPlate('');
                } else {
                  setPlate(e.target.value);
                }
                setFields((f) => ({ ...f, license_plate: '' }));
              }}
              aria-invalid={Boolean(fields.license_plate)}
              aria-describedby={fields.license_plate ? 'rsv-plate-err' : undefined}
            >
              {myVehicles.map((v) => (
                <option key={v.id} value={v.license_plate}>{v.license_plate}</option>
              ))}
              <option value="__custom">Biển số khác…</option>
            </select>
            {fields.license_plate && <span id="rsv-plate-err" className="field-error">{fields.license_plate}</span>}
            <span className="field-hint">Biển số đối soát khi check-in bằng mã giữ chỗ</span>
          </div>
        ) : (
          <Field
            label="Biển số xe *"
            mono
            value={plate}
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
              setFields((f) => ({ ...f, license_plate: '' }));
            }}
            placeholder="VD 51H-12345"
            autoComplete="off"
            hint="Biển số đối soát khi check-in bằng mã giữ chỗ"
            error={fields.license_plate}
          />
        )}
        {quotaReached ? (
          <Alert tone="warning">Bạn đã có 2 chỗ đang giữ — hủy bớt trước khi giữ thêm.</Alert>
        ) : quick ? (
          <>
            <Button block onClick={() => void handleQuickReserve()} disabled={busy} aria-busy={busy}>
              {busy ? 'Đang giữ chỗ…' : 'Giữ chỗ ngay'}
            </Button>
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuick(false)}>
                Chỉnh giờ chi tiết
              </button>
            </div>
          </>
        ) : (
          <>
            <Button block onClick={() => void handleReserve()} disabled={busy} aria-busy={busy}>
              {busy ? 'Đang giữ chỗ…' : 'Giữ chỗ'}
            </Button>
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuick(true)}>
                Về đặt nhanh
              </button>
            </div>
          </>
        )}
      </div>

      {success && (
        <div className="card" role="status" style={{ marginBottom: 16, borderColor: 'var(--color-success-border)' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Giữ chỗ thành công</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <span
              ref={codeRef}
              tabIndex={-1}
              className="mono"
              style={{ fontSize: 24, fontWeight: 800, letterSpacing: 1 }}
              aria-label={`Mã đặt chỗ ${success.code}`}
            >
              {success.code}
            </span>
            <Button variant="neutral" onClick={() => void copyCode(success.code)}>Copy mã</Button>
            <Button variant="danger" onClick={() => setCancelTarget({ ...success, zone_code: activeZone?.zone_code ?? null, zone_name: activeZone?.name ?? null, spot_number: null })}>
              Hủy giữ chỗ
            </Button>
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-60)', margin: 0 }}>
            Hiệu lực {success.start_time}–{success.end_time}{isOvernight(success.start_time, success.end_time) ? ' (qua đêm)' : ''} ngày {formatDateShort(success.date)} · Tự hủy lúc {success.expires_at.slice(11, 16)} (20 phút sau giờ kết thúc) nếu chưa check-in.
          </p>
        </div>
      )}

      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Giữ chỗ của tôi</h2>
      {listStatus === 'loading' && (
        <div className="card" aria-busy="true" aria-label="Đang tải vé giữ chỗ"><SkeletonRows rows={3} /></div>
      )}
      {listStatus === 'error' && (
        <div className="card"><RetryPanel message={listError} onRetry={() => void loadMine()} /></div>
      )}
      {listStatus === 'ready' && rows.length === 0 && (
        <div className="card">
          <EmptyState title="Chưa có vé giữ chỗ" hint="Chọn khu + thời lượng rồi bấm Giữ chỗ — mã R-… dùng để check-in tại quầy." />
        </div>
      )}
      {listStatus === 'ready' && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => {
            const mins = r.status === 'pending' ? minutesToExpiry(r.expires_at, nowMs) : Number.NaN;
            const soon = !Number.isNaN(mins) && mins <= 15;
            const tone = r.status === 'pending' ? (soon ? 'warning' : 'success') : 'muted';
            const label = r.status === 'pending' ? (soon ? 'Sắp hết' : 'Giữ chỗ') : r.status === 'completed' ? 'Đã dùng' : r.status === 'expired' ? 'Hết hạn' : 'Đã hủy';
            return (
              <div
                key={r.code}
                className="card"
                data-rsv-code={r.code}
                style={
                  highlightCode === r.code
                    ? { outline: '2px solid var(--color-primary)', outlineOffset: 2 }
                    : r.status !== 'pending' ? { opacity: 0.75 } : undefined
                }
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{r.code}</span>
                  <Badge tone={tone}>{label}</Badge>
                  <span style={{ flex: 1 }} />
                  {r.status === 'pending' && (
                    <>
                      <Button variant="neutral" onClick={() => void copyCode(r.code)}>Copy mã</Button>
                      <Button variant="danger" onClick={() => setCancelTarget(r)}>Hủy</Button>
                    </>
                  )}
                  {r.status !== 'pending' && (
                    <Button variant="neutral" onClick={() => refill(r)}>Đặt lại</Button>
                  )}
                </div>
                <div style={{ fontSize: 14, color: 'var(--color-text-60)' }}>
                  Khu {r.zone_code ?? '—'} · {formatDateShort(r.date)} {r.start_time}–{r.end_time}{isOvernight(r.start_time, r.end_time) ? ' (qua đêm)' : ''} · Biển số <span className="mono">{r.license_plate}</span>
                </div>
                {r.status === 'pending' && !Number.isNaN(mins) && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-60)', marginTop: 4 }}>
                    {mins > 0 ? `Hết hạn sau ${mins}p` : 'Đã quá giờ hẹn — hệ thống sẽ tự hủy'} · Hết hạn lúc {r.expires_at.slice(11, 16)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {cancelTarget && (
        <Dialog title="Hủy giữ chỗ" label="Xác nhận hủy giữ chỗ" onClose={() => setCancelTarget(null)}>
          <p style={{ fontSize: 14, margin: '0 0 16px' }}>
            Hủy vé giữ chỗ <span className="mono" style={{ fontWeight: 700 }}>{cancelTarget.code}</span>? Ô giữ sẽ trả về bãi ngay.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="neutral" onClick={() => setCancelTarget(null)}>Ở lại</Button>
            <Button variant="danger" onClick={() => void handleCancel()} disabled={cancelBusy} aria-busy={cancelBusy}>
              {cancelBusy ? 'Đang hủy…' : 'Hủy giữ chỗ'}
            </Button>
          </div>
        </Dialog>
      )}

      <Toasts items={toasts} />
      {/* FE-025 (spec §5.1): rationale sau giữ chỗ thành công đầu tiên. */}
      {rationale && (
        <NotifyRationaleDialog
          trigger="reservation"
          onDone={(granted) => {
            setRationale(false);
            if (granted) pushToast('success', 'Đã bật thông báo.');
          }}
        />
      )}
    </div>
  );
}
