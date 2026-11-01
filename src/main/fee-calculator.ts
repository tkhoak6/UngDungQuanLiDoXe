// Pure fee calculator — no DB, no side effects. Fully unit-testable.
// Formula (api-contract.md §8 + specs/parking-app.md §d):
//   minutes = out - in
//   minutes <= grace (default 30p, app-config fee_grace_minutes) -> billed as 1 hour
//   else hours = ceil(minutes / 60)
//   overnight (calendar day differs) OR hours >= dayThreshold (default 12,
//   app-config fee_day_threshold_hours) -> daily rate
//     day_count = number of calendar days touched (>= 1), fee = day_count * daily_rate
//   else fee = hours * hourly_rate
//   monthly pass valid at checkout -> total = 0
//   total = max(0, gross - discount)

export interface FeeCalcInput {
  checkInAt: string | Date;
  checkOutAt: string | Date;
  hourlyRate: number;
  dailyRate: number;
  hasValidPass?: boolean;
  discountAmount?: number;
}

export interface FeeCalcResult {
  minutes: number;
  billedHours: number;
  appliedDailyRate: boolean;
  dayCount: number;
  grossFee: number;
  discountAmount: number;
  totalFee: number;
}

function toDate(v: string | Date): Date {
  // SQLite stores "YYYY-MM-DD HH:MM:SS" (UTC). Parse as UTC explicitly.
  if (v instanceof Date) return v;
  const iso = v.includes('T') ? v : v.replace(' ', 'T') + 'Z';
  return new Date(iso);
}

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface FeeCalcOptions {
  graceMinutes?: number; // default 30 — đọc từ app-config (fee_grace_minutes), M2.2
  dayThresholdHours?: number; // default 12 — đọc từ app-config (fee_day_threshold_hours), M2.2
}

export function calculateFee(input: FeeCalcInput, opts?: FeeCalcOptions): FeeCalcResult {
  const inAt = toDate(input.checkInAt);
  const outAt = toDate(input.checkOutAt);
  if (Number.isNaN(inAt.getTime()) || Number.isNaN(outAt.getTime())) {
    throw new Error('Invalid check-in/check-out datetime');
  }
  if (outAt.getTime() <= inAt.getTime()) {
    throw new Error('check_out_at must be after check_in_at');
  }
  const hourlyRate = Math.max(0, Math.floor(input.hourlyRate));
  const dailyRate = Math.max(0, Math.floor(input.dailyRate));
  const discount = Math.max(0, Math.floor(input.discountAmount ?? 0));

  const minutes = Math.ceil((outAt.getTime() - inAt.getTime()) / 60000);
  const grace = opts?.graceMinutes ?? 30;
  const dayThreshold = opts?.dayThresholdHours ?? 12;
  const billedHours = minutes <= grace ? 1 : Math.ceil(minutes / 60);

  const overnight = startOfUtcDay(outAt) !== startOfUtcDay(inAt);
  const appliedDailyRate = overnight || billedHours >= dayThreshold;

  let dayCount = 0;
  let grossFee: number;
  if (appliedDailyRate) {
    // One daily unit per 24h block touched (overnight 22:00->06:00 = 1 day,
    // 3-day stay = 3 days). Same-day 12h+ stint = 1 day.
    dayCount = Math.max(1, Math.ceil(billedHours / 24));
    grossFee = dayCount * dailyRate;
  } else {
    grossFee = billedHours * hourlyRate;
  }

  if (input.hasValidPass) {
    return { minutes, billedHours, appliedDailyRate, dayCount, grossFee, discountAmount: 0, totalFee: 0 };
  }
  const totalFee = Math.max(0, grossFee - discount);
  return { minutes, billedHours, appliedDailyRate, dayCount, grossFee, discountAmount: discount, totalFee };
}

/** Monthly-pass package price: 12-month pack gets 10% off (spec §e). */
export function calculatePassPrice(monthlyBasePrice: number, months: 1 | 3 | 6 | 12): number {
  const gross = monthlyBasePrice * months;
  if (months === 12) return Math.round(gross * 0.9);
  return gross;
}
