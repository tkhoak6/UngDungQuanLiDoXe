// Desktop notifications V1 — local scheduler trong Electron main (spec ./specs/notifications.md, DS-014).
//
// V1 = KHÔNG FCM desktop (Windows Toast qua Electron Notification API).
// Không lưu lịch vào DB — rebuild toàn bộ timer từ SQLite mỗi launch
// (check bù lúc mở app). Không thêm dep mới: timer = setTimeout/setInterval
// built-in (node-schedule không cần thiết cho 4 job này).
//
// E1 vé sắp hết (D-3/D-0, tối đa 2/vé) · E2 giữ chỗ trước 20p (ưu tiên cao nhất,
//   miễn quiet-hours nhưng silent) · E3 bãi đầy (toast staff + cooldown 15p,
//   banner in-app là việc của renderer) · E4 ca chưa chốt (end+30p, 1 lần/ca).
// Toast click → focus window + gửi deep-link qua event `notify:deep-link`
// (renderer tự `ipcRenderer.on`, preload KHÔNG đụng theo scope BE-021).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { BrowserWindow } from 'electron';
import type { AppDb } from './db';
import type {
  Attendance,
  MonthlyPass,
  NotifyDeepLink,
  NotifyEvent,
  NotifyFireItem,
  NotifyTab,
  NotifyTestOutput,
  Reservation,
  UserDTO,
} from '../shared/types';
import { NOTIFY_DEEP_LINK_CHANNEL } from '../shared/types';

// ---- Hằng số V1 (notifications.md §6 + §1–§4) ----
/** Quiet-hours: 22:00–06:00 (E1 hoãn 06:05, E2 bypass silent, E3 n/a, E4 ca đêm cho phép). */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 6;
/** E1 quét daily lúc 06:30 (sau quiet-hours); D-0 chỉ bắn từ 07:00. */
export const E1_DAILY_HOUR = 6;
export const E1_DAILY_MINUTE = 30;
export const E1_D0_MIN_HOUR = 7;
/** Giờ phát bù các mục bị hoãn trong quiet-hours. */
export const DEFER_HOUR = 6;
export const DEFER_MINUTE = 5;
/** E2 nhắc trước giờ bắt đầu; đặt muộn (<20p) → bắn 30s sau khi giữ. */
export const E2_LEAD_MINUTES = 20;
export const E2_LATE_FIRE_SECONDS = 30;
/** E3 cooldown toast "vừa đầy" cùng zone. */
export const E3_COOLDOWN_MINUTES = 15;
/** E4 nhắc khi quá giờ kết thúc ca. */
export const E4_AFTER_MINUTES = 30;
/** Tick bù (quét E1/E2/E4 tới hạn + poll E3) — không tăng tần suất poll map vì E3. */
const SWEEP_INTERVAL_MS = 60_000;

type UserProvider = () => UserDTO | null;
type WindowProvider = () => BrowserWindow | null;

let userProvider: UserProvider = () => null;
let windowProvider: WindowProvider = () => null;
let dbRef: AppDb | null = null;
let started = false;

/** ipc-handlers gọi 1 lần trong registerIpcHandlers để scheduler biết user hiện tại. */
export function setNotifyUserProvider(fn: UserProvider): void {
  userProvider = fn;
}

// ---- Persist state chống spam (file cạnh DB, không phải bảng DB) ----
interface NotifyState {
  /** E1: `${pass_code}#D3|D0` → ngày đã bắn (tối đa 2/vé/vòng đời). */
  e1: Record<string, string>;
  /** E2: reservation code → ngày đã bắn (1/reservation). */
  e2: Record<string, string>;
  /** E4: attendance id → ngày đã bắn (1/ca). */
  e4: Record<string, string>;
  /** E3: zone_code → ISO lúc toast "vừa đầy" gần nhất (cooldown 15p). */
  e3: Record<string, string>;
}

const EMPTY_STATE: NotifyState = { e1: {}, e2: {}, e4: {}, e3: {} };
let state: NotifyState = { ...EMPTY_STATE, e1: {}, e2: {}, e3: {}, e4: {} };

function statePath(db: AppDb): string | null {
  const name = (db as unknown as { name?: unknown }).name;
  if (typeof name !== 'string' || !name || name === ':memory:') return null;
  return path.join(path.dirname(name), 'notify-state.json');
}

