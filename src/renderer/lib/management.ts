// Management area (M1–M3) shared helpers — period math, aggregate compose,
// settings cache, zero-dep .xls download. No IPC here (see lib/api.ts).

import type { ParkingSettings, RevenueDaily, SessionsDaily, TxKind } from '../types';

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface DayAgg {
  day: string;
  entries: number;
  exits: number;
  casual: number;
  monthly: number;
  total: number;
}

export function shiftDate(base: string, delta: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daySpanDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const diff = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  return Number.isFinite(diff) ? diff : 0;
}

/** Kỳ B default = kỳ liền trước cùng độ dài (spec M1.1). */
export function defaultPrevPeriod(from: string, to: string): { from: string; to: string } {
  const span = Math.max(1, daySpanDays(from, to));
  return { from: shiftDate(from, -span), to: shiftDate(from, -1) };
}

/** Hai kỳ giao nhau → Warning (không chặn), spec M1.3. */
export function periodsOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  if (!aFrom || !aTo || !bFrom || !bTo) return false;
  return aFrom <= bTo && bFrom <= aTo;
}

export function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

/** Compose aggregate rows from the 2 views + pass sales (same rule as RevenuePage). */
export function composeAggregate(
  daily: RevenueDaily[],
  sessions: SessionsDaily[],
  passSales: Array<{ start_date: string; price: number; status: string; zone_id: number | null }>,
  from: string,
  to: string,
  zoneIds: number[],
): DayAgg[] {
  const byDay = new Map<string, DayAgg>();
  for (const d of daily) {
    const cur = byDay.get(d.day) ?? { day: d.day, entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 };
    cur.casual += d.revenue;
    byDay.set(d.day, cur);
  }
  for (const p of passSales) {
    if (p.status === 'cancelled') continue;
    if (p.start_date < from || p.start_date > to) continue;
    if (zoneIds.length > 0 && p.zone_id !== null && !zoneIds.includes(p.zone_id)) continue;
    const cur = byDay.get(p.start_date) ?? { day: p.start_date, entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 };
    cur.monthly += p.price;
    byDay.set(p.start_date, cur);
  }
  for (const s of sessions) {
    if (zoneIds.length > 0 && !zoneIds.includes(s.zone_id)) continue;
    const cur = byDay.get(s.day) ?? { day: s.day, entries: 0, exits: 0, casual: 0, monthly: 0, total: 0 };
    cur.entries += s.entries;
    cur.exits += s.exits;
    byDay.set(s.day, cur);
  }
  for (const cur of byDay.values()) cur.total = cur.casual + cur.monthly;
  return [...byDay.values()]
    .filter((r) => r.casual !== 0 || r.monthly !== 0 || r.entries !== 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

export function summarizeAgg(rows: DayAgg[]): { revenue: number; entries: number; avg: number; casual: number; monthly: number } {
  const revenue = rows.reduce((s, r) => s + r.total, 0);
  const entries = rows.reduce((s, r) => s + r.entries, 0);
  const casual = rows.reduce((s, r) => s + r.casual, 0);
  const monthly = rows.reduce((s, r) => s + r.monthly, 0);
  return { revenue, entries, avg: entries === 0 ? 0 : revenue / entries, casual, monthly };
}

// ---- settings cache (M2.2: localStorage 'parking.settings.v1', offline fallback) ----

export const SETTINGS_KEY = 'parking.settings.v1';
export const LAST_BACKUP_KEY = 'parking:last-backup-v1';

// URL PocketBase online mặc định — mirror backend DEFAULT_PB_URL (BE-016).
// Không hardcode ở component: mọi màn hình dùng hằng này.
export const DEFAULT_PB_URL = 'https://mqaue7.bot-keep.xyz';

export const DEFAULT_SETTINGS: ParkingSettings = {
  lot_name: 'Bãi giữ xe',
  address: null,
  phone: null,
  logo_data_url: null,
  fee_grace_minutes: 30,
  fee_day_threshold_hours: 12,
  pb_url: DEFAULT_PB_URL,
  pb_parking_lot: null, // BE-017: null = chưa cấu hình = local-only
  updated_at: new Date().toISOString(),
};

export function readSettingsCache(): ParkingSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as unknown;
    if (raw && typeof raw === 'object') return { ...DEFAULT_SETTINGS, ...(raw as Partial<ParkingSettings>) };
  } catch {
    // storage hỏng → defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export function writeSettingsCache(s: ParkingSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage đầy/bị chặn — non-fatal
  }
}

// ---- zero-dep .xls download (same pattern as ActivityPage) ----

function escXls(v: string): string {
  return v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function downloadXls(filename: string, title: string, head: string[], bodyRows: string[][]): void {
  const tds = (cells: string[]): string => cells.map((c) => `<td>${escXls(c)}</td>`).join('');
  const body = bodyRows.map((r) => `<tr>${tds(r)}</tr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><h3>${escXls(title)}</h3><table><tr>${head.map((h) => `<th>${escXls(h)}</th>`).join('')}</tr>${body}</table></body></html>`;
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const TX_KIND_LABEL: Record<TxKind, string> = {
  casual: 'Vé lượt',
  monthly: 'Vé tháng',
  adjust: 'Điều chỉnh',
};
