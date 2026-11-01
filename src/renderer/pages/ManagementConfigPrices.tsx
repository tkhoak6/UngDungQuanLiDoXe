// Management M2 — card "Giá theo khu": inline-edit giá trong table Khu vực
// (mở rộng màn hiện có, không tab mới — spec M2.1). Enter lưu / Esc hủy;
// giá ngày < giá giờ → confirm lần 2 (Warning, không chặn — spec M2.3).

import { useState, type JSX } from 'react';
import { Button, Dialog } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatVND } from '../lib/format';
import type { ParkingZone } from '../types';

type Field = 'price_per_hour' | 'price_per_day';

interface Props {
  zones: ParkingZone[];
  onSaved: (zones: ParkingZone[]) => void;
  notify: (tone: 'success' | 'danger', text: string) => void;
}

export function ManagementConfigPrices({ zones, onSaved, notify }: Props): JSX.Element {
  const [priceCell, setPriceCell] = useState<{ id: number; field: Field } | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [priceConfirm, setPriceConfirm] = useState<{ zone: ParkingZone; field: Field; value: number } | null>(null);

  function startPriceEdit(z: ParkingZone, field: Field): void {
    setPriceCell({ id: z.id, field });
    setPriceDraft(String(z[field]));
  }

  async function commitPrice(): Promise<void> {
    if (!priceCell) return;
    const zone = zones.find((z) => z.id === priceCell.id);
    if (!zone) { setPriceCell(null); return; }
    const value = Number(priceDraft);
    if (!Number.isFinite(value) || value <= 0) {
      notify('danger', 'Giá giờ/giá ngày phải > 0.');
      return;
    }
    const other = priceCell.field === 'price_per_hour' ? zone.price_per_day : zone.price_per_hour;
    const dayAfter = priceCell.field === 'price_per_day' ? value : other;
    const hourAfter = priceCell.field === 'price_per_hour' ? value : other;
    if (dayAfter < hourAfter) {
      setPriceConfirm({ zone, field: priceCell.field, value });
      return;
    }
    await savePrice(zone.id, priceCell.field, value);
  }

  async function savePrice(id: number, field: Field, value: number): Promise<void> {
    const res = await callApi((a) => a.updateZone(id, { [field]: value }), () => mockApi.updateZone(id, { [field]: value }));
    setPriceConfirm(null);
    setPriceCell(null);
    if (!res.ok || !res.data) {
      notify('danger', res.error ?? 'Lưu giá thất bại');
      return;
    }
    onSaved(zones.map((z) => (z.id === id ? res.data as ParkingZone : z)));
    notify('success', `Đã cập nhật giá khu ${res.data.code} — áp dụng vé mới từ bây giờ.`);
  }

  return (
    <>
      <section className="card" aria-labelledby="cfg-price">
        <h3 id="cfg-price" style={{ margin: '0 0 8px', fontSize: 16 }}>Giá theo khu</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-60)', margin: '0 0 12px' }}>
          Bấm vào giá để sửa nhanh (Enter lưu · Esc hủy). Giá mới chỉ áp dụng vé check-in sau lúc lưu.
        </p>
        <table className="grid">
          <thead>
            <tr><th scope="col">Khu</th><th scope="col">Giá giờ</th><th scope="col">Giá ngày</th></tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td><strong>{z.name}</strong> <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{z.code}</span></td>
                {(['price_per_hour', 'price_per_day'] as const).map((field) => (
                  <td className="mono" key={field}>
                    {priceCell?.id === z.id && priceCell.field === field ? (
                      <input
                        className="input input-mono"
                        style={{ width: 140 }}
                        inputMode="decimal"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        aria-label={`${field === 'price_per_hour' ? 'Giá giờ' : 'Giá ngày'} khu ${z.code} (VND)`}
                        value={priceDraft}
                        onChange={(e) => setPriceDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitPrice();
                          if (e.key === 'Escape') setPriceCell(null);
                        }}
                        onBlur={() => setPriceCell(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="th-sort mono"
                        aria-label={`Sửa ${field === 'price_per_hour' ? 'giá giờ' : 'giá ngày'} khu ${z.code}, hiện tại ${formatVND(z[field])}`}
                        onClick={() => startPriceEdit(z, field)}
                      >
                        {formatVND(z[field])}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {priceConfirm && (
        <Dialog title="Xác nhận giá ngày thấp hơn giá giờ?" onClose={() => setPriceConfirm(null)} label="Xác nhận giá ngày khuyến mãi">
          <p style={{ fontSize: 14 }}>
            Giá ngày <strong className="mono">{formatVND(priceConfirm.value)}</strong> thấp hơn giá giờ{' '}
            <strong className="mono">{formatVND(priceConfirm.field === 'price_per_day' ? priceConfirm.zone.price_per_hour : priceConfirm.zone.price_per_day)}</strong>{' '}
            (khu {priceConfirm.zone.code}) — xác nhận?
          </p>
          <div className="dialog-foot">
            <button className="btn btn-neutral" onClick={() => setPriceConfirm(null)}>Hủy</button>
            <Button onClick={() => void savePrice(priceConfirm.zone.id, priceConfirm.field, priceConfirm.value)}>Xác nhận</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