function loadState(db: AppDb): void {
  const p = statePath(db);
  if (!p) {
    state = { e1: {}, e2: {}, e3: {}, e4: {} };
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<NotifyState>;
    state = {
      e1: raw.e1 && typeof raw.e1 === 'object' ? raw.e1 : {},
      e2: raw.e2 && typeof raw.e2 === 'object' ? raw.e2 : {},
      e3: raw.e3 && typeof raw.e3 === 'object' ? raw.e3 : {},
      e4: raw.e4 && typeof raw.e4 === 'object' ? raw.e4 : {},
    };
  } catch {
    state = { e1: {}, e2: {}, e3: {}, e4: {} };
  }
}

function saveState(db: AppDb): void {
  const p = statePath(db);
  if (!p) return;
  try {
    fs.writeFileSync(p, JSON.stringify(state), 'utf8');
  } catch {
    // state mất khi restart = có thể bắn trùng 1 lần — chấp nhận được, không crash app
  }
}

function autoLog(db: AppDb, line: string): void {
  try {
    const p = statePath(db);
    if (!p) return;
    fs.appendFileSync(path.join(path.dirname(p), 'notify-auto.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // logging không bao giờ phá scheduler
  }
}

// ---- Timer registry ----
const timers = new Map<string, NodeJS.Timeout>();

function setTimer(key: string, ms: number, cb: () => void): void {
  clearTimer(key);
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  // setTimeout quá ~24.8 ngày tràn số — các job V1 đều <24h, vượt thì bỏ (sweep bù).
  if (ms > 2_147_483_647) return;
  timers.set(key, setTimeout(cb, ms));
}

function clearTimer(key: string): void {
  const t = timers.get(key);
  if (t) {
    clearTimeout(t);
    timers.delete(key);
  }
}

// ---- Pure helpers (export để test, không chạm DB/Electron) ----

/** Trong quiet-hours 22:00–06:00? (giờ local của máy quầy). */
export function isQuietHour(d: Date): boolean {
  const h = d.getHours();
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** `days_left` (§1.1): số ngày calendar từ hôm nay tới end_date (hôm nay → 0). Hết từ hôm qua → -1. */
export function daysLeft(endDateYYYYMMDD: string, now: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDateYYYYMMDD);
  if (!m) return -1;
  const endDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((endDay.getTime() - today.getTime()) / 86_400_000);
  return diff < 0 ? -1 : diff;
}

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' cho copy VN. */
export function formatVnDate(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return yyyyMmDd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function vnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}₫`;
}

/** 'YYYY-MM-DD' local (máy quầy) — DB date() là UTC nhưng V1 desktop single-machine. */
export function localDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localDateTime(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${localDay(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Datetime bắt đầu giữ chỗ (wall-clock local): date + HH:mm. */
export function reservationStart(dateYYYYMMDD: string, hhmm: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYYYYMMDD);
  const tm = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) return null;
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
}

/** Giờ kết thúc ca trên work_date (ca đêm end <= start → sang hôm sau). */
export function shiftEndDate(workDate: string, startHHMM: string, endHHMM: string): Date | null {
  const base = reservationStart(workDate, endHHMM.slice(0, 5));
  if (!base) return null;
  if (endHHMM.slice(0, 5) <= startHHMM.slice(0, 5)) base.setDate(base.getDate() + 1);
  return base;
}

/** ms từ `from` tới giờ H:M gần nhất trong tương lai (cho daily 06:30 / hoãn 06:05). */
export function msUntil(h: number, m: number, from: Date): number {
  const t = new Date(from.getTime());
  t.setHours(h, m, 0, 0);
  if (t.getTime() <= from.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime() - from.getTime();
}

function normalizePhone(p: string | null | undefined): string {
  return (p ?? '').trim().replace(/[\s.\-()]/g, '');
}

// ---- Electron Notification (lazy — vitest/headless không có Electron vẫn chạy) ----
interface ToastCtorOpts {
  title: string;
  body: string;
  silent?: boolean;
}
interface ToastInstance {
  show(): void;
  on(event: 'click', cb: () => void): void;
}
type ToastCtor = new (opts: ToastCtorOpts) => ToastInstance;

function electronToastCtor(): ToastCtor | null {
  try {
    const req = createRequire(__filename);
    const mod = req('electron') as { Notification?: unknown };
    const c = mod?.Notification as (ToastCtor & { isSupported?: () => boolean }) | undefined;
    if (typeof c !== 'function') return null;
    try {
      if (typeof c.isSupported === 'function' && c.isSupported() === false) return null;
    } catch {
      // bỏ qua — cứ thử show, lỗi thì catch dưới
    }
    return c;
  } catch {
    return null;
  }
}

function deliverDeepLink(deepLink: NotifyDeepLink): void {
  try {
    const w = windowProvider();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.focus();
    w.webContents.send(NOTIFY_DEEP_LINK_CHANNEL, deepLink);
  } catch {
    // click Toast không bao giờ được crash main
  }
}

/** Hiện Windows Toast. Trả về true khi đã gọi show() (không đảm bảo OS hiển thị). */
function showToast(title: string, body: string, silent: boolean, deepLink: NotifyDeepLink): boolean {
  const Ctor = electronToastCtor();
  if (!Ctor) return false;
  try {
    const n = new Ctor({ title, body, silent });
    n.on('click', () => deliverDeepLink(deepLink));
    n.show();
    return true;
  } catch {
    return false;
  }
}

// ---- Eligibility (ai được nhận) ----
/** E1+E2 chỉ bắn cho customer đang login và đúng vé/mã của mình (staff xem vé khách: KHÔNG E1). */
function eligibleCustomer(): UserDTO | null {
  try {
    const me = userProvider();
    if (!me || me.role_name !== 'customer') return null;
    if (!normalizePhone(me.phone)) return null;
    return me;
  } catch {
    return null;
  }
}

/** E3+E4 dành cho quầy trực (staff/admin đã login). */
function onDutyStaff(): UserDTO | null {
  try {
    const me = userProvider();
    if (!me) return null;
    if (me.role_name !== 'admin' && me.role_name !== 'staff') return null;
    return me;
  } catch {
    return null;
  }
}

// ---- E1: vé sắp hết hạn ----
interface PassRow extends MonthlyPass {
  license_plate: string;
}

function e1Milestone(pass: MonthlyPass, now: Date): 'D3' | 'D0' | null {
  const left = daysLeft(pass.end_date, now);
  if (left === 3) return 'D3';
  if (left === 0) return 'D0';
  return null;
}

function e1Copy(pass: PassRow, milestone: 'D3' | 'D0'): { title: string; body: string } {
  if (milestone === 'D0') {
    return {
      title: 'Vé tháng hết hạn hôm nay',
      body: `Vé ${pass.pass_code} xe ${pass.license_plate} hết hạn hôm nay. Gia hạn trước 22:00 để giữ chỗ ưu đãi.`,
    };
  }
  return {
    title: 'Vé tháng sắp hết hạn',
    body: `Vé ${pass.pass_code} xe ${pass.license_plate} hết hạn sau 3 ngày (${formatVnDate(pass.end_date)}). Mang ${vnd(pass.price)} ra quầy để gia hạn.`,
  };
}

/**
 * Quét E1: vé active của chính customer, milestone D-3 (mọi giờ ngoài quiet)
 * + D-0 (từ 07:00). Gộp summary khi ≥2 vé cùng mốc. Trong quiet-hours →
 * deferred (hoãn 06:05, chỉ badge in-app — renderer tự xử).
 */
export function scanE1(db: AppDb, now: Date): { fired: NotifyFireItem[]; deferred: NotifyFireItem[] } {
  const fired: NotifyFireItem[] = [];
  const deferred: NotifyFireItem[] = [];
  const me = eligibleCustomer();
  if (!me) return { fired, deferred };
  const mePhone = normalizePhone(me.phone);
  let rows: PassRow[];
  try {
    rows = db
      .prepare(
        `SELECT mp.*, v.license_plate AS license_plate FROM monthly_passes mp
         JOIN vehicles v ON v.id = mp.vehicle_id WHERE mp.status = 'active'`,
      )
      .all() as PassRow[];
  } catch {
    return { fired, deferred };
  }
  const mine = rows.filter((p) => normalizePhone(p.customer_phone) === mePhone);
  const byMilestone: Record<'D3' | 'D0', PassRow[]> = { D3: [], D0: [] };
  for (const p of mine) {
    const ms = e1Milestone(p, now);
    if (!ms) continue;
    // D-0 trước 07:00 chưa bắn (spec §1.1) — đợi sweep sau 07:00.
    if (ms === 'D0' && now.getHours() < E1_D0_MIN_HOUR) {
      deferred.push({ event: 'E1', title: 'Vé tháng hết hạn hôm nay', entity: p.pass_code, mode: 'deferred' });
      continue;
    }
    if (state.e1[`${p.pass_code}#${ms}`]) continue; // đã bắn trong vòng đời vé
    byMilestone[ms].push(p);
  }
  const quiet = isQuietHour(now);
  (['D3', 'D0'] as const).forEach((ms) => {
    const list = byMilestone[ms];
    if (list.length === 0) return;
    if (quiet) {
      for (const p of list) deferred.push({ event: 'E1', title: e1Copy(p, ms).title, entity: p.pass_code, mode: 'deferred' });
      scheduleDeferWake(db);
      return;
    }
    const today = localDay(now);
    if (list.length >= 2) {
      const first = list[0];
      const c = e1Copy(first, ms);
      const body =
        ms === 'D0'
          ? `Có ${list.length} vé hết hạn hôm nay: ${first.pass_code} xe ${first.license_plate} +${list.length - 1} vé khác — xem chi tiết.`
          : `Có ${list.length} vé sắp hết hạn: ${first.pass_code} xe ${first.license_plate} +${list.length - 1} vé khác cũng sắp hết — xem chi tiết.`;
      showToast(c.title, body, false, { event: 'E1', tab: 'passes' });
      for (const p of list) state.e1[`${p.pass_code}#${ms}`] = today;
      fired.push({ event: 'E1', title: c.title, entity: `${list.length} vé (${list.map((p) => p.pass_code).join(', ')})`, mode: 'toast' });
    } else {
      const p = list[0];
      const c = e1Copy(p, ms);
      showToast(c.title, c.body, false, { event: 'E1', tab: 'passes', pass_code: p.pass_code });
      state.e1[`${p.pass_code}#${ms}`] = today;
      fired.push({ event: 'E1', title: c.title, entity: p.pass_code, mode: 'toast' });
    }
  });
  if (fired.length > 0) saveState(db);
  return { fired, deferred };
}

