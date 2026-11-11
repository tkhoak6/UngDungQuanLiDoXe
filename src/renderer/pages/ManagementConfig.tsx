// Management M2 — Cấu hình: giá khu (mở rộng inline) + ca (deep-link) +
// quy tắc phí + thông tin bãi (qua app-config:get/set, cache localStorage).
// Spec ./specs/management-area.md §M2 (nối BE-015). Không bảng DB mới.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Alert, Button, Dialog, EmptyState, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { isValidVNPhone } from '../lib/format';
import { DEFAULT_SETTINGS, readSettingsCache, writeSettingsCache } from '../lib/management';
import { ManagementConfigPrices } from './ManagementConfigPrices';
import { ManagementConfigServer } from './ManagementConfigServer';
import type { ParkingSettings, ParkingZone, Shift } from '../types';

type Status = 'loading' | 'error' | 'ready';

let toastSeq = 600;

interface Props {
  onGoShifts: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function ManagementConfig({ onGoShifts, onDirtyChange }: Props): JSX.Element {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [zones, setZones] = useState<ParkingZone[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  // Quy tắc phí
  const [grace, setGrace] = useState('30');
  const [threshold, setThreshold] = useState('12');
  const [feeConfirm, setFeeConfirm] = useState(false);
  // Thông tin bãi
  const [lotName, setLotName] = useState(DEFAULT_SETTINGS.lot_name);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState('');
  // Máy chủ PocketBase (FE-022 — section con tự fetch pb:status + lưu riêng)
  const [pbUrl, setPbUrl] = useState<string | null>(DEFAULT_SETTINGS.pb_url);
  const [pbLot, setPbLot] = useState<string | null>(DEFAULT_SETTINGS.pb_parking_lot);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dirtyRef = useRef(false);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
    onDirtyChange(d);
  }, [onDirtyChange]);

