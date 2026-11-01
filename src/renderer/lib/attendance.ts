import { formatVND } from './format';

// Shared attendance helpers (FE-019 S3) — dùng chung cho AttendancePage +
// AttendanceTable (tránh duplicate logic giờ trực / định dạng tiền).

export function attendanceShiftDate(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isForbiddenError(err: string): boolean {
  return /FORBIDDEN/i.test(err);
}

/** 'YYYY-MM-DD HH:mm:ss' → 'HH:mm', null/invalid → '—'. */
export function fmtHM(iso: string | null): string {
  if (!iso) return '—';
  const t = iso.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(t) ? t : '—';
}

/** 'Xh Ym' giữa 2 timestamp (mặc định đến = bây giờ). */
export function elapsedHM(fromIso: string, toIso?: string): string {
  const from = new Date(fromIso.replace(' ', 'T')).getTime();
  const to = toIso ? new Date(toIso.replace(' ', 'T')).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—';
  const mins = Math.floor((to - from) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** ±X ₫ có dấu cho chênh lệch đối soát. */
export function fmtSigned(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${formatVND(Math.abs(n))}`;
}
