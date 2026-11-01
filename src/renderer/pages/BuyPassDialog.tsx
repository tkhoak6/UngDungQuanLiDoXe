import { useMemo, useState, type JSX } from 'react';
import { Alert, Button, Dialog } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatVND, todayLocal } from '../lib/format';
import type { CustomerVehicle, MonthlyPass, ParkingZone } from '../types';

const PACKS = [1, 3, 6, 12] as const;
type PackMonths = (typeof PACKS)[number];
const ALL_ZONE_BASE = 300000;

interface BuyPassDialogProps {
  vehicle: CustomerVehicle;
  zones: ParkingZone[];
  onClose: () => void;
  onSuccess: (pass: MonthlyPass) => void;
}

/**
 * FE-014 (customer P3, spec §P3.1 Section B): dialog "Mua vé tháng" cho 1 xe.
 * Chọn khu + gói 1/3/6/12 + preview giá + ngày bắt đầu, ghi chú trả tiền tại
 * quầy. Tạo vé `pending` → badge "Chờ xác nhận" (KHÔNG thanh toán online).
 */
export function BuyPassDialog({ vehicle, zones, onClose, onSuccess }: BuyPassDialogProps): JSX.Element {
  const compatible = useMemo(
    () => zones.filter((z) => z.vehicle_type_allowed === 'both' || z.vehicle_type_allowed === vehicle.vehicle_type),
    [zones, vehicle.vehicle_type],
  );
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [months, setMonths] = useState<PackMonths>(1);
  const [startDate, setStartDate] = useState(todayLocal());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedZone = zoneId === null ? undefined : compatible.find((z) => z.id === zoneId);
  const base = selectedZone ? selectedZone.price_per_day * 30 : ALL_ZONE_BASE;
  const total = months === 12 ? Math.round(base * months * 0.9) : base * months;

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!startDate) {
      setError('Vui lòng chọn ngày bắt đầu.');
      return;
    }
    setBusy(true);
    const res = await callApi(
      (a) => a.requestPass({ vehicle_id: vehicle.id, zone_id: zoneId, package_months: months, start_date: startDate }),
      () => mockApi.requestPass({ vehicle_id: vehicle.id, zone_id: zoneId, package_months: months, start_date: startDate }),
    );
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Gửi đăng ký thất bại');
      return;
    }
    onSuccess(res.data);
  }

  return (
    <Dialog title={`Mua vé tháng — ${vehicle.license_plate}`} onClose={onClose}>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="field">
        <label htmlFor="buy-zone">Khu vực áp dụng</label>
        <select
          id="buy-zone"
          className="select"
          value={zoneId ?? ''}
          onChange={(e) => setZoneId(e.target.value === '' ? null : Number(e.target.value))}
          aria-describedby="buy-zone-hint"
        >
          <option value="">Mọi khu vực</option>
          {compatible.map((z) => (
            <option key={z.id} value={z.id}>
              Khu {z.code} — {z.name}
            </option>
          ))}
        </select>
        <span id="buy-zone-hint" className="field-hint">
          Chỉ hiện khu nhận {vehicle.vehicle_type === 'car' ? 'ô tô' : 'xe máy'}.
        </span>
      </div>
      <fieldset className="field" style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
        <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Gói vé</legend>
        <div role="radiogroup" aria-label="Gói vé tháng" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {PACKS.map((m) => {
            const price = m === 12 ? Math.round(base * m * 0.9) : base * m;
            const checked = months === m;
            return (
              <label
                key={m}
                style={{
                  border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  borderRadius: 8,
                  padding: '8px 4px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: checked ? 'var(--color-primary-tint)' : 'var(--color-surface)',
                }}
              >
                <input
                  type="radio"
                  name="buy-pack"
                  value={m}
                  checked={checked}
                  onChange={() => setMonths(m)}
                  style={{ marginRight: 4 }}
                />
                <strong style={{ fontSize: 14 }}>{m} tháng</strong>
                <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>{formatVND(price)}</div>
              </label>
            );
          })}
        </div>
        {months === 12 && <span className="field-hint">Gói 12 tháng −10%.</span>}
      </fieldset>
      <div className="field">
        <label htmlFor="buy-start">Ngày bắt đầu * (dd/mm/yyyy)</label>
        <input
          id="buy-start"
          className="input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <div className="receipt" style={{ marginTop: 8 }}>
        <div className="row">
          <span>Tạm tính ({months} tháng{selectedZone ? ` · Khu ${selectedZone.code}` : ' · Mọi khu'})</span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 700 }} aria-live="polite">
            {formatVND(total)}
          </span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-60)', margin: '8px 0 0' }}>
        Không thanh toán online — bạn trả tiền mặt/chuyển khoản tại quầy khi nhận vé.
      </p>
      <div className="dialog-foot">
        <button className="btn btn-neutral" onClick={onClose}>Hủy</button>
        <Button onClick={() => void handleSubmit()} disabled={busy} aria-busy={busy}>
          {busy ? 'Đang gửi…' : 'Gửi đăng ký'}
        </Button>
      </div>
    </Dialog>
  );
}