  const load = useCallback(async () => {
    setStatus('loading');
    const cached = readSettingsCache();
    setLotName(cached.lot_name);
    setAddress(cached.address ?? '');
    setPhone(cached.phone ?? '');
    setLogo(cached.logo_data_url);
    setGrace(String(cached.fee_grace_minutes));
    setThreshold(String(cached.fee_day_threshold_hours));
    setPbUrl(cached.pb_url);
    setPbLot(cached.pb_parking_lot);
    setSavedAt(cached.updated_at);
    const [zRes, sRes, cRes] = await Promise.all([
      callApi((a) => a.listZones(), () => mockApi.listZones()),
      callApi((a) => a.listShifts(), () => mockApi.listShifts()),
      callApi((a) => a.getAppConfig(), () => mockApi.getAppConfig()),
    ]);
    if (!zRes.ok) {
      setError(zRes.error ?? 'Lỗi tải cấu hình');
      setStatus('error');
      return;
    }
    setZones(zRes.data ?? []);
    if (sRes.ok && sRes.data) setShifts(sRes.data);
    if (cRes.ok && cRes.data) {
      const s = cRes.data;
      setLotName(s.lot_name);
      setAddress(s.address ?? '');
      setPhone(s.phone ?? '');
      setLogo(s.logo_data_url);
      setGrace(String(s.fee_grace_minutes));
      setThreshold(String(s.fee_day_threshold_hours));
      setPbUrl(s.pb_url);
      setPbLot(s.pb_parking_lot);
      setSavedAt(s.updated_at);
      writeSettingsCache(s);
    }
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ---- quy tắc phí ----
  const graceN = Number(grace);
  const thresholdN = Number(threshold);
  const feeValid = Number.isInteger(graceN) && graceN >= 0 && graceN <= 120
    && Number.isInteger(thresholdN) && thresholdN >= 1 && thresholdN <= 24
    && thresholdN * 60 > graceN;

  async function saveFeeRule(): Promise<void> {
    if (!feeValid) return;
    const res = await callApi(
      (a) => a.setAppConfig({ fee_grace_minutes: graceN, fee_day_threshold_hours: thresholdN }),
      () => mockApi.setAppConfig({ fee_grace_minutes: graceN, fee_day_threshold_hours: thresholdN }),
    );
    setFeeConfirm(false);
    if (!res.ok || !res.data) {
      pushToast('danger', res.error ?? 'Lưu quy tắc thất bại');
      return;
    }
    writeSettingsCache(res.data);
    setDirty(false);
    pushToast('success', 'Đã lưu quy tắc tính phí — áp dụng vé mới từ bây giờ.');
  }

  // ---- thông tin bãi ----
  const infoValid = lotName.trim().length >= 1 && lotName.trim().length <= 100
    && address.trim().length <= 255
    && (phone.trim() === '' || isValidVNPhone(phone));

  async function saveSiteInfo(): Promise<void> {
    const errs: Record<string, string> = {};
    if (lotName.trim().length < 1) errs.lot_name = 'Tên bãi là bắt buộc.';
    if (address.trim().length > 255) errs.address = `Địa chỉ tối đa 255 ký tự (${address.trim().length}/255).`;
    if (phone.trim() !== '' && !isValidVNPhone(phone)) errs.phone = 'SĐT chưa đúng — VD 0901234567.';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const res = await callApi(
      (a) => a.setAppConfig({
        lot_name: lotName.trim(),
        address: address.trim() === '' ? null : address.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        logo_data_url: logo,
      }),
      () => mockApi.setAppConfig({
        lot_name: lotName.trim(),
        address: address.trim() === '' ? null : address.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        logo_data_url: logo,
      }),
    );
    if (!res.ok || !res.data) {
      if (res.fields) setFieldErrors(res.fields);
      pushToast('danger', res.error ?? 'Lưu thông tin thất bại');
      return;
    }
    writeSettingsCache(res.data);
    setSavedAt(res.data.updated_at);
    setDirty(false);
    pushToast('success', 'Đã lưu thông tin bãi xe.');
  }

  function handleLogoFile(file: File | undefined): void {
    setLogoError('');
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setLogoError('Logo chỉ nhận PNG/JPG.');
      return;
    }
    if (file.size > 512 * 1024) {
      setLogoError('Logo quá 512KB — nén ảnh trước khi tải lên.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(typeof reader.result === 'string' ? reader.result : null);
      setDirty(true);
    };
    reader.readAsDataURL(file);
  }

  function markDirty(): void {
    if (!dirtyRef.current) setDirty(true);
  }

  if (status === 'loading') {
    return <div className="card" aria-busy="true" aria-label="Đang tải cấu hình"><SkeletonRows rows={8} /></div>;
  }
  if (status === 'error') return <div className="card"><RetryPanel message={error} onRetry={() => void load()} /></div>;

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ManagementConfigPrices zones={zones} onSaved={setZones} notify={pushToast} />
      <ManagementConfigServer initialUrl={pbUrl} initialLot={pbLot} onDirty={markDirty} notify={pushToast} />

      <section className="card" aria-labelledby="cfg-shifts">
        <h3 id="cfg-shifts" style={{ margin: '0 0 8px', fontSize: 16 }}>Khung ca làm việc</h3>
        <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 14 }}>
          {shifts.filter((s) => s.is_active === 1).map((s) => (
            <li key={s.id}><span className="mono">{s.start_time}–{s.end_time}</span> · {s.name}</li>
          ))}
        </ul>
        <button className="btn btn-neutral" onClick={onGoShifts}>Quản lý khung ca →</button>
      </section>

      <section className="card" aria-labelledby="cfg-fee">
        <h3 id="cfg-fee" style={{ margin: '0 0 8px', fontSize: 16 }}>Quy tắc tính phí</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label htmlFor="fee-grace">Miễn/tối thiểu (phút)</label>
            <input
              id="fee-grace" className="input" inputMode="numeric" type="number" min={0} max={120}
              value={grace}
              onChange={(e) => { setGrace(e.target.value); markDirty(); }}
            />
          </div>
          <div className="field">
            <label htmlFor="fee-threshold">Ngưỡng áp giá ngày (giờ)</label>
            <input
              id="fee-threshold" className="input" inputMode="numeric" type="number" min={1} max={24}
              value={threshold}
              onChange={(e) => { setThreshold(e.target.value); markDirty(); }}
            />
          </div>
        </div>
        {!feeValid && (
          <Alert tone="danger">Miễn/tối thiểu 0–120 phút · Ngưỡng ngày 1–24 giờ · Ngưỡng ngày phải lớn hơn thời gian tối thiểu.</Alert>
        )}
        <p style={{ fontSize: 12, color: 'var(--color-text-60)' }}>
          VD: gửi 45 phút → tính 1 giờ × đơn giá; ≥{threshold}h → áp giá ngày.
        </p>
        <div className="alert alert-warning" role="note" style={{ marginBottom: 12 }}>
          Đổi quy tắc chỉ áp dụng vé mới check-in sau lúc lưu (vé đang đỗ giữ giá cũ đã snapshot).
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button disabled={!feeValid} onClick={() => setFeeConfirm(true)}>Lưu quy tắc</Button>
          <button
            className="btn btn-ghost"
            onClick={() => { setGrace('30'); setThreshold('12'); markDirty(); }}
          >
            Khôi phục mặc định (30p / 12h)
          </button>
        </div>
      </section>

