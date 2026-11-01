// Fee calculator unit tests — run with: npx vitest run src/main/fee-calculator.spec.ts
// Covers the 4 mandatory manual cases: 30 min, 2h, overnight, monthly pass (+ extras).
import { describe, expect, it } from 'vitest';
import { calculateFee, calculatePassPrice } from './fee-calculator';

const HOURLY = 20000;
const DAILY = 150000;

describe('calculateFee', () => {
  it('case 1: 30 minutes -> billed minimum 1 hour', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 08:00:00',
      checkOutAt: '2026-10-16 08:30:00',
      hourlyRate: HOURLY,
      dailyRate: DAILY,
    });
    expect(r.minutes).toBe(30);
    expect(r.billedHours).toBe(1);
    expect(r.appliedDailyRate).toBe(false);
    expect(r.grossFee).toBe(20000);
    expect(r.totalFee).toBe(20000);
  });

  it('case 2: 2 hours -> 2 x hourly', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 08:00:00',
      checkOutAt: '2026-10-16 10:00:00',
      hourlyRate: HOURLY,
      dailyRate: DAILY,
    });
    expect(r.billedHours).toBe(2);
    expect(r.appliedDailyRate).toBe(false);
    expect(r.totalFee).toBe(40000);
  });

  it('case 2b: 2h05 -> ceil to 3 hours', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 08:00:00',
      checkOutAt: '2026-10-16 10:05:00',
      hourlyRate: HOURLY,
      dailyRate: DAILY,
    });
    expect(r.billedHours).toBe(3);
    expect(r.totalFee).toBe(60000);
  });

  it('case 3: overnight -> daily rate (1 x daily)', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 22:00:00',
      checkOutAt: '2026-10-17 06:00:00',
      hourlyRate: HOURLY,
      dailyRate: DAILY,
    });
    expect(r.appliedDailyRate).toBe(true);
    expect(r.dayCount).toBe(1);
    expect(r.totalFee).toBe(150000);
  });

  it('case 3b: same-day 13h -> daily rate', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 06:00:00',
      checkOutAt: '2026-10-16 19:00:00',
      hourlyRate: HOURLY,
      dailyRate: DAILY,
    });
    expect(r.billedHours).toBe(13);
    expect(r.appliedDailyRate).toBe(true);
    expect(r.totalFee).toBe(150000);
  });

  it('case 4: valid monthly pass -> total 0', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 08:00:00',
      checkOutAt: '2026-10-16 18:00:00', // 10h, would be 200k hourly
      hourlyRate: HOURLY,
      dailyRate: DAILY,
      hasValidPass: true,
    });
    expect(r.totalFee).toBe(0);
  });

  it('discount reduces total, floored at 0', () => {
    const r = calculateFee({
      checkInAt: '2026-10-16 08:00:00',
      checkOutAt: '2026-10-16 09:00:00',
      hourlyRate: HOURLY,
      dailyRate: DAILY,
      discountAmount: 50000,
    });
    expect(r.grossFee).toBe(20000);
    expect(r.totalFee).toBe(0);
  });

  it('rejects check-out before check-in', () => {
    expect(() =>
      calculateFee({
        checkInAt: '2026-10-16 10:00:00',
        checkOutAt: '2026-10-16 09:00:00',
        hourlyRate: HOURLY,
        dailyRate: DAILY,
      }),
    ).toThrow();
  });
});

describe('calculatePassPrice', () => {
  it('12-month pack gets 10% off', () => {
    expect(calculatePassPrice(300000, 12)).toBe(3240000);
  });
  it('other packs pay full', () => {
    expect(calculatePassPrice(300000, 3)).toBe(900000);
  });
});