/** Gia hạn/duyệt xong → vé cũ hết vòng đời nhắc (spec §1.4). */
export function suppressPassReminders(passCode: string): void {
  const today = localDay(new Date());
  state.e1[`${passCode}#D3`] = today;
  state.e1[`${passCode}#D0`] = today;
}

// ---- E2: giữ chỗ sắp tới giờ ----
interface ReservationRow extends Reservation {
  zone_code: string;
}

function readReservation(db: AppDb, code: string): ReservationRow | undefined {
  try {
    return db
      .prepare(
        `SELECT r.*, z.code AS zone_code FROM reservations r
         JOIN parking_zones z ON z.id = r.zone_id WHERE r.code = ?`,
      )
      .get(code) as ReservationRow | undefined;
  } catch {
    return undefined;
  }
}

function e2FireTime(r: Reservation): Date | null {
  const start = reservationStart(r.date, r.start_time);
  if (!start) return null;
  return new Date(start.getTime() - E2_LEAD_MINUTES * 60_000);
}

function e2Copy(r: ReservationRow): { title: string; body: string } {
  const start = reservationStart(r.date, r.start_time);
  let plus20 = r.start_time;
  if (start) {
    const t = new Date(start.getTime() + 20 * 60_000);
    const p = (n: number): string => String(n).padStart(2, '0');
    plus20 = `${p(t.getHours())}:${p(t.getMinutes())}`;
  }
  return {
    title: 'Sắp tới giờ giữ chỗ',
    body: `Mã ${r.code} tại khu ${r.zone_code} từ ${r.start_time}. Tới trước ${plus20} nếu không chỗ sẽ tự hủy.`,
  };
}