      <section className="card" aria-labelledby="cfg-site">
        <h3 id="cfg-site" style={{ margin: '0 0 8px', fontSize: 16 }}>Thông tin bãi xe</h3>
        <div className="field">
          <label htmlFor="site-name">Tên bãi *</label>
          <input
            id="site-name" className="input" value={lotName}
            onChange={(e) => { setLotName(e.target.value); markDirty(); }}
            aria-invalid={Boolean(fieldErrors.lot_name)}
          />
          {fieldErrors.lot_name && <span className="field-error">{fieldErrors.lot_name}</span>}
        </div>
        <div className="field">
          <label htmlFor="site-address">Địa chỉ</label>
          <input
            id="site-address" className="input" value={address}
            onChange={(e) => { setAddress(e.target.value); markDirty(); }}
            aria-invalid={Boolean(fieldErrors.address)}
            aria-describedby="site-address-hint"
          />
          <span id="site-address-hint" className="field-hint">{address.trim().length}/255</span>
          {fieldErrors.address && <span className="field-error">{fieldErrors.address}</span>}
        </div>
        <div className="field">
          <label htmlFor="site-phone">SĐT *</label>
          <input
            id="site-phone" className="input" inputMode="tel" value={phone}
            placeholder="VD 0901234567"
            onChange={(e) => { setPhone(e.target.value); markDirty(); }}
            aria-invalid={Boolean(fieldErrors.phone)}
          />
          {fieldErrors.phone && <span className="field-error">{fieldErrors.phone}</span>}
        </div>
        <div className="field">
          <label htmlFor="site-logo">Logo (PNG/JPG ≤ 512KB)</label>
          <input
            id="site-logo" type="file" accept="image/png,image/jpeg"
            onChange={(e) => handleLogoFile(e.target.files?.[0])}
          />
          {logoError && <span className="field-error">{logoError}</span>}
          {logo && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <img src={logo} alt="Logo bãi xe" style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 12, border: '1px solid var(--color-border-strong)' }} />
              <button className="btn btn-ghost btn-sm" aria-label="Xóa logo" onClick={() => { setLogo(null); markDirty(); }}>Xóa logo</button>
            </div>
          )}
        </div>
        <div className="card" role="img" aria-label={`Xem trước hóa đơn: ${lotName}, ${address}, ${phone}`} style={{ background: 'var(--color-bg)', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {logo && <img src={logo} alt="" aria-hidden="true" style={{ width: 40, height: 40, objectFit: 'contain' }} />}
            <div>
              <div style={{ fontWeight: 700 }}>{lotName || '(chưa đặt tên)'}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{address || '(chưa có địa chỉ)'} · {phone || '(chưa có SĐT)'}</div>
            </div>
          </div>
        </div>
        <Button disabled={!infoValid} onClick={() => void saveSiteInfo()}>Lưu thông tin</Button>
        {savedAt && (
          <p style={{ fontSize: 12, color: 'var(--color-text-60)' }}>Lưu lần cuối: <span className="mono">{savedAt}</span></p>
        )}
      </section>

      {feeConfirm && (
        <Dialog title="Lưu quy tắc tính phí?" onClose={() => setFeeConfirm(false)} label="Xác nhận lưu quy tắc phí">
          <p style={{ fontSize: 14 }}>
            Miễn/tối thiểu: <strong className="mono">{grace} phút</strong> · Ngưỡng ngày:{' '}
            <strong className="mono">{threshold} giờ</strong> (áp dụng vé mới từ bây giờ).
          </p>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setFeeConfirm(false)}>Hủy</button>
            <Button onClick={() => void saveFeeRule()}>Xác nhận</Button>
          </div>
        </Dialog>
      )}

      {zones.length === 0 && (
        <div className="card">
          <EmptyState title="Chưa có khu vực nào" hint="Tạo khu vực trước khi cấu hình giá." />
        </div>
      )}

      <Toasts items={toasts} />
    </div>
  );
}
