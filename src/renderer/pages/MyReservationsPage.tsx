// Customer area P4 — Đặt chỗ trong ngày (spec ./specs/customer-area.md §P4).
// V1: chỉ giữ trong hôm nay, khung 06:00–22:00, duration 1–4h, quota ≤ 2
// pending/customer (client chặn mềm + server COUNT), tự hủy +20p sau giờ hẹn.
// Không thanh toán — giữ chỗ miễn phí, thu phí lúc gửi xe.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateShort, normalizePlate, todayLocal } from '../lib/format';
import type { CustomerReservationRow, Reservation, ZoneAvailability } from '../types';

let toastSeq = 500;

type ListStatus = 'loading' | 'error' | 'ready';

function toMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(':').map(Number);
  return h * 60 + m;
}

function nowHHMM(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Phút còn lại tới expires_at (âm = đã hết). */
function minutesToExpiry(expiresAt: string, nowMs: number): number {
  const t = new Date(expiresAt.replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return Number.NaN;
  return Math.floor((t - nowMs) / 60000);
}

export function MyReservationsPage(): JSX.Element {
  const [zones, setZones] = useState<ZoneAvailability[]>([]);
  const [zoneId, setZoneId] = useState<number | ''>('');
  const [plate, setPlate] = useState('');
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

  useEffect(() => {
    void loadZones();
    void loadMine();
  }, [loadZones, loadMine]);

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
  const activeZone = zones.find((z) => z.zone_id === zoneId) ?? null;

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
    } else {
      if (!(timeFrom >= '06:00' && timeTo <= '22:00' && timeFrom < timeTo)) {
        errs.time = 'Khung giờ phải trong 06:00–22:00, giờ kết thúc sau giờ bắt đầu.';
      } else {
        const dur = toMinutes(timeTo) - toMinutes(timeFrom);
        if (dur < 60 || dur > 240) errs.time = 'Thời gian giữ từ 1 đến 4 giờ.';
        else if (timeFrom < nowHHMM() && toMinutes(nowHHMM()) - toMinutes(timeFrom) > 15) {
          errs.time = 'Giờ bắt đầu đã qua — chọn giờ còn hiệu lực trong hôm nay.';
        }
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
    setTimeFrom(row.start_time);
    setTimeTo(row.end_time);
    setSuccess(null);
    setFields({});
    setBanner('');
  }

  const today = todayLocal();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Đặt chỗ</h1>
          <p>Giữ chỗ trong ngày {formatDateShort(today)} — miễn phí, thu phí lúc gửi xe.</p>
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
          <span className="field-hint">V1 chỉ giữ chỗ trong ngày.</span>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="rsv-from">Từ giờ *</label>
            <input
              id="rsv-from"
              type="time"
              className="input"
              value={timeFrom}
              min="06:00"
              max="22:00"
              onChange={(e) => {
                setTimeFrom(e.target.value);
                setFields((f) => ({ ...f, time: '' }));
              }}
              aria-invalid={Boolean(fields.time)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor="rsv-to">Đến giờ *</label>
            <input
              id="rsv-to"
              type="time"
              className="input"
              value={timeTo}
              min="06:00"
              max="22:00"
              onChange={(e) => {
                setTimeTo(e.target.value);
                setFields((f) => ({ ...f, time: '' }));
              }}
              aria-invalid={Boolean(fields.time)}
            />
          </div>
        </div>
        {fields.time && <div style={{ margin: '-4px 0 12px' }}><span className="field-error">{fields.time}</span></div>}
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
        {quotaReached ? (
          <Alert tone="warning">Bạn đã có 2 chỗ đang giữ — hủy bớt trước khi giữ thêm.</Alert>
        ) : (
          <Button block onClick={() => void handleReserve()} disabled={busy} aria-busy={busy}>
            {busy ? 'Đang giữ chỗ…' : 'Giữ chỗ'}
          </Button>
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
            Hiệu lực {success.start_time}–{success.end_time} hôm nay · Tự hủy sau 20 phút quá giờ hẹn nếu chưa check-in.
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
          <EmptyState title="Chưa có vé giữ chỗ" hint="Chọn khu + khung giờ trong hôm nay rồi bấm Giữ chỗ — mã R-… dùng để check-in tại quầy." />
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
              <div key={r.code} className="card" style={r.status !== 'pending' ? { opacity: 0.75 } : undefined}>
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
                  Khu {r.zone_code ?? '—'} · {formatDateShort(r.date)} {r.start_time}–{r.end_time} · Biển số <span className="mono">{r.license_plate}</span>
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
    </div>
  );
}