/** Bắn E2 cho 1 mã (verify pending + chính chủ tại lúc bắn). Null = bỏ qua, không đánh dấu. */
export function fireE2(db: AppDb, code: string, now: Date): NotifyFireItem | null {
  const me = eligibleCustomer();
  if (!me) return null;
  const r = readReservation(db, code);
  if (!r || r.status !== 'pending') return null;
  if (r.user_id !== me.id && normalizePhone(r.customer_phone) !== normalizePhone(me.phone)) return null;
  if (state.e2[code]) return null; // 1 push/reservation (§2.4)
  const c = e2Copy(r);
  const quiet = isQuietHour(now);
  // E2 miễn quiet-hours nhưng phát silent (§6): hiện tray, không âm thanh.
  showToast(c.title, c.body, quiet, { event: 'E2', tab: 'reservations', code: r.code });
  state.e2[code] = localDay(now);
  saveState(db);
  return { event: 'E2', title: c.title, entity: r.code, mode: quiet ? 'silent' : 'toast' };
}

/** Quét E2 tới hạn (sweep 60s + check bù lúc mở app): fireAt <= now < expires_at. */
export function scanE2Due(db: AppDb, now: Date): NotifyFireItem[] {
  const fired: NotifyFireItem[] = [];
  if (!eligibleCustomer()) return fired;
  let rows: ReservationRow[];
  try {
    const yesterday = localDay(new Date(now.getTime() - 86_400_000));
    rows = db
      .prepare(
        `SELECT r.*, z.code AS zone_code FROM reservations r
         JOIN parking_zones z ON z.id = r.zone_id
         WHERE r.status = 'pending' AND r.date >= ?`,
      )
      .all(yesterday) as ReservationRow[];
  } catch {
    return fired;
  }
  const nowStr = localDateTime(now);
  for (const r of rows) {
    const ft = e2FireTime(r);
    if (!ft || ft.getTime() > now.getTime()) continue;
    if (r.expires_at <= nowStr) continue; // quá hạn → sweep DB lo, KHÔNG push "đã hết hạn" (§2.4)
    const item = fireE2(db, r.code, now);
    if (item) fired.push(item);
  }
  return fired;
}

