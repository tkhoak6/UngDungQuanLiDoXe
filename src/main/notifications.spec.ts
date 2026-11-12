// BE-021: unit test pure helpers của notifications.ts (không DB, không Electron).
import { describe, expect, it } from 'vitest';
import {
  DEFER_HOUR,
  DEFER_MINUTE,
  E1_D0_MIN_HOUR,
  E2_LEAD_MINUTES,
  QUIET_END_HOUR,
  QUIET_START_HOUR,
  daysLeft,
  formatVnDate,
  isQuietHour,
  localDay,
  msUntil,
  reservationStart,
  shiftEndDate,
  vnd,
} from './notifications';

describe('isQuietHour (22:00–06:00)', () => {
  it('đêm 23:00 + rạng sáng 05:59 là quiet', () => {
    expect(isQuietHour(new Date(2026, 10, 12, 23, 0))).toBe(true);
    expect(isQuietHour(new Date(2026, 10, 12, 5, 59))).toBe(true);
  });
  it(`biên ${QUIET_START_HOUR}:00 quiet, ${QUIET_END_HOUR}:00 hết quiet`, () => {
    expect(isQuietHour(new Date(2026, 10, 12, 22, 0))).toBe(true);
    expect(isQuietHour(new Date(2026, 10, 12, 6, 0))).toBe(false);
  });
  it('ban ngày không quiet', () => {
    expect(isQuietHour(new Date(2026, 10, 12, 12, 0))).toBe(false);
    expect(isQuietHour(new Date(2026, 10, 12, 7, 30))).toBe(false);
  });
});

describe('daysLeft (calendar hôm nay → 0)', () => {
  it('cuối ngày hôm nay → 0', () => {
    expect(daysLeft('2026-11-12', new Date(2026, 10, 12, 8, 0))).toBe(0);
  });
  it('cách 3 ngày → 3', () => {
    expect(daysLeft('2026-11-15', new Date(2026, 10, 12, 12, 0))).toBe(3);
  });
  it('đã qua → -1', () => {
    expect(daysLeft('2026-11-11', new Date(2026, 10, 12, 8, 0))).toBe(-1);
  });
  it('sai format → -1', () => {
    expect(daysLeft('not-a-date', new Date())).toBe(-1);
  });
});

describe('E2 fire time (start − 20p)', () => {
  it('08:00 → 07:40 cùng ngày', () => {
    const s = reservationStart('2026-11-12', '08:00');
    expect(s).not.toBeNull();
    const fire = new Date((s as Date).getTime() - E2_LEAD_MINUTES * 60_000);
    expect(fire.getHours()).toBe(7);
    expect(fire.getMinutes()).toBe(40);
  });
  it('qua đêm 23:50 → fire 23:30 (không tràn ngày sai)', () => {
    const s = reservationStart('2026-11-12', '23:50');
    expect(s).not.toBeNull();
    const fire = new Date((s as Date).getTime() - E2_LEAD_MINUTES * 60_000);
    expect(localDay(fire)).toBe('2026-11-12');
    expect(fire.getHours()).toBe(23);
    expect(fire.getMinutes()).toBe(30);
  });
});

describe('shiftEndDate (ca đêm end <= start → +1 ngày)', () => {
  it('ca sáng 06:00–14:00 cùng ngày', () => {
    const e = shiftEndDate('2026-11-12', '06:00', '14:00');
    expect(e).not.toBeNull();
    expect(localDay(e as Date)).toBe('2026-11-12');
  });
  it('ca đêm 22:00–06:00 sang hôm sau', () => {
    const e = shiftEndDate('2026-11-12', '22:00', '06:00');
    expect(e).not.toBeNull();
    expect(localDay(e as Date)).toBe('2026-11-13');
  });
});

describe('msUntil (daily 06:30 / hoãn 06:05)', () => {
  it('trước giờ hẹn cùng ngày', () => {
    const ms = msUntil(6, 30, new Date(2026, 10, 12, 5, 0));
    expect(ms).toBe(90 * 60_000);
  });
  it('sau giờ hẹn → hôm sau', () => {
    const ms = msUntil(DEFER_HOUR, DEFER_MINUTE, new Date(2026, 10, 12, 23, 0));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 3600_000);
  });
});

describe('format copy VN', () => {
  it('dd/mm/yyyy', () => {
    expect(formatVnDate('2026-11-15')).toBe('15/11/2026');
  });
  it('tiền vi-VN ₫', () => {
    expect(vnd(300000)).toBe('300.000₫');
  });
  it(`D-0 chỉ bắn từ ${E1_D0_MIN_HOUR}:00 (quy ước spec §1.1)`, () => {
    expect(E1_D0_MIN_HOUR).toBe(7);
  });
});
