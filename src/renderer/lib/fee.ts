// Fee preview — mirrors backend formula (api-contract.md §8) for DISPLAY ONLY.
// Backend is the source of truth at check-out; this preview must show the
// rule line "≤30 phút đầu: làm tròn 1 giờ. Qua đêm: áp giá ngày."

export interface FeeBreakdown {
  minutes: number;
  billedHours: number;
  usesDailyCap: boolean;
  gross: number;
  discount: number;
  total: number;
  lines: Array<{ label: string; amount: number }>;
}

export function previewFee(
  checkInAt: string,
  checkOutAt: string,
  hourlyRate: number,
  dailyRate: number,
  discount = 0,
  isMonthlyPass = false,
): FeeBreakdown {
  const minutes = Math.max(0, Math.round((new Date(checkOutAt).getTime() - new Date(checkInAt).getTime()) / 60000));
  if (isMonthlyPass) {
    return { minutes, billedHours: 0, usesDailyCap: false, gross: 0, discount: 0, total: 0, lines: [{ label: 'Vé tháng còn hiệu lực', amount: 0 }] };
  }
  if (minutes <= 30) {
    const gross = hourlyRate;
    return {
      minutes, billedHours: 1, usesDailyCap: false, gross, discount,
      total: Math.max(0, gross - discount),
      lines: [{ label: '≤ 30 phút — làm tròn 1 giờ', amount: hourlyRate }],
    };
  }
  const billedHours = Math.ceil(minutes / 60);
  const usesDailyCap = billedHours >= 12;
  const gross = usesDailyCap ? dailyRate : billedHours * hourlyRate;
  return {
    minutes, billedHours, usesDailyCap, gross, discount,
    total: Math.max(0, gross - discount),
    lines: usesDailyCap
      ? [{ label: `Qua đêm / ≥12 giờ — áp giá ngày`, amount: dailyRate }]
      : [{ label: `${billedHours} giờ × ${hourlyRate.toLocaleString('vi-VN')} ₫`, amount: gross }],
  };
}

export function zoneOccupancyRate(occupied: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return occupied / capacity;
}

/** Status bucket per DESIGN.md §10.1. */
export function occupancyBucket(rate: number): 'ok' | 'warning' | 'full' {
  if (rate >= 1) return 'full';
  if (rate >= 0.85) return 'warning';
  return 'ok';
}