/** Đặt lịch nhắc cho 1 mã (gọi sau customer:reserve + rebuild lúc mở app). */
export function scheduleReservationReminder(db: AppDb, code: string, late = false): void {
  const key = `e2:${code}`;
  clearTimer(key);
  if (late) {
    // Đặt muộn (cách giờ bắt đầu <20p) → bắn 30s sau khi giữ thành công (§2.1).
    setTimer(key, E2_LATE_FIRE_SECONDS * 1000, () => {
      try {
        if (dbRef) fireE2(dbRef, code, new Date());
      } catch (e) {
        if (dbRef) autoLog(dbRef, `E2 late fire fail ${code}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return;
  }
  const r = readReservation(db, code);
  if (!r || r.status !== 'pending') return;
  const ft = e2FireTime(r);
  if (!ft) return;
  const ms = ft.getTime() - Date.now();
  if (ms <= 0) return; // tới hạn/quá giờ → sweep 60s + catch-up lo (không double-fire ở đây)
  setTimer(key, ms, () => {
    try {
      if (dbRef) fireE2(dbRef, code, new Date());
    } catch (e) {
      if (dbRef) autoLog(dbRef, `E2 fire fail ${code}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function cancelReservationReminder(code: string): void {
  clearTimer(`e2:${code}`);
}

/** Rebuild toàn bộ timer E2 từ SQLite (mở app — app tắt qua đêm thì quét bù). */
export function refreshReservationTimers(db: AppDb): void {
  let rows: ReservationRow[];
  try {
    const yesterday = localDay(new Date(Date.now() - 86_400_000));
    rows = db
      .prepare(
        `SELECT r.*, z.code AS zone_code FROM reservations r
         JOIN parking_zones z ON z.id = r.zone_id
         WHERE r.status = 'pending' AND r.date >= ?`,
      )
      .all(yesterday) as ReservationRow[];
  } catch {
    return;
  }
  const now = new Date();
  const nowStr = localDateTime(now);
  for (const r of rows) {
    const ft = e2FireTime(r);
    if (!ft) continue;
    if (ft.getTime() > now.getTime()) {
      scheduleReservationReminder(db, r.code);
    } else if (r.expires_at > nowStr && !state.e2[r.code]) {
      // Bỏ lỡ lúc tắt máy: bắn bù ngay (E2 time-critical; quiet → silent).
      const createdMs = Date.parse(`${r.created_at.replace(' ', 'T')}Z`);
      if (Number.isFinite(createdMs) && now.getTime() - createdMs < 10 * 60_000) {
        // Vừa đặt muộn xong (<10p) → giữ đúng 30s sau giữ (§2.1).
        scheduleReservationReminder(db, r.code, true);
      } else {
        const item = fireE2(db, r.code, now);
        if (item) autoLog(db, `E2 catch-up ${r.code} mode=${item.mode}`);
      }
    }
  }
}

// ---- E3: bãi đầy ----
interface AvailabilityRow {
  zone_id: number;
  zone_code: string;
  zone_name: string;
  capacity: number;
  is_active: 0 | 1;
  free_spots: number;
  occupied_spots: number;
  maintenance_spots: number;
}

/** Poll E3 (60s): zone vừa đầy → toast staff 1 lần + cooldown 15p/zone (§3.4). */
export function pollE3(db: AppDb, now: Date): NotifyFireItem[] {
  const fired: NotifyFireItem[] = [];
  if (!onDutyStaff()) return fired; // toast quầy — guest/customer chỉ banner in-app (renderer)
  let rows: AvailabilityRow[];
  try {
    rows = db.prepare(`SELECT * FROM v_zone_availability WHERE is_active = 1 ORDER BY zone_code`).all() as AvailabilityRow[];
  } catch {
    return fired;
  }
  const full = rows.filter((z) => z.capacity > 0 && z.free_spots === 0);
  if (full.length === 0) return fired;
  const suggest = rows.filter((z) => z.free_spots > 0).sort((a, b) => b.free_spots - a.free_spots)[0];
  for (const z of full) {
    const last = state.e3[z.zone_code];
    if (last && now.getTime() - Date.parse(last) < E3_COOLDOWN_MINUTES * 60_000) continue;
    const total = rows.reduce((s, r) => s + r.capacity, 0);
    const occupied = rows.reduce((s, r) => s + r.occupied_spots, 0);
    const body = suggest
      ? `Khu ${z.zone_code} vừa đầy — chuyển sang khu ${suggest.zone_code} (còn ${suggest.free_spots} chỗ).`
      : `Khu ${z.zone_code} vừa đầy. Bãi đã đầy (${occupied}/${total}) — vui lòng quay lại sau.`;
    const deepLink: NotifyDeepLink = suggest
      ? { event: 'E3', tab: 'map', zone_code: suggest.zone_code }
      : { event: 'E3', tab: 'map', zone_code: z.zone_code };
    showToast('Bãi xe đã đầy', body, false, deepLink);
    state.e3[z.zone_code] = now.toISOString();
    fired.push({ event: 'E3', title: 'Bãi xe đã đầy', entity: z.zone_code, mode: 'toast' });
  }
  if (fired.length > 0) saveState(db);
  return fired;
}

// ---- E4: ca chưa chốt ----
interface OpenAttendanceRow extends Attendance {
  shift_name: string;
  shift_code: string;
  shift_start: string;
  shift_end: string;
}

const SHIFT_VN: Record<string, string> = { MORNING: 'sáng', CHIỀU: 'chiều', AFTERNOON: 'chiều', NIGHT: 'đêm', TỐI: 'tối' };

function shiftVnName(code: string, fallback: string): string {
  return SHIFT_VN[code] ?? fallback;
}

function readOpenAttendance(db: AppDb, id: number): OpenAttendanceRow | undefined {
  try {
    return db
      .prepare(
        `SELECT a.*, s.code AS shift_code, s.name AS shift_name,
                s.start_time AS shift_start, s.end_time AS shift_end
         FROM attendance a JOIN shifts s ON s.id = a.shift_id WHERE a.id = ?`,
      )
      .get(id) as OpenAttendanceRow | undefined;
  } catch {
    return undefined;
  }
}

/** Bắn E4 cho 1 attendance (verify còn treo + đúng NV tại lúc bắn). Null = bỏ qua. */
export function fireE4(db: AppDb, attendanceId: number, now: Date): NotifyFireItem | null {
  const me = userProvider();
  if (!me || (me.role_name !== 'admin' && me.role_name !== 'staff')) return null;
  const row = readOpenAttendance(db, attendanceId);
  if (!row || row.check_out_at !== null) return null; // đã chốt → hủy job
  if (row.user_id !== me.id && me.role_name !== 'admin') return null;
  if (state.e4[String(attendanceId)]) return null; // tối đa 1 push/ca (§4.4)
  const end = shiftEndDate(row.work_date, row.shift_start, row.shift_end);
  if (!end) return null;
  const due = end.getTime() + E4_AFTER_MINUTES * 60_000;
  if (now.getTime() < due) return null; // chưa tới end+30p
  if (isQuietHour(now)) {
    // Ca ngày kéo qua 22:00 → hoãn tới 06:05 + banner chốt bù trong app (§6).
    scheduleDeferWake(db);
    return { event: 'E4', title: `Bạn chưa chốt ca ${row.shift_name}`, entity: String(attendanceId), mode: 'deferred' };
  }
  const st = row.shift_start.slice(0, 5);
  const en = row.shift_end.slice(0, 5);
  const title = `Bạn chưa chốt ca ${shiftVnName(row.shift_code, row.shift_name)}`;
  const body =
    `Ca ${shiftVnName(row.shift_code, row.shift_name)} ${st}–${en} đã hết 30 phút mà chưa chốt. ` +
    `Vào Chấm công để chốt bù (đầu ca ${vnd(row.opening_cash)} + ghi chú bàn giao).`;
  showToast(title, body, false, { event: 'E4', tab: 'attendance', attendance_id: row.id });
  state.e4[String(attendanceId)] = localDay(now);
  saveState(db);
  return { event: 'E4', title, entity: String(attendanceId), mode: 'toast' };
}

/** Quét E4 tới hạn (sweep 60s + check bù lúc mở app): còn treo và now >= end+30p. */
export function scanE4Due(db: AppDb, now: Date): { fired: NotifyFireItem[]; deferred: NotifyFireItem[] } {
  const fired: NotifyFireItem[] = [];
  const deferred: NotifyFireItem[] = [];
  const me = userProvider();
  if (!me || (me.role_name !== 'admin' && me.role_name !== 'staff')) return { fired, deferred };
  let rows: OpenAttendanceRow[];
  try {
    const sql =
      `SELECT a.*, s.code AS shift_code, s.name AS shift_name,
              s.start_time AS shift_start, s.end_time AS shift_end
       FROM attendance a JOIN shifts s ON s.id = a.shift_id
       WHERE a.check_out_at IS NULL` + (me.role_name === 'admin' ? `` : ` AND a.user_id = ?`);
    rows = (me.role_name === 'admin'
      ? db.prepare(sql).all()
      : db.prepare(sql).all(me.id)) as OpenAttendanceRow[];
  } catch {
    return { fired, deferred };
  }
  for (const r of rows) {
    if (state.e4[String(r.id)]) continue;
    const end = shiftEndDate(r.work_date, r.shift_start, r.shift_end);
    if (!end) continue;
    if (now.getTime() < end.getTime() + E4_AFTER_MINUTES * 60_000) continue;
    const item = fireE4(db, r.id, now);
    if (item) (item.mode === 'deferred' ? deferred : fired).push(item);
  }
  return { fired, deferred };
}

/** Đặt lịch nhắc cho 1 ca (gọi sau attendance:check-in + rebuild lúc mở app). */
export function scheduleShiftReminder(db: AppDb, attendanceId: number): void {
  const key = `e4:${attendanceId}`;
  clearTimer(key);
  const row = readOpenAttendance(db, attendanceId);
  if (!row || row.check_out_at !== null) return;
  const end = shiftEndDate(row.work_date, row.shift_start, row.shift_end);
  if (!end) return;
  const ms = end.getTime() + E4_AFTER_MINUTES * 60_000 - Date.now();
  if (ms <= 0) return; // đã quá giờ → sweep 60s lo (không double-fire ở đây)
  setTimer(key, ms, () => {
    try {
      if (dbRef) fireE4(dbRef, attendanceId, new Date());
    } catch (e) {
      if (dbRef) autoLog(dbRef, `E4 fire fail ${attendanceId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function cancelShiftReminder(attendanceId: number): void {
  clearTimer(`e4:${attendanceId}`);
}

/** Rebuild toàn bộ timer E4 từ SQLite (mở app). */
export function refreshShiftTimers(db: AppDb): void {
  let rows: Array<{ id: number }>;
  try {
    rows = db.prepare(`SELECT id FROM attendance WHERE check_out_at IS NULL`).all() as Array<{ id: number }>;
  } catch {
    return;
  }
  for (const r of rows) scheduleShiftReminder(db, r.id);
}

// ---- Hoãn quiet-hours: 1 timer duy nhất tới 06:05 ----
function scheduleDeferWake(db: AppDb): void {
  if (timers.has('defer-wake')) return;
  setTimer('defer-wake', msUntil(DEFER_HOUR, DEFER_MINUTE, new Date()), () => {
    try {
      const now = new Date();
      scanE1(db, now);
      scanE4Due(db, now);
    } catch (e) {
      autoLog(db, `defer wake fail: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

// ---- Daily E1 06:30 ----
function scheduleDailyE1(db: AppDb): void {
  setTimer('e1-daily', msUntil(E1_DAILY_HOUR, E1_DAILY_MINUTE, new Date()), () => {
    try {
      scanE1(db, new Date());
    } catch (e) {
      autoLog(db, `E1 daily fail: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      scheduleDailyE1(db); // hẹn 06:30 hôm sau
    }
  });
}

// ---- Catch-up + notify:test ----
function sampleCopy(event: NotifyEvent): { title: string; body: string; tab: NotifyTab; link: NotifyDeepLink } {
  switch (event) {
    case 'E1':
      return {
        title: 'Vé tháng sắp hết hạn',
        body: `Vé MT-2026-0001 xe 51H-12345 hết hạn sau 3 ngày (${formatVnDate(localDay(new Date()))}). Mang ${vnd(300000)} ra quầy để gia hạn.`,
        tab: 'passes',
        link: { event: 'E1', tab: 'passes', pass_code: 'MT-2026-0001' },
      };
    case 'E2':
      return {
        title: 'Sắp tới giờ giữ chỗ',
        body: 'Mã R-20261112-0001 tại khu A từ 08:00. Tới trước 08:20 nếu không chỗ sẽ tự hủy.',
        tab: 'reservations',
        link: { event: 'E2', tab: 'reservations', code: 'R-20261112-0001' },
      };
    case 'E3':
      return {
        title: 'Bãi xe đã đầy',
        body: 'Khu A vừa đầy — chuyển sang khu B (còn 5 chỗ).',
        tab: 'map',
        link: { event: 'E3', tab: 'map', zone_code: 'B' },
      };
    case 'E4':
      return {
        title: 'Bạn chưa chốt ca sáng',
        body: `Ca sáng 06:00–14:00 đã hết 30 phút mà chưa chốt. Vào Chấm công để chốt bù (đầu ca ${vnd(0)} + ghi chú bàn giao).`,
        tab: 'attendance',
        link: { event: 'E4', tab: 'attendance', attendance_id: 0 },
      };
  }
}

/**
 * Check bù lúc mở app + nguồn cho IPC `notify:test` (dry-run quét thật;
 * `sample` bắn thêm 1 Toast mẫu để QA click thử deep-link).
 */
export function runNotificationCatchup(db: AppDb, opts?: { sample?: NotifyEvent }): NotifyTestOutput {
  const now = new Date();
  const quiet = isQuietHour(now);
  const e1 = scanE1(db, now);
  const e2 = scanE2Due(db, now);
  const e4 = scanE4Due(db, now);
  const fired: NotifyFireItem[] = [...e1.fired, ...e2, ...e4.fired];
  const deferred: NotifyFireItem[] = [...e1.deferred, ...e4.deferred];
  if (opts?.sample) {
    const s = sampleCopy(opts.sample);
    // Sample do user bấm tay → bypass quiet nhưng silent khi đang giờ im lặng.
    showToast(s.title, s.body, quiet, s.link);
    fired.push({ event: opts.sample, title: s.title, entity: 'mẫu kiểm thử', mode: quiet ? 'silent' : 'toast' });
  }
  return { quiet, fired, deferred };
}

// ---- Lifecycle ----
function sweepTick(): void {
  if (!dbRef) return;
  const db = dbRef;
  try {
    const now = new Date();
    scanE1(db, now);
    scanE2Due(db, now);
    scanE4Due(db, now);
    pollE3(db, now);
  } catch (e) {
    autoLog(db, `sweep fail: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Khởi động scheduler: load state, rebuild timer E2/E4, check bù ngay,
 * hẹn daily E1 06:30 + sweep 60s. Gọi 1 lần sau registerIpcHandlers (main.ts).
 * Mọi lỗi nuốt + ghi notify-auto.log — không crash app quầy.
 */
export function startNotificationScheduler(
  db: AppDb,
  getWindow: WindowProvider,
  getUser?: UserProvider,
): void {
  if (started) return;
  started = true;
  dbRef = db;
  windowProvider = getWindow;
  if (getUser) userProvider = getUser;
  try {
    loadState(db);
    refreshReservationTimers(db);
    refreshShiftTimers(db);
    // Check bù lúc mở app (bỏ lỡ khi tắt máy), tôn quiet-hours bên trong từng scan.
    runNotificationCatchup(db);
    scheduleDailyE1(db);
    setTimer('sweep', SWEEP_INTERVAL_MS, function loop() {
      sweepTick();
      if (started) setTimer('sweep', SWEEP_INTERVAL_MS, loop);
    });
  } catch (e) {
    autoLog(db, `start fail: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function stopNotificationScheduler(): void {
  started = false;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  dbRef = null;
}
