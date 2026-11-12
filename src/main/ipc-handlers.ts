// All IPC handlers: zones/spots CRUD, check-in/out (single-transaction checkout),
// monthly passes + renewal, reports (views), users (admin), auth.
// Security: admin/staff guards per api-contract.md §11; bcrypt compare only;
// payments table is append-only — no update/delete handler exists by design.
import { dialog, ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import type { AppDb } from './db';
import { sweepExpiredReservations } from './db';
import { loadParkingSettings, saveParkingSettings, type ConfigPatch } from './app-config';
import { checkpointWithRetry, dbFilePath, stampLong, stampShort, validateRestoreFile } from './backup-restore';
import { AppError, getCurrentUser, hashPassword, loginOnlineFirst, logout, refreshCurrentUser, registerCustomerOnlineFirst, requireCustomer, requirePerm, requireRole, resolvePerms, toUserDTO } from './auth';
import { pbGetStatus, PbNoFallbackError, pbTestConnection } from './pb-client';
import { calculateFee, calculatePassPrice } from './fee-calculator';
// BE-021 (DS-014 V1): scheduler Toast desktop — hooks đặt/chốt lịch, KHÔNG sửa IPC cũ.
import {
  E2_LEAD_MINUTES,
  cancelReservationReminder,
  cancelShiftReminder,
  runNotificationCatchup,
  scheduleReservationReminder,
  scheduleShiftReminder,
  setNotifyUserProvider,
  suppressPassReminders,
} from './notifications';
import {
  ensureQrHmacKey,
  normalizePlateForQr,
  signTicket,
  verifyQrSignature,
} from './qr-ticket';
import {
  fail,
  ok,
  type ActivityAction,
  type ActivityListOutput,
  type ActivityRow,
  type ApiMap,
  type Attendance,
  type AttendanceCheckInInput,
  type AttendanceCheckOutInput,
  type AttendanceCheckOutOutput,
  type AttendanceListInput,
  type AttendanceListOutput,
  type AttendanceRow,
  type AttendanceStatus,
  type AttendanceTodayOutput,
  type CheckInInput,
  type CustomerPassesInput,
  type CustomerPassesOutput,
  type CustomerReserveCancelInput,
  type CustomerReservationRow,
  type CustomerReservationsInput,
  type CustomerReservationsOutput,
  type CustomerReserveInput,
  type CustomerSessionRow,
  type CustomerSessionsOutput,
  type CustomerPassRequestInput,
  type CustomerVehicle,
  type FeePreview,
  type IpcChannel,
  type IpcResult,
  type MonthlyPass,
  type NotifyTestInput,
  type ParkingSession,
  type ParkingSpot,
  type ParkingZone,
  type QrPayloadOutput,
  type QrVerifyOutput,
  type PassConfirmInput,
  type PassConfirmOutput,
  type PassStatus,
  type Payment,
  type PaymentMethod,
  type Reservation,
  type ReservationStatus,
  type RevenueDaily,
  type RoleName,
  type SessionsDaily,
  type Shift,
  type ShiftCode,
  type ShiftUpdateInput,
  type SpotMapCell,
  type SpotStatus,
  type StaffPermissionKey,
  type StaffPermissions,
  type StaffProfileUpdateInput,
  type StaffSelfProfile,
  type TxListOutput,
  type TxRow,
  type UserDTO,
  type Vehicle,
  type VehicleType,
  type ZoneAvailability,
} from '../shared/types';

type Handler<K extends IpcChannel> = (
  db: AppDb,
  input: ApiMap[K]['input'],
) => ApiMap[K]['output'] | Promise<ApiMap[K]['output']>;

function sqliteNow(db: AppDb): string {
  return (db.prepare(`SELECT datetime('now') AS now`).get() as { now: string }).now;
}

function toUtcInput(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizePlate(plate: string): string {
  const p = (plate ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (p.length < 2) throw new AppError('Biển số không hợp lệ');
  return p;
}

function validateZonePayload(p: {
  code?: string;
  name?: string;
  capacity?: number;
  price_per_hour?: number;
  price_per_day?: number;
}): void {
  const errors: Record<string, string[]> = {};
  if (p.code !== undefined && (!p.code.trim() || p.code.trim().length > 10)) {
    errors.code = ['Mã khu tối đa 10 ký tự'];
  }
  if (p.name !== undefined && !p.name.trim()) errors.name = ['Tên khu là bắt buộc'];
  if (p.capacity !== undefined && (!Number.isInteger(p.capacity) || p.capacity < 1 || p.capacity > 2000)) {
    errors.capacity = ['Sức chứa từ 1 đến 2000'];
  }
  if (p.price_per_hour !== undefined && (!Number.isInteger(p.price_per_hour) || p.price_per_hour < 0)) {
    errors.price_per_hour = ['Giá giờ phải là số nguyên VND >= 0'];
  }
  if (p.price_per_day !== undefined && (!Number.isInteger(p.price_per_day) || p.price_per_day < 0)) {
    errors.price_per_day = ['Giá ngày phải là số nguyên VND >= 0'];
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}

class ValidationError extends AppError {
  errors: Record<string, string[]>;
  constructor(errors: Record<string, string[]>, message = 'Dữ liệu không hợp lệ') {
    super(message);
    this.errors = errors;
  }
}

// ---- S1 hồ sơ NV (staff-area.md S1.5) — validate dùng chung users:update (admin)
// ---- + users:profile:update (staff tự sửa). Rỗng/NULL → NULL (clear); undefined
// ---- = không patch. SĐT trùng → lỗi Việt ở call-site (kèm catch race UNIQUE).
const VN_PHONE_RE = /^0\d{9}$/;

function normalizeProfilePhone(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? '').trim();
  if (!t) return null;
  if (!VN_PHONE_RE.test(t)) {
    throw new ValidationError({ phone: ['SĐT 10 số, bắt đầu bằng 0 (VD: 0901234567).'] });
  }
  return t;
}

function normalizeProfileAddress(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? '').trim();
  if (!t) return null;
  if (t.length > 255) throw new ValidationError({ address: ['Địa chỉ tối đa 255 ký tự.'] });
  return t;
}

function normalizeProfileStartDate(db: AppDb, v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? '').trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new ValidationError({ start_date: ['Ngày vào làm không hợp lệ (YYYY-MM-DD).'] });
  }
  const today = sqliteNow(db).slice(0, 10);
  if (t > today) throw new ValidationError({ start_date: ['Ngày vào làm không thể là tương lai.'] });
  return t;
}

function normalizeProfileNotes(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? '').trim();
  if (!t) return null;
  if (t.length > 500) throw new ValidationError({ notes: ['Ghi chú tối đa 500 ký tự.'] });
  return t;
}

/** SELECT chuẩn cho UserDTO (v005 S1: + address/start_date/notes; v007 S4: + permissions — xem api-contract.md §3). */
const USER_DTO_SELECT = `u.id, u.username, u.full_name, u.phone, u.address, u.start_date, u.notes, u.permissions,
         u.role_id, r.name AS role_name, u.is_active, u.created_at, u.updated_at`;

/**
 * Gắn `perms` (resolved map) vào row UserDTO thô từ SELECT (S4 — frontend
 * ẩn menu theo `perms`, KHÔNG parse `permissions` lại).
 */
function withPerms<T extends { role_name: RoleName; permissions: string | null }>(
  row: T,
): T & { perms: StaffPermissions } {
  return { ...row, perms: resolvePerms(row.role_name, row.permissions) };
}

// ---- S4 users:update patch permissions (staff-area.md S4.4) — admin-only:
// ---- whitelist 5 keys canonical, giá trị 0/1/boolean (string '0'/'1' cũng nhận);
// ---- key lạ → bỏ qua; null/rỗng → NULL (reset = full); target admin → bỏ qua.
const PERM_PATCH_KEYS: StaffPermissionKey[] = ['checkin', 'pass_sale', 'report_self', 'profile_self', 'reservation'];

function normalizePermissionsPatch(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v === 'string') {
    if (!v.trim()) return null;
    try {
      return normalizePermissionsPatch(JSON.parse(v));
    } catch {
      throw new ValidationError({ permissions: ['Quyền hạn không hợp lệ (JSON).'] });
    }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ValidationError({ permissions: ['Quyền hạn không hợp lệ.'] });
  }
  const out: Partial<Record<StaffPermissionKey, 0 | 1>> = {};
  for (const k of PERM_PATCH_KEYS) {
    const raw = (v as Record<string, unknown>)[k];
    if (raw === undefined) continue;
    if (raw === 1 || raw === true || raw === '1') out[k] = 1;
    else if (raw === 0 || raw === false || raw === '0') out[k] = 0;
    else throw new ValidationError({ permissions: [`Giá trị quyền "${k}" phải là 0 hoặc 1.`] });
  }
  return JSON.stringify(out);
}

function ticketCode(db: AppDb, at: Date): string {
  const day = toUtcInput(at).slice(0, 10).replace(/-/g, '');
  const n = (db.prepare(`SELECT COUNT(*) AS c FROM parking_sessions WHERE date(check_in_at) = date(?)`).get(toUtcInput(at)) as { c: number }).c + 1;
  return `T-${day}-${String(n).padStart(4, '0')}`;
}

function passCode(db: AppDb, at: Date): string {
  const year = at.getUTCFullYear();
  const n = (
    db.prepare(`SELECT COUNT(*) AS c FROM monthly_passes WHERE substr(pass_code, 4, 4) = ?`).get(String(year)) as { c: number }
  ).c + 1;
  return `MT-${year}-${String(n).padStart(4, '0')}`;
}

/** Mã giữ chỗ P4: `R-YYYYMMDD-####` (đếm theo ngày, khớp CHECK GLOB trong migration-004). */
function reservationCode(db: AppDb, today: string): string {
  const day = today.replace(/-/g, '');
  const n = (db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE date = ?`).get(today) as { c: number }).c + 1;
  return `R-${day}-${String(n).padStart(4, '0')}`;
}

/** 'HH:mm' → phút từ 00:00 (phục vụ validate khung giữ chỗ P4). NaN khi sai format. */
function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * BE-019 đặt chỗ 24/24 (qua đêm được): `end <= start` = kết thúc sang hôm sau.
 * Duration tính theo datetime (cộng 24h khi qua đêm), 15p–4h.
 */
function reservationDurationMin(start: string, end: string): number {
  let d = toMinutes(end) - toMinutes(start);
  if (d <= 0) d += 24 * 60; // qua đêm (start == end → 24h → rớt range 15p–4h bên dưới)
  return d;
}

/** 'YYYY-MM-DD' + 1 ngày (UTC, khớp sqlite datetime('now')). */
function nextDayOf(dateYYYYMMDD: string): string {
  const dt = new Date(`${dateYYYYMMDD}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Cộng phút vào datetime 'YYYY-MM-DD HH:mm' → 'YYYY-MM-DD HH:MM:SS',
 * tự tràn sang hôm sau (VD: '2026-11-11 23:50' + 20p → '2026-11-12 00:10:00').
 */
function addMinutesToDateTime(date: string, hhmm: string, mins: number): string {
  let total = toMinutes(hhmm) + mins;
  let d = date;
  while (total >= 24 * 60) {
    total -= 24 * 60;
    d = nextDayOf(d);
  }
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${d} ${hh}:${mm}:00`;
}

/** Active pass valid right now for vehicle (+zone scope). Returns null when none. */
function findValidPass(db: AppDb, vehicleId: number, zoneId: number, nowUtc: string): MonthlyPass | null {
  const today = nowUtc.slice(0, 10);
  return (
    db
      .prepare(
        `SELECT * FROM monthly_passes
         WHERE vehicle_id = ? AND status = 'active'
           AND start_date <= ? AND end_date >= ?
           AND (zone_id IS NULL OR zone_id = ?)
         ORDER BY end_date DESC LIMIT 1`,
      )
      .get(vehicleId, today, today, zoneId) as MonthlyPass | null | undefined
  ) ?? null;
}

// ---------------------------------------------------------------- handlers ---

function register<K extends IpcChannel>(
  db: AppDb,
  channel: K,
  guard: 'none' | 'staff' | 'admin',
  fn: Handler<K>,
): void {
  ipcMain.handle(channel, async (_evt, input) => {
    try {
      // M3 restore (BE-015): sau restore DB đã đóng — mọi IPC đều yêu cầu restart.
      if (restartRequired) return fail('Dữ liệu mới đã sẵn sàng — khởi động lại app để tiếp tục');
      if (guard === 'admin') requireRole('admin');
      if (guard === 'staff') requireRole('staff');
      return await fn(db, input);
    } catch (e) {
      if (e instanceof ValidationError) return fail(e.message, e.errors);
      if (e instanceof AppError) return fail(e.message);
      if (e instanceof PbNoFallbackError) return fail(e.message);
      return fail('Đã xảy ra lỗi — vui lòng thử lại');
    }
  });
}

/** Set sau restore:from-file thành công (DB cũ đã đóng, chờ restart). */
let restartRequired = false;

export function registerIpcHandlers(db: AppDb): void {
  // BE-021: scheduler Toast cần biết user hiện tại để lọc E1/E2 (mine-only customer).
  setNotifyUserProvider(getCurrentUser);
  // ---- auth (BE-016 online-first: thử PB trước, rớt mạng/lỗi → fallback local) ----
  register(db, 'auth:login', 'none', async (_db, input) => ok(await loginOnlineFirst(_db, input.username, input.password)));
  register(db, 'auth:logout', 'none', () => {
    logout();
    return ok(null);
  });
  register(db, 'auth:me', 'none', () => ok(getCurrentUser()));
  // Public: khách tự đăng ký bằng SĐT (api-contract.md §12). Role server-fix
  // 'customer', không auto-login — frontend gọi auth:login sau khi đăng ký.
  // BE-016: local trước + best-effort mirror PB (offline vẫn dùng được).
  register(db, 'auth:register', 'none', async (d, input) => {
    const reg = await registerCustomerOnlineFirst(d, input);
    return ok(
      reg.user,
      reg.pbSynced
        ? 'Đã tạo tài khoản (đã đồng bộ online).'
        : 'Đã tạo tài khoản trên máy này — chưa đồng bộ online (kiểm tra mạng rồi đăng nhập lại).',
    );
  });

  // ---- PocketBase online (BE-016 auth + BE-017 schema thật/parking_lot) ----
  register(db, 'pb:test', 'admin', async (d, input) => {
    const r = await pbTestConnection(d, input?.url);
    return r.reachable
      ? ok(r, `Kết nối máy chủ online OK (${r.latency_ms ?? '?'}ms).`)
      : ok(r, 'Không kết nối được máy chủ online — kiểm tra địa chỉ/mạng.');
  });
  // BE-017: kèm parking_lot đang dùng; thiếu config → message Việt hướng dẫn
  // nhập (UI có màn nhập Cấu hình sau — handler không tự đoán bãi).
  register(db, 'pb:status', 'none', async (d) => {
    const s = await pbGetStatus(d);
    if (!s.pb_url) return ok(s, 'Chưa cấu hình máy chủ online — vào Cấu hình để nhập địa chỉ.');
    if (!s.parking_lot) {
      return ok(
        s,
        'Chưa cấu hình bãi xe (mã parking_lot) — vào Cấu hình nhập ID bãi do system_admin cấp để đồng bộ online.',
      );
    }
    return ok(s);
  });

  // ---- zones ----
  register(db, 'zones:list', 'none', (d) =>
    ok(d.prepare(`SELECT * FROM parking_zones ORDER BY code`).all() as ParkingZone[]),
  );
  register(db, 'zones:get', 'none', (d, input) => {
    const z = d.prepare(`SELECT * FROM parking_zones WHERE id = ?`).get(input.id) as ParkingZone | undefined;
    if (!z) throw new AppError('Không tìm thấy khu vực');
    return ok(z);
  });
  register(db, 'zones:create', 'admin', (d, input) => {
    validateZonePayload(input);
    try {
      const r = d
        .prepare(
          `INSERT INTO parking_zones (code, name, vehicle_type_allowed, capacity, price_per_hour, price_per_day)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.code.trim().toUpperCase(), input.name.trim(), input.vehicle_type_allowed, input.capacity, input.price_per_hour, input.price_per_day);
      return ok(d.prepare(`SELECT * FROM parking_zones WHERE id = ?`).get(r.lastInsertRowid) as ParkingZone);
    } catch {
      throw new AppError('Mã khu đã tồn tại');
    }
  });
  register(db, 'zones:update', 'admin', (d, input) => {
    const { id, ...patch } = input;
    if (patch.name !== undefined || patch.capacity !== undefined || patch.price_per_hour !== undefined || patch.price_per_day !== undefined) {
      validateZonePayload(patch);
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ['name', 'vehicle_type_allowed', 'capacity', 'price_per_hour', 'price_per_day', 'is_active'] as const) {
      if (patch[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(k === 'name' ? String(patch[k]).trim() : patch[k]);
      }
    }
    if (sets.length === 0) throw new AppError('Không có gì để cập nhật');
    d.prepare(`UPDATE parking_zones SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    const z = d.prepare(`SELECT * FROM parking_zones WHERE id = ?`).get(id) as ParkingZone | undefined;
    if (!z) throw new AppError('Không tìm thấy khu vực');
    return ok(z);
  });
  register(db, 'zones:delete', 'admin', (d, input) => {
    // Guard 1 (spec §c): block when vehicles are still parked.
    const parked = (d.prepare(`SELECT COUNT(*) AS c FROM parking_sessions WHERE zone_id = ? AND status = 'parked'`).get(input.id) as { c: number }).c;
    if (parked > 0) throw new AppError(`Còn ${parked} xe đang đỗ — chuyển xe trước khi xóa`);
    try {
      const r = d.prepare(`DELETE FROM parking_zones WHERE id = ?`).run(input.id);
      if (r.changes === 0) throw new AppError('Không tìm thấy khu vực');
      return ok(null);
    } catch (e) {
      if (e instanceof AppError) throw e;
      // FK RESTRICT: zone still referenced by session history (spots CASCADE, sessions RESTRICT).
      throw new AppError('Không thể xóa: khu còn lịch sử gửi xe — hãy khóa (is_active = 0) thay vì xóa');
    }
  });

  // ---- availability + spot map (guest: no login) ----
  register(db, 'availability:list', 'none', (d, input) => {
    const rows = (
      input.only_active === false
        ? d.prepare(`SELECT * FROM v_zone_availability ORDER BY zone_code`).all()
        : d.prepare(`SELECT * FROM v_zone_availability WHERE is_active = 1 ORDER BY zone_code`).all()
    ) as ZoneAvailability[];
    return ok(rows);
  });
  register(db, 'spots:list', 'none', (d, input) => {
    return ok(
      d.prepare(`SELECT * FROM v_spot_map WHERE zone_id = ? ORDER BY spot_number`).all(input.zone_id) as SpotMapCell[],
    );
  });
  register(db, 'spots:set-status', 'admin', (d, input) => {
    const allowed: SpotStatus[] = ['available', 'occupied', 'reserved', 'maintenance'];
    if (!allowed.includes(input.status)) throw new AppError('Trạng thái chỗ đỗ không hợp lệ');
    const spot = d.prepare(`SELECT * FROM parking_spots WHERE id = ?`).get(input.spot_id) as ParkingSpot | undefined;
    if (!spot) throw new AppError('Không tìm thấy chỗ đỗ');
    if (spot.status === 'occupied' && input.status !== 'occupied') {
      const busy = (d.prepare(`SELECT COUNT(*) AS c FROM parking_sessions WHERE spot_id = ? AND status = 'parked'`).get(input.spot_id) as { c: number }).c;
      if (busy > 0) throw new AppError('Chỗ đang có xe đỗ — không thể đổi trạng thái');
    }
    d.prepare(`UPDATE parking_spots SET status = ? WHERE id = ?`).run(input.status, input.spot_id);
    return ok(d.prepare(`SELECT * FROM parking_spots WHERE id = ?`).get(input.spot_id) as ParkingSpot);
  });

  // ---- sessions: check-in ----
  // P4 (BE-011, BE-019 24/24): sweep hết hạn TRƯỚC mỗi check-in (pending quá expires_at
  // = giờ kết thúc + 20p → expired + spot → available), rồi mới xử lý. Thêm `reservation_code?`
  // optional: khớp pending của chính chủ (biển số + SĐT snapshot) trong
  // ngày/khung giờ → consume pending → completed (≡ used) + dùng đúng spot
  // đã giữ. Quá 20p sau giờ kết thúc mà chưa đến: sweep đã đánh expired → báo
  // hết hiệu lực, KHÔNG cho check-in bằng mã đó.
  register(db, 'sessions:check-in', 'staff', (d, input: CheckInInput) => {
    const me = requireRole('staff');
    requirePerm(d, 'checkin');
    // Sweep P4 trước mọi check-in (idempotent, cùng transaction trả spot).
    sweepExpiredReservations(d);
    const plate = normalizePlate(input.license_plate);
    const zone = d.prepare(`SELECT * FROM parking_zones WHERE id = ?`).get(input.zone_id) as ParkingZone | undefined;
    if (!zone) throw new AppError('Không tìm thấy khu vực');
    if (zone.is_active !== 1) throw new AppError('Khu vực đã tắt — không nhận xe mới');
    if (zone.vehicle_type_allowed !== 'both' && zone.vehicle_type_allowed !== input.vehicle_type) {
      throw new AppError('Khu vực không nhận loại xe này');
    }
    const dup = d.prepare(`SELECT ticket_code FROM parking_sessions ps JOIN vehicles v ON v.id = ps.vehicle_id WHERE v.license_plate = ? AND ps.status = 'parked' LIMIT 1`).get(plate) as { ticket_code: string } | undefined;
    if (dup) throw new AppError(`Biển số đã check-in lúc trước (vé ${dup.ticket_code}) — chuyển sang Check-out`);

    // Resolve mã đặt chỗ (nếu có): verify tồn tại + pending + chính chủ + trong ngày/khung.
    let held: Reservation | null = null;
    const resCode = (input.reservation_code ?? '').trim().toUpperCase();
    if (resCode) {
      // S4: check-in bằng mã giữ chỗ = hành động reservation (staff-area.md S4.1).
      requirePerm(d, 'reservation');
      const r = d.prepare(`SELECT * FROM reservations WHERE code = ?`).get(resCode) as Reservation | undefined;
      if (!r) throw new AppError('Mã đặt chỗ không tồn tại — kiểm tra lại mã R-…');
      if (r.status === 'expired') throw new AppError(`Mã ${r.code} đã hết hiệu lực (quá 20 phút sau giờ kết thúc)`);
      if (r.status !== 'pending') throw new AppError(`Mã ${r.code} không còn hiệu lực`);
      if (normalizePlate(r.license_plate) !== plate) {
        throw new AppError(`Mã ${r.code} giữ cho biển số ${r.license_plate} — không áp dụng cho xe này`);
      }
      // Verify phone: SĐT snapshot lúc đặt phải khớp chủ xe (chống dùng ké mã người khác).
      // Xe chưa tồn tại → bỏ qua (staff upsert rồi link vehicle_id sau).
      const normPhone = (p: string | null | undefined): string => (p ?? '').trim().replace(/[\s.\-()]/g, '');
      const resPhone = normPhone(r.customer_phone);
      if (resPhone) {
        const veh = d.prepare(`SELECT owner_phone FROM vehicles WHERE license_plate = ?`).get(plate) as { owner_phone: string } | undefined;
        const ownerPhone = normPhone(veh?.owner_phone ?? input.owner_phone ?? '');
        if (ownerPhone && ownerPhone !== resPhone) {
          throw new AppError(`Mã ${r.code} không thuộc xe này — vui lòng đối soát tại quầy`);
        }
      }
      const today = sqliteNow(d).slice(0, 10);
      if (r.date !== today) {
        // BE-019 24/24 qua đêm: end <= start = kết thúc sang hôm sau
        // → mã hiệu lực 2 ngày (ngày bắt đầu + ngày kết thúc).
        const endDate = r.end_time > r.start_time ? r.date : nextDayOf(r.date);
        if (today !== r.date && today !== endDate) {
          throw new AppError(`Mã ${r.code} không hiệu lực hôm nay (đặt ${r.date} ${r.start_time}→${r.end_time})`);
        }
      }
      const nowStr = sqliteNow(d);
      if (nowStr > r.expires_at) {
        // Quá expires_at (= giờ kết thúc + 20p) mà sweep chưa kịp đánh → đánh expired ngay.
        d.prepare(`UPDATE reservations SET status = 'expired' WHERE id = ?`).run(r.id);
        if (r.spot_id !== null) {
          d.prepare(`UPDATE parking_spots SET status = 'available' WHERE id = ? AND status = 'reserved'`).run(r.spot_id);
        }
        throw new AppError(`Mã ${r.code} đã hết hiệu lực (quá khung giờ giữ)`);
      }
      if (r.zone_id !== zone.id) {
        const rz = d.prepare(`SELECT code FROM parking_zones WHERE id = ?`).get(r.zone_id) as { code: string } | undefined;
        throw new AppError(`Mã ${r.code} giữ chỗ ở khu ${rz?.code ?? r.zone_id} — không áp dụng cho khu này`);
      }
      held = r;
    }

    const checkIn = d.transaction(() => {
      // upsert vehicle (keep existing type/owner when already known)
      let vehicle = d.prepare(`SELECT * FROM vehicles WHERE license_plate = ?`).get(plate) as Vehicle | undefined;
      if (!vehicle) {
        const r = d
          .prepare(`INSERT INTO vehicles (license_plate, vehicle_type, owner_name, owner_phone) VALUES (?, ?, ?, ?)`)
          .run(plate, input.vehicle_type, input.owner_name ?? '', input.owner_phone ?? '');
        vehicle = d.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(r.lastInsertRowid) as Vehicle;
      }
      // pick spot: mã đặt → dùng đúng ô đã giữ; không thì explicit/auto-pick như cũ
      let spot: ParkingSpot | undefined;
      if (held?.spot_id !== null && held?.spot_id !== undefined) {
        const hid = (held as Reservation).spot_id as number;
        if (input.spot_id !== undefined && input.spot_id !== hid) {
          const hs = d.prepare(`SELECT spot_number FROM parking_spots WHERE id = ?`).get(hid) as { spot_number: string } | undefined;
          throw new AppError(`Mã ${(held as Reservation).code} giữ đúng chỗ ${hs?.spot_number ?? hid} — không đổi sang chỗ khác`);
        }
        spot = d.prepare(`SELECT * FROM parking_spots WHERE id = ? AND zone_id = ?`).get(hid, zone.id) as ParkingSpot | undefined;
        if (!spot) throw new AppError('Chỗ đã giữ không còn thuộc khu vực này');
        if (spot.status !== 'reserved') throw new AppError(`Chỗ ${spot.spot_number} không còn được giữ — vui lòng chọn chỗ khác`);
      } else if (input.spot_id !== undefined) {
        spot = d.prepare(`SELECT * FROM parking_spots WHERE id = ? AND zone_id = ?`).get(input.spot_id, zone.id) as ParkingSpot | undefined;
        if (!spot) throw new AppError('Chỗ đỗ không thuộc khu vực này');
        if (spot.status !== 'available') throw new AppError(`Chỗ ${spot.spot_number} không trống`);
      } else {
        spot = d.prepare(`SELECT * FROM parking_spots WHERE zone_id = ? AND status = 'available' ORDER BY spot_number LIMIT 1`).get(zone.id) as ParkingSpot | undefined;
        if (!spot) throw new AppError('Khu vực đã đầy — vui lòng chọn khu khác');
      }
      const now = new Date();
      const nowStr = toUtcInput(now);
      const pass = findValidPass(d, vehicle.id, zone.id, nowStr);
      const ticket = ticketCode(d, now);
      const r = d
        .prepare(
          `INSERT INTO parking_sessions
             (ticket_code, vehicle_id, spot_id, zone_id, monthly_pass_id, check_in_at, status,
              hourly_rate_applied, daily_rate_applied, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'parked', ?, ?, ?)`,
        )
        .run(ticket, vehicle.id, spot.id, zone.id, pass?.id ?? null, nowStr, zone.price_per_hour, zone.price_per_day, me.id);
      d.prepare(`UPDATE parking_spots SET status = 'occupied' WHERE id = ?`).run(spot.id);
      // Consume mã đặt: pending → completed (≡ used) + link xe vừa upsert.
      if (held) {
        d.prepare(`UPDATE reservations SET status = 'completed', vehicle_id = ? WHERE id = ?`).run(vehicle.id, (held as Reservation).id);
      }
      return d.prepare(`SELECT * FROM parking_sessions WHERE id = ?`).get(r.lastInsertRowid) as ParkingSession;
    });
    const session = checkIn();
    // BE-021 (E2): check-in bằng mã = consume → hủy lịch nhắc mã đó.
    if (held) {
      try {
        cancelReservationReminder((held as Reservation).code);
      } catch {
        // ignore
      }
    }
    return ok(session);
  });

  // ---- sessions: fee preview (mandatory BEFORE charge — spec §d) ----
  // M2.2 (BE-015): hằng số grace/ngưỡng ngày đọc từ app-config (không hardcode).
  // Config hỏng/mất → fallback 30p/12h để thu phí không vỡ.
  const feeOpts = (d: AppDb): { graceMinutes: number; dayThresholdHours: number } | undefined => {
    try {
      const s = loadParkingSettings(d);
      return { graceMinutes: s.fee_grace_minutes, dayThresholdHours: s.fee_day_threshold_hours };
    } catch {
      return undefined;
    }
  };
  const preview = (d: AppDb, ticket_code: string, discount_amount = 0): FeePreview => {
    const s = d.prepare(`SELECT * FROM parking_sessions WHERE ticket_code = ?`).get(ticket_code) as ParkingSession | undefined;
    if (!s) throw new AppError('Không tìm thấy vé');
    if (s.status !== 'parked') throw new AppError('Vé đã được check-out');
    const outStr = sqliteNow(d);
    let pass: MonthlyPass | null = null;
    if (s.monthly_pass_id !== null) {
      const p = d.prepare(`SELECT * FROM monthly_passes WHERE id = ?`).get(s.monthly_pass_id) as MonthlyPass | undefined;
      const today = outStr.slice(0, 10);
      if (p && p.status === 'active' && p.start_date <= today && p.end_date >= today) pass = p;
    }
    const calc = calculateFee({
      checkInAt: s.check_in_at,
      checkOutAt: outStr,
      hourlyRate: s.hourly_rate_applied,
      dailyRate: s.daily_rate_applied,
      hasValidPass: pass !== null,
      discountAmount: discount_amount,
    }, feeOpts(d));
    return {
      ticket_code: s.ticket_code,
      check_in_at: s.check_in_at,
      check_out_at: outStr,
      minutes: calc.minutes,
      billed_hours: calc.billedHours,
      applied_daily_rate: calc.appliedDailyRate,
      day_count: calc.dayCount,
      hourly_rate: s.hourly_rate_applied,
      daily_rate: s.daily_rate_applied,
      gross_fee: calc.grossFee,
      discount_amount: calc.discountAmount,
      total_fee: calc.totalFee,
      uses_monthly_pass: pass !== null,
      pass_code: pass?.pass_code ?? null,
    };
  };
  register(db, 'sessions:preview-fee', 'staff', (d, input) => {
    requireRole('staff');
    requirePerm(d, 'checkin');
    return ok(preview(d, input.ticket_code, input.discount_amount ?? 0));
  });

  // ---- sessions: check-out = ONE transaction (UPDATE session + UPDATE spot + INSERT payment) ----
  // BE-018 (qr-anpr.md §1.1B): chấp nhận `qr_payload?` thay cho nhập tay —
  // verify SIG → resolve ticket_code → chạy luồng check-out cũ bên dưới.
  register(db, 'sessions:check-out', 'staff', (d, input) => {
    const me = requireRole('staff');
    requirePerm(d, 'checkin');
    // RV-001 note 3: whitelist enum TRƯỚC khi chạm DB để lỗi thân thiện tiếng Việt
    // (thay vì rớt xuống DB CHECK → generic error).
    const allowedMethods: PaymentMethod[] = ['cash', 'transfer', 'card', 'e_wallet'];
    if (!allowedMethods.includes(input.payment_method)) {
      throw new AppError('Hình thức thanh toán không hợp lệ (tiền mặt / chuyển khoản / thẻ / ví điện tử)');
    }
    // QR resolve (không đổi luồng cũ — chỉ suy ra ticket_code trước khi vào transaction):
    let ticketCode = (input.ticket_code ?? '').trim();
    const qrText = (input.qr_payload ?? '').trim();
    if (qrText) {
      const key = ensureQrHmacKey(d);
      const v = verifyQrSignature(qrText, key.keyB64);
      if (!v.ok) {
        if (v.reason === 'UNSUPPORTED_VERSION') {
          throw new AppError('Mã QR phiên bản mới — cập nhật app để quét vé này');
        }
        throw new AppError('Mã không hợp lệ — có thể vé giả hoặc chụp nhầm');
      }
      if (ticketCode && ticketCode !== v.payload.ticketCode) {
        throw new AppError(`Mã QR (${v.payload.ticketCode}) không khớp mã vé đã nhập (${ticketCode})`);
      }
      ticketCode = v.payload.ticketCode;
    }
    if (!ticketCode) throw new AppError('Mã vé là bắt buộc (nhập tay hoặc quét QR)');
    const discount = Math.max(0, Math.floor(input.discount_amount ?? 0));
    const pay = d.transaction(() => {
      const s = d.prepare(`SELECT * FROM parking_sessions WHERE ticket_code = ?`).get(ticketCode) as ParkingSession | undefined;
      if (!s) throw new AppError('Không tìm thấy vé');
      if (s.status !== 'parked') throw new AppError('Vé đã được check-out');
      const fee = preview(d, s.ticket_code, discount);
      d.prepare(
        `UPDATE parking_sessions
         SET check_out_at = ?, status = 'completed', total_fee = ?, discount_amount = ?, closed_by = ?
         WHERE id = ?`,
      ).run(fee.check_out_at, fee.total_fee, fee.discount_amount, me.id, s.id);
      if (s.spot_id !== null) {
        d.prepare(`UPDATE parking_spots SET status = 'available' WHERE id = ?`).run(s.spot_id);
      }
      const payRow = d
        .prepare(
          `INSERT INTO payments (session_id, monthly_pass_id, amount, payment_method, paid_at, received_by, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(s.id, null, fee.total_fee, input.payment_method, fee.check_out_at, me.id, fee.uses_monthly_pass ? `Ve thang ${fee.pass_code}` : '');
      const session = d.prepare(`SELECT * FROM parking_sessions WHERE id = ?`).get(s.id) as ParkingSession;
      const payment = d.prepare(`SELECT * FROM payments WHERE id = ?`).get(payRow.lastInsertRowid) as Payment;
      return { session, payment };
    });
    return ok(pay());
  });

  // ---- vé QR ký HMAC (spec ./specs/qr-anpr.md §1.2–§1.3 — BE-018 V1a) ----
  //  - `auth:qr-key`: staff đã login lấy key 256-bit (sinh lười lần đầu,
  //    lưu app-config.json) → device cất secure storage, verify offline.
  //    Guard staff (admin cũng qua được — register 'staff' = admin OR staff).
  //  - `tickets:qr-payload`: backend ký (frontend/mobile KHÔNG tự ký) —
  //    dùng ở success sheet check-in + tab Vé khách.
  //  - `tickets:verify-qr`: online verify SIG + đối soát `status='parked'` +
  //    trả fee preview (máy offline tự check SIG bằng key + ghi pending_sync,
  //    khi online gọi lại kênh này để đối soát — vé đã dùng → NEED_REVIEW ở app).
  register(db, 'auth:qr-key', 'staff', (d) => {
    requireRole('staff');
    const { keyB64, keyId } = ensureQrHmacKey(d);
    // KHÔNG log key (security-review §8) — chỉ trả về qua kênh đã đăng nhập.
    return ok({ key_b64: keyB64, key_id: keyId });
  });

  register(db, 'tickets:qr-payload', 'staff', (d, input) => {
    requireRole('staff');
    requirePerm(d, 'checkin');
    const code = (input.ticket_code ?? '').trim();
    if (!code) throw new AppError('Mã vé là bắt buộc');
    const row = d
      .prepare(
        `SELECT ps.ticket_code AS ticket_code, v.license_plate AS license_plate, ps.check_in_at AS check_in_at
         FROM parking_sessions ps JOIN vehicles v ON v.id = ps.vehicle_id
         WHERE ps.ticket_code = ?`,
      )
      .get(code) as { ticket_code: string; license_plate: string; check_in_at: string } | undefined;
    if (!row) throw new AppError('Không tìm thấy vé');
    const { keyB64 } = ensureQrHmacKey(d);
    const qrText = signTicket({
      ticketCode: row.ticket_code,
      licensePlate: row.license_plate,
      checkInAt: row.check_in_at,
      keyB64,
    });
    return ok({
      qr_text: qrText,
      ticket_code: row.ticket_code,
      license_plate: normalizePlateForQr(row.license_plate),
      check_in_at: row.check_in_at,
    } satisfies QrPayloadOutput);
  });

  register(db, 'tickets:verify-qr', 'staff', (d, input) => {
    requireRole('staff');
    requirePerm(d, 'checkin');
    const qrText = (input.qr_text ?? '').trim();
    if (!qrText) throw new AppError('Mã QR là bắt buộc');
    const { keyB64 } = ensureQrHmacKey(d);
    const v = verifyQrSignature(qrText, keyB64);
    if (!v.ok) {
      const message =
        v.reason === 'UNSUPPORTED_VERSION'
          ? 'Mã phiên bản mới — cập nhật app để quét vé này'
          : 'Mã không hợp lệ — có thể vé giả hoặc chụp nhầm.';
      return ok({ valid: false, reason: v.reason, message } satisfies QrVerifyOutput);
    }
    const s = d.prepare(`SELECT * FROM parking_sessions WHERE ticket_code = ?`).get(v.payload.ticketCode) as ParkingSession | undefined;
    if (!s) {
      return ok({ valid: false, reason: 'NOT_FOUND', message: 'Không tìm thấy vé — kiểm tra lại mã.' } satisfies QrVerifyOutput);
    }
    if (s.status !== 'parked') {
      const when = (s.check_out_at ?? '').slice(0, 16).replace('T', ' ');
      return ok({
        valid: false,
        reason: 'ALREADY_USED',
        message: `Vé ${s.ticket_code} đã sử dụng${when ? ` lúc ${when}` : ''}.`,
        session: s,
      } satisfies QrVerifyOutput);
    }
    // Đối soát biển số: SIG đúng nhưng biển DB khác QR (vé bị sửa tay sau ký).
    const veh = d.prepare(`SELECT license_plate FROM vehicles WHERE id = ?`).get(s.vehicle_id) as { license_plate: string } | undefined;
    if (veh && normalizePlateForQr(veh.license_plate) !== v.payload.plateNorm) {
      return ok({
        valid: false,
        reason: 'PLATE_MISMATCH',
        message: `Biển số trên vé (${v.payload.plateNorm}) không khớp hồ sơ xe — vui lòng đối soát tại quầy.`,
        session: s,
      } satisfies QrVerifyOutput);
    }
    return ok({
      valid: true,
      message: `Vé ${s.ticket_code} hợp lệ — kiểm tra phí rồi thu.`,
      session: s,
      fee_preview: preview(d, s.ticket_code, 0),
    } satisfies QrVerifyOutput);
  });

  register(db, 'sessions:active', 'staff', (d, input) => {
    const rows =
      input.zone_id !== undefined
        ? d.prepare(`SELECT * FROM parking_sessions WHERE status = 'parked' AND zone_id = ? ORDER BY check_in_at`).all(input.zone_id)
        : d.prepare(`SELECT * FROM parking_sessions WHERE status = 'parked' ORDER BY check_in_at`).all();
    return ok(rows as ParkingSession[]);
  });
  register(db, 'sessions:history', 'staff', (d, input) => {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (input.from) {
      conds.push(`date(check_in_at) >= date(?)`);
      vals.push(input.from);
    }
    if (input.to) {
      conds.push(`date(check_in_at) <= date(?)`);
      vals.push(input.to);
    }
    if (input.zone_id !== undefined) {
      conds.push(`zone_id = ?`);
      vals.push(input.zone_id);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (d.prepare(`SELECT COUNT(*) AS c FROM parking_sessions ${where}`).get(...vals) as { c: number }).c;
    const rows = d.prepare(`SELECT * FROM parking_sessions ${where} ORDER BY check_in_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as ParkingSession[];
    return ok({ rows, total });
  });

  // ---- vehicles ----
  register(db, 'vehicles:find', 'staff', (d, input) => {
    const plate = normalizePlate(input.license_plate);
    return ok((d.prepare(`SELECT * FROM vehicles WHERE license_plate = ?`).get(plate) as Vehicle | undefined) ?? null);
  });

  // ---- monthly passes ----
  register(db, 'passes:list', 'staff', (d, input) => {
    requireRole('staff');
    requirePerm(d, 'pass_sale');
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (input.status) {
      conds.push(`status = ?`);
      vals.push(input.status);
    }
    if (input.search) {
      conds.push(`(customer_name LIKE ? OR pass_code LIKE ? OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_id AND v.license_plate LIKE ?))`);
      const like = `%${input.search.trim().toUpperCase()}%`;
      vals.push(like, like, like);
    }
    if (input.expiring_within_days !== undefined) {
      conds.push(`status = 'active' AND date(end_date) BETWEEN date('now') AND date('now', ?)`);
      vals.push(`+${Math.max(0, input.expiring_within_days)} days`);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    return ok(d.prepare(`SELECT * FROM monthly_passes ${where} ORDER BY end_date`).all(...vals) as MonthlyPass[]);
  });

  const sellPass = (d: AppDb, args: { plate: string; vehicle_type: VehicleType; customer_name: string; customer_phone: string; zone_id: number | null; months: 1 | 3 | 6 | 12; start_date: string; payment_method: PaymentMethod; actorId: number }): { pass: MonthlyPass; payment: Payment } => {
    if (!args.customer_name.trim()) throw new AppError('Tên chủ xe là bắt buộc');
    if (![1, 3, 6, 12].includes(args.months)) throw new AppError('Gói vé tháng không hợp lệ');
    if (args.zone_id !== null) {
      const z = d.prepare(`SELECT id FROM parking_zones WHERE id = ?`).get(args.zone_id) as { id: number } | undefined;
      if (!z) throw new AppError('Không tìm thấy khu vực');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.start_date)) throw new AppError('Ngày bắt đầu không hợp lệ (YYYY-MM-DD)');
    const plate = normalizePlate(args.plate);
    // Duplicate guard: an active overlapping pass for same vehicle + zone scope blocks sale.
    const clash = d
      .prepare(
        `SELECT pass_code, end_date FROM monthly_passes mp JOIN vehicles v ON v.id = mp.vehicle_id
         WHERE v.license_plate = ? AND mp.status = 'active' AND mp.end_date >= ?
           AND ((mp.zone_id IS NULL) OR (mp.zone_id = ?) OR (? IS NULL))
         LIMIT 1`,
      )
      .get(plate, args.start_date, args.zone_id, args.zone_id) as { pass_code: string; end_date: string } | undefined;
    if (clash) throw new AppError(`Biển số này đã có vé hiệu lực đến ${clash.end_date} (${clash.pass_code})`);

    const tx = d.transaction(() => {
      let vehicle = d.prepare(`SELECT * FROM vehicles WHERE license_plate = ?`).get(plate) as Vehicle | undefined;
      if (!vehicle) {
        const r = d.prepare(`INSERT INTO vehicles (license_plate, vehicle_type, owner_name, owner_phone) VALUES (?, ?, ?, ?)`).run(plate, args.vehicle_type, args.customer_name.trim(), args.customer_phone);
        vehicle = d.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(r.lastInsertRowid) as Vehicle;
      }
      // Base monthly price: derive from zone daily rate x30, or 300k fallback for all-zone.
      let base = 300000;
      if (args.zone_id !== null) {
        const z = d.prepare(`SELECT price_per_day FROM parking_zones WHERE id = ?`).get(args.zone_id) as { price_per_day: number };
        base = z.price_per_day * 30;
      }
      const price = calculatePassPrice(base, args.months);
      const [y, m, day] = args.start_date.split('-').map(Number);
      const end = new Date(Date.UTC(y, m - 1 + args.months, day));
      const endStr = end.toISOString().slice(0, 10);
      const now = new Date();
      const code = passCode(d, now);
      const r = d
        .prepare(
          `INSERT INTO monthly_passes
             (pass_code, vehicle_id, zone_id, customer_name, customer_phone, start_date, end_date, price, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(code, vehicle.id, args.zone_id, args.customer_name.trim(), args.customer_phone, args.start_date, endStr, price, args.actorId);
      const pass = d.prepare(`SELECT * FROM monthly_passes WHERE id = ?`).get(r.lastInsertRowid) as MonthlyPass;
      const nowStr = toUtcInput(now);
      const pr = d
        .prepare(`INSERT INTO payments (session_id, monthly_pass_id, amount, payment_method, paid_at, received_by, note) VALUES (NULL, ?, ?, ?, ?, ?, ?)`)
        .run(pass.id, price, args.payment_method, nowStr, args.actorId, `Ban ve thang ${code} (${args.months} thang)`);
      const payment = d.prepare(`SELECT * FROM payments WHERE id = ?`).get(pr.lastInsertRowid) as Payment;
      return { pass, payment };
    });
    return tx();
  };

  register(db, 'passes:create', 'staff', (d, input) => {
    const me = requireRole('staff');
    requirePerm(d, 'pass_sale');
    const today = sqliteNow(d).slice(0, 10);
    return ok(
      sellPass(d, {
        plate: input.license_plate,
        vehicle_type: input.vehicle_type,
        customer_name: input.customer_name,
        customer_phone: input.customer_phone ?? '',
        zone_id: input.zone_id ?? null,
        months: input.months,
        start_date: input.start_date ?? today,
        payment_method: input.payment_method ?? 'cash',
        actorId: me.id,
      }),
    );
  });

  register(db, 'passes:renew', 'staff', (d, input) => {
    const me = requireRole('staff');
    requirePerm(d, 'pass_sale');
    const cur = d.prepare(`SELECT * FROM monthly_passes WHERE pass_code = ?`).get(input.pass_code) as MonthlyPass | undefined;
    if (!cur) throw new AppError('Không tìm thấy vé tháng');
    if (cur.status === 'cancelled') throw new AppError('Vé đã hủy — không thể gia hạn');
    const vehicle = d.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(cur.vehicle_id) as Vehicle;
    const today = sqliteNow(d).slice(0, 10);
    // Continue from max(today, current expiry + 1 day).
    const cont = cur.end_date >= today ? cur.end_date : today;
    const [y, m, day] = cont.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, day));
    if (cur.end_date >= today) start.setUTCDate(start.getUTCDate() + 1);
    const created = sellPass(d, {
      plate: vehicle.license_plate,
      vehicle_type: vehicle.vehicle_type,
      customer_name: cur.customer_name,
      customer_phone: cur.customer_phone,
      zone_id: cur.zone_id,
      months: input.months,
      start_date: start.toISOString().slice(0, 10),
      payment_method: input.payment_method ?? 'cash',
      actorId: me.id,
    });
    // BE-021 (E1 §1.4): gia hạn xong → vé cũ hết vòng đời nhắc, không bắn D-3/D-0 cho mã cũ.
    try {
      suppressPassReminders(cur.pass_code);
    } catch {
      // ignore
    }
    return ok(created);
  });

  register(db, 'passes:cancel', 'none', (d, input) => {
    // BE-010 follow-up P3 (spec ./specs/customer-area.md §P3.2 + P3.4):
    // staff giữ nguyên full; customer CHỈ được hủy pass `pending` của chính
    // mình (verify vehicles.owner_phone = me.phone qua normalizePhone).
    // Guard 'none' + authz trong handler (cùng pattern users:update P1).
    // reason KHÔNG persist (cùng quy ước cũ) — echo vào message, KHÔNG chèn
    // payment giả (tránh bẩn v_revenue_daily.tx_count).
    const me = getCurrentUser();
    if (!me) throw new AppError('Chưa đăng nhập');
    const reason = input.reason?.trim() ?? '';
    if (me.role_name === 'customer') {
      const norm = (p: string | null | undefined): string => (p ?? '').trim().replace(/[\s.\-()]/g, '');
      const mePhone = norm(me.phone);
      if (!mePhone) throw new AppError('Tài khoản chưa liên kết số điện thoại — vui lòng ra quầy');
      const row = d
        .prepare(
          `SELECT mp.*, v.owner_phone AS owner_phone FROM monthly_passes mp
           JOIN vehicles v ON v.id = mp.vehicle_id WHERE mp.pass_code = ?`,
        )
        .get((input.pass_code ?? '').trim()) as (MonthlyPass & { owner_phone: string }) | undefined;
      if (!row) throw new AppError('Không tìm thấy vé tháng');
      if (row.status !== 'pending' || norm(row.owner_phone) !== mePhone) {
        throw new AppError('Chỉ được hủy đăng ký đang chờ của bạn');
      }
      d.prepare(`UPDATE monthly_passes SET status = 'cancelled' WHERE id = ?`).run(row.id);
      const p = d.prepare(`SELECT * FROM monthly_passes WHERE id = ?`).get(row.id) as MonthlyPass;
      return ok(p, reason ? `Đã hủy đăng ký ${p.pass_code} (lý do: ${reason})` : `Đã hủy đăng ký ${p.pass_code}`);
    }
    requireRole('staff');
    requirePerm(d, 'pass_sale');
    const tx = d.transaction(() => {
      d.prepare(`UPDATE monthly_passes SET status = 'cancelled' WHERE pass_code = ?`).run(input.pass_code);
      const p = d.prepare(`SELECT * FROM monthly_passes WHERE pass_code = ?`).get(input.pass_code) as MonthlyPass | undefined;
      if (!p) throw new AppError('Không tìm thấy vé tháng');
      return p;
    });
    const cancelled = tx();
    return ok(cancelled, reason ? `Đã hủy vé ${cancelled.pass_code} (lý do: ${reason})` : `Đã hủy vé ${cancelled.pass_code}`);
  });

  // ---- monthly passes: staff confirm customer request (P3 — BE-009) ----
  // Quyết định: IPC MỚI `passes:confirm` (không mở rộng passes:create/cancel
  // hiện tại — giữ nguyên theo out-of-scope BE-009). Guard staff.
  //  - approve: pending → active + INSERT payments (thu tiền mặt/chuyển khoản
  //    tại quầy) trong CÙNG 1 transaction (mirror check-out §8).
  //  - reject: pending → cancelled, reason echo vào message (KHÔNG persist —
  //    schema không có cột, cùng quy ước passes:cancel; KHÔNG chèn payment giả).
  // Vé pending KHÔNG miễn phí check-in: findValidPass + preview chỉ nhận
  // status='active' (đã verify — không sửa).
  register(db, 'passes:confirm', 'staff', (d, input: PassConfirmInput) => {
    const me = requireRole('staff');
    requirePerm(d, 'pass_sale');
    if (input.action !== 'approve' && input.action !== 'reject') {
      throw new AppError('Hành động không hợp lệ (duyệt / từ chối)');
    }
    const allowedMethods: PaymentMethod[] = ['cash', 'transfer', 'card', 'e_wallet'];
    const code = (input.pass_code ?? '').trim();
    if (!code) throw new AppError('Mã vé là bắt buộc');

    const tx = d.transaction(() => {
      const p = d.prepare(`SELECT * FROM monthly_passes WHERE pass_code = ?`).get(code) as MonthlyPass | undefined;
      if (!p) throw new AppError('Không tìm thấy vé tháng');
      if (p.status !== 'pending') {
        throw new AppError(`Vé ${p.pass_code} không ở trạng thái chờ xác nhận`);
      }
      if (input.action === 'approve') {
        const method = input.payment_method ?? 'cash';
        if (!allowedMethods.includes(method)) {
          throw new AppError('Hình thức thanh toán không hợp lệ (tiền mặt / chuyển khoản / thẻ / ví điện tử)');
        }
        d.prepare(`UPDATE monthly_passes SET status = 'active' WHERE id = ?`).run(p.id);
        const nowStr = toUtcInput(new Date());
        const pr = d
          .prepare(
            `INSERT INTO payments (session_id, monthly_pass_id, amount, payment_method, paid_at, received_by, note)
             VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
          )
          .run(p.id, p.price, method, nowStr, me.id, `Thu ve thang ${p.pass_code} tai quay`);
        const pass = d.prepare(`SELECT * FROM monthly_passes WHERE id = ?`).get(p.id) as MonthlyPass;
        const payment = d.prepare(`SELECT * FROM payments WHERE id = ?`).get(pr.lastInsertRowid) as Payment;
        return { out: { pass, payment } satisfies PassConfirmOutput, reason: '' };
      }
      const reason = input.reason?.trim() ?? '';
      d.prepare(`UPDATE monthly_passes SET status = 'cancelled' WHERE id = ?`).run(p.id);
      const pass = d.prepare(`SELECT * FROM monthly_passes WHERE id = ?`).get(p.id) as MonthlyPass;
      return { out: { pass, payment: null } satisfies PassConfirmOutput, reason };
    });
    const { out, reason } = tx();
    if (input.action === 'approve') {
      return ok(out, `Đã kích hoạt vé ${out.pass.pass_code} — đã thu ${out.pass.price.toLocaleString('vi-VN')}₫ tại quầy.`);
    }
    return ok(out, reason ? `Đã từ chối vé ${out.pass.pass_code} (lý do: ${reason})` : `Đã từ chối vé ${out.pass.pass_code}`);
  });

  // ---- reports (admin only; staff shift view via payments:list mine_only) ----
  register(db, 'reports:revenue', 'admin', (d, input) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
      throw new AppError('Khoảng ngày không hợp lệ (YYYY-MM-DD)');
    }
    return ok(
      d.prepare(`SELECT * FROM v_revenue_daily WHERE day BETWEEN ? AND ? ORDER BY day`).all(input.from, input.to) as RevenueDaily[],
    );
  });
  register(db, 'reports:sessions-daily', 'admin', (d, input) =>
    ok(d.prepare(`SELECT * FROM v_sessions_daily WHERE day BETWEEN ? AND ? ORDER BY day`).all(input.from, input.to) as SessionsDaily[]),
  );
  register(db, 'reports:dashboard', 'staff', (d) => {
    requireRole('staff');
    // S4: dashboard chứa doanh thu hôm nay → thuộc report_self (staff-area.md S4.1).
    requirePerm(d, 'report_self');
    const availability = d.prepare(`SELECT * FROM v_zone_availability ORDER BY zone_code`).all() as ZoneAvailability[];
    const active = (d.prepare(`SELECT COUNT(*) AS c FROM parking_sessions WHERE status = 'parked'`).get() as { c: number }).c;
    const today = sqliteNow(d).slice(0, 10);
    const rev = d.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE date(paid_at) = date(?)`).get(today) as { s: number };
    const expiring = d
      .prepare(`SELECT * FROM monthly_passes WHERE status = 'active' AND date(end_date) BETWEEN date('now') AND date('now', '+7 days') ORDER BY end_date`)
      .all() as MonthlyPass[];
    return ok({ availability, active_sessions: active, revenue_today: rev.s, passes_expiring_soon: expiring });
  });

  // ---- users (S1: SELECT mở rộng address/start_date/notes; staff gọi vẫn strip notes) ----
  // Quyết định S1.4: frontend staff KHÔNG gọi list, nhưng nếu gọi thì backend loại
  // notes khỏi mọi row (kể cả của chính mình) thay vì chặn — admin giữ full.
  register(db, 'users:list', 'staff', (d) => {
    const me = requireRole('staff');
    const rows = d
      .prepare(
        `SELECT ${USER_DTO_SELECT}
         FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.username`,
      )
      .all() as UserDTO[];
    if (me.role_name !== 'admin') {
      return ok(rows.map(({ notes: _omit, ...rest }) => withPerms(rest)));
    }
    return ok(rows.map(withPerms));
  });
  register(db, 'users:create', 'admin', (d, input) => {
    if (!input.username || input.username.trim().length < 3) {
      throw new ValidationError({ username: ['Tên đăng nhập từ 3 ký tự'] });
    }
    if (!input.full_name.trim()) throw new ValidationError({ full_name: ['Họ tên là bắt buộc'] });
    const roleId = input.role === 'admin' ? 1 : 2;
    try {
      const r = d
        .prepare(`INSERT INTO users (username, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)`)
        .run(input.username.trim(), hashPassword(input.password), input.full_name.trim(), roleId);
      const row = d
        .prepare(
          `SELECT ${USER_DTO_SELECT}
           FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        )
        .get(r.lastInsertRowid) as UserDTO;
      return ok(withPerms(row));
    } catch (e) {
      if (e instanceof ValidationError || e instanceof AppError) throw e;
      throw new AppError('Tên đăng nhập đã tồn tại');
    }
  });
  register(db, 'users:update', 'none', (d, input) => {
    // P1 (spec customer-area.md §P1.2): tái dùng kênh này cho customer tự sửa hồ sơ.
    //  - customer: CHỈ được update chính mình (id = me.id), chỉ full_name + new_password;
    //    username/SĐT cấm đổi (khóa link xe §0.1) → chặn với message VN rõ ràng.
    //  - đổi pass (new_password) khi TỰ đổi (id = me.id, mọi role): BẮT BUỘC verify
    //    current_password bằng bcrypt trước khi hash mới; sai → ValidationError có
    //    errors.current_password để frontend render inline dưới field (không banner chung).
    //  - admin reset pass cho NGƯỜI KHÁC: không cần current_password (admin không biết).
    //  - staff/guest: giữ nguyên — không quyền (ma trận §11: quản lý users = admin).
    // Ghi chú: bcrypt là one-way — mật khẩu CHỈ đặt lại (reset), không bao giờ đọc lại.
    const me = getCurrentUser();
    if (!me) throw new AppError('Chưa đăng nhập');
    const isSelf = input.id === me.id;
    const isCustomer = me.role_name === 'customer';
    if (isCustomer && !isSelf) throw new AppError('Bạn chỉ được cập nhật hồ sơ của chính mình');
    if (!isCustomer && me.role_name !== 'admin') throw new AppError('Chỉ Admin được thực hiện thao tác này');
    if (isCustomer && input.username !== undefined && input.username.trim() !== '' && input.username.trim() !== me.username) {
      throw new AppError('Số điện thoại đăng nhập không thể đổi — vui lòng ra quầy');
    }
    // S1.4: customer KHÔNG được chạm 4 field hồ sơ (tự sửa qua users:update chỉ
    // full_name/pass; SĐT đổi = ra quầy). Admin patch 4 field này ở dưới.
    const PROFILE_KEYS = ['phone', 'address', 'start_date', 'notes'] as const;
    if (isCustomer && PROFILE_KEYS.some((k) => input[k] !== undefined)) {
      throw new AppError('Bạn chỉ được cập nhật họ tên và mật khẩu');
    }
    const cur = d.prepare(`SELECT id FROM users WHERE id = ?`).get(input.id) as { id: number } | undefined;
    if (!cur) throw new AppError('Không tìm thấy user');
    const hasUsername = !isCustomer && input.username !== undefined && input.username.trim() !== '';
    const hasFullName = input.full_name !== undefined && input.full_name.trim() !== '';
    const hasPassword = input.new_password !== undefined && input.new_password !== '';
    // S1 admin patch: normalize (rỗng → NULL để clear) + validate S1.5.
    const isAdmin = me.role_name === 'admin';
    const newPhone = isAdmin ? normalizeProfilePhone(input.phone) : undefined;
    const newAddress = isAdmin ? normalizeProfileAddress(input.address) : undefined;
    const newStartDate = isAdmin ? normalizeProfileStartDate(d, input.start_date) : undefined;
    const newNotes = isAdmin ? normalizeProfileNotes(input.notes) : undefined;
    // S4: admin gán permissions — whitelist 5 keys (normalizePermissionsPatch);
    // target admin → bỏ qua (admin luôn full, không lưu). null → reset NULL.
    const targetRole = (
      d.prepare(`SELECT r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`).get(input.id) as { role_name: RoleName } | undefined
    )?.role_name;
    const newPermissions =
      isAdmin && targetRole !== 'admin' && input.permissions !== undefined
        ? normalizePermissionsPatch(input.permissions)
        : undefined;
    const hasProfilePatch =
      newPhone !== undefined || newAddress !== undefined || newStartDate !== undefined || newNotes !== undefined || newPermissions !== undefined;
    if (!hasUsername && !hasFullName && !hasPassword && !hasProfilePatch) throw new AppError('Không có gì để cập nhật');
    if (input.username !== undefined && !isCustomer && input.username.trim().length < 3) {
      throw new ValidationError({ username: ['Tên đăng nhập từ 3 ký tự'] });
    }
    if (input.full_name !== undefined && !input.full_name.trim()) {
      throw new ValidationError({ full_name: ['Họ tên là bắt buộc'] });
    }
    if (hasPassword && isSelf) {
      // Verify mật khẩu hiện tại TRƯỚC khi hash mới (P1.2 — sai → INVALID field-level).
      const row = d.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(input.id) as { password_hash: string } | undefined;
      const current = input.current_password ?? '';
      if (!current) {
        throw new ValidationError({ current_password: ['Vui lòng nhập mật khẩu hiện tại.'] }, 'Vui lòng nhập mật khẩu hiện tại.');
      }
      if (!row || !bcrypt.compareSync(current, row.password_hash)) {
        throw new ValidationError({ current_password: ['Mật khẩu hiện tại chưa đúng.'] }, 'Mật khẩu hiện tại chưa đúng.');
      }
      if (input.new_password === current) {
        throw new ValidationError({ new_password: ['Mật khẩu mới phải khác mật khẩu hiện tại.'] }, 'Mật khẩu mới phải khác mật khẩu hiện tại.');
      }
    }
    // hashPassword tự validate >= 6 ký tự ('Mật khẩu phải từ 6 ký tự').
    const newHash = hasPassword ? hashPassword(input.new_password as string) : null;
    if (hasUsername) {
      const clash = d.prepare(`SELECT id FROM users WHERE username = ? AND id != ?`).get(input.username?.trim(), input.id) as { id: number } | undefined;
      if (clash) throw new AppError('Tên đăng nhập đã tồn tại');
    }
    // S1.5: SĐT staff/admin unique trừ chính mình (NULL distinct nên clear → NULL luôn OK).
    if (newPhone) {
      const clash = d.prepare(`SELECT id FROM users WHERE phone = ? AND id != ?`).get(newPhone, input.id) as { id: number } | undefined;
      if (clash) throw new AppError('SĐT đã được dùng.');
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (hasUsername) {
      sets.push('username = ?');
      vals.push((input.username as string).trim());
    }
    if (hasFullName) {
      sets.push('full_name = ?');
      vals.push((input.full_name as string).trim());
    }
    if (newPhone !== undefined) {
      sets.push('phone = ?');
      vals.push(newPhone);
    }
    if (newAddress !== undefined) {
      sets.push('address = ?');
      vals.push(newAddress);
    }
    if (newStartDate !== undefined) {
      sets.push('start_date = ?');
      vals.push(newStartDate);
    }
    if (newNotes !== undefined) {
      sets.push('notes = ?');
      vals.push(newNotes);
    }
    if (newPermissions !== undefined) {
      sets.push('permissions = ?');
      vals.push(newPermissions);
    }
    if (newHash !== null) {
      sets.push('password_hash = ?');
      vals.push(newHash);
    }
    try {
      d.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, input.id);
    } catch (e) {
      if (e instanceof ValidationError || e instanceof AppError) throw e;
      // Race UNIQUE(username/phone) — map thân thiện thay vì lỗi DB thô.
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('users.phone')) throw new ValidationError({ phone: ['SĐT đã được dùng.'] });
      throw new AppError('Tên đăng nhập đã tồn tại');
    }
    const row = d
      .prepare(
        `SELECT ${USER_DTO_SELECT}
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(input.id) as UserDTO | undefined;
    if (!row) throw new AppError('Không tìm thấy user');
    // P1: tự đổi hồ sơ → refresh session memory để auth:me trả DTO mới ngay.
    if (isSelf) refreshCurrentUser(d, input.id);
    return ok(withPerms(row));
  });
  register(db, 'users:toggle-active', 'admin', (d, input) => {
    d.prepare(`UPDATE users SET is_active = ? WHERE id = ?`).run(input.is_active, input.id);
    const row = d
      .prepare(
        `SELECT ${USER_DTO_SELECT}
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(input.id) as UserDTO | undefined;
    if (!row) throw new AppError('Không tìm thấy user');
    return ok(withPerms(row));
  });

  // ---- S1 "Hồ sơ của tôi" (staff-area.md S1.3/S1.4) ----
  // Backend ép id = me.id (không nhận id từ client). Trả StaffSelfProfile —
  // KHÔNG BAO GIỜ có notes (admin-only tuyệt đối, kể cả xem chính mình).
  // staff gọi users:update vẫn bị chặn như cũ (guard trong users:update);
  // tự sửa SĐT/địa chỉ đi qua users:profile:update bên dưới.
  const SELF_PROFILE_SELECT = `u.id, u.username, u.full_name, u.phone, u.address, u.start_date,
         r.name AS role_name, u.is_active, u.created_at`;
  register(db, 'users:profile', 'staff', (d) => {
    const me = requireRole('staff');
    const row = d
      .prepare(
        `SELECT ${SELF_PROFILE_SELECT}
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(me.id) as StaffSelfProfile | undefined;
    if (!row) throw new AppError('Không tìm thấy hồ sơ');
    return ok(row);
  });
  register(db, 'users:profile:update', 'staff', (d, input: StaffProfileUpdateInput) => {
    const me = requireRole('staff');
    // S4: tự sửa SĐT/địa chỉ cần flag profile_self (staff-area.md S4.1).
    requirePerm(d, 'profile_self');
    // CHỈ phone + address được tự sửa (S1.4). notes/start_date/role KHÔNG đọc
    // từ input (dù client có gửi cũng bị bỏ qua) — muốn đổi phải qua admin.
    const newPhone = normalizeProfilePhone(input.phone);
    const newAddress = normalizeProfileAddress(input.address);
    if (newPhone === undefined && newAddress === undefined) throw new AppError('Không có gì để cập nhật');
    if (newPhone) {
      const clash = d.prepare(`SELECT id FROM users WHERE phone = ? AND id != ?`).get(newPhone, me.id) as { id: number } | undefined;
      if (clash) throw new AppError('SĐT đã được dùng.');
    }
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (newPhone !== undefined) {
        sets.push('phone = ?');
        vals.push(newPhone);
      }
      if (newAddress !== undefined) {
        sets.push('address = ?');
        vals.push(newAddress);
      }
      d.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, me.id);
    } catch (e) {
      if (e instanceof ValidationError || e instanceof AppError) throw e;
      throw new ValidationError({ phone: ['SĐT đã được dùng.'] });
    }
    const row = d
      .prepare(
        `SELECT ${SELF_PROFILE_SELECT}
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(me.id) as StaffSelfProfile | undefined;
    if (!row) throw new AppError('Không tìm thấy hồ sơ');
    refreshCurrentUser(d, me.id);
    return ok(row);
  });

  // ---- customer area P2 (spec ./specs/customer-area.md §P2.2) ----
  // Mine-only server-side: backend ép me.phone, KHÔNG nhận phone từ client
  // (cùng pattern activity:list ép staff_id = me.id). Chuẩn hóa 2 đầu:
  // trim + bỏ khoảng trắng/dấu chấm/dấu gạch (SĐT chỉ số, so sánh sau normalize).
  const normalizePhone = (p: string | null | undefined): string =>
    (p ?? '').trim().replace(/[\s.\-()]/g, '');
  // Biểu thức SQL mirror normalizePhone để WHERE khớp dù quầy nhập SĐT có dấu cách.
  const PHONE_NORM_SQL = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(owner_phone), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')`;

  register(db, 'customer:vehicles', 'none', (d) => {
    const me = requireCustomer();
    const phone = normalizePhone(me.phone);
    if (!phone) throw new AppError('Tài khoản chưa liên kết số điện thoại — vui lòng ra quầy');
    const vehicles = d
      .prepare(
        `SELECT v.*,
           (SELECT COUNT(*) FROM parking_sessions ps WHERE ps.vehicle_id = v.id) AS session_count,
           (SELECT COALESCE(SUM(ps.total_fee), 0) FROM parking_sessions ps
             WHERE ps.vehicle_id = v.id AND ps.status = 'completed') AS total_spent,
           EXISTS(SELECT 1 FROM parking_sessions ps
             WHERE ps.vehicle_id = v.id AND ps.status = 'parked') AS is_parked
         FROM vehicles v
         WHERE ${PHONE_NORM_SQL} = ?
         ORDER BY v.license_plate`,
      )
      .all(phone) as CustomerVehicle[];
    const total = d
      .prepare(
        `SELECT COALESCE(SUM(ps.total_fee), 0) AS s
         FROM parking_sessions ps JOIN vehicles v ON v.id = ps.vehicle_id
         WHERE ${PHONE_NORM_SQL} = ? AND ps.status = 'completed'`,
      )
      .get(phone) as { s: number };
    return ok({ vehicles, total_spent: total.s });
  });

  register(db, 'customer:sessions', 'none', (d, input) => {
    const me = requireCustomer();
    const phone = normalizePhone(me.phone);
    if (!phone) throw new AppError('Tài khoản chưa liên kết số điện thoại — vui lòng ra quầy');
    if (input.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) {
      throw new AppError('Ngày bắt đầu không hợp lệ (YYYY-MM-DD)');
    }
    if (input.to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
      throw new AppError('Ngày kết thúc không hợp lệ (YYYY-MM-DD)');
    }
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = Math.max(0, input.offset ?? 0);
    const search = input.search?.trim().toUpperCase() || null;
    const conds: string[] = [`${PHONE_NORM_SQL} = ?`];
    const vals: unknown[] = [phone];
    if (input.from) {
      conds.push(`date(ps.check_in_at) >= date(?)`);
      vals.push(input.from);
    }
    if (input.to) {
      conds.push(`date(ps.check_in_at) <= date(?)`);
      vals.push(input.to);
    }
    if (search) {
      conds.push(`(ps.ticket_code LIKE ? OR v.license_plate LIKE ?)`);
      const like = `%${search}%`;
      vals.push(like, like);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const join = `FROM parking_sessions ps JOIN vehicles v ON v.id = ps.vehicle_id
      LEFT JOIN parking_zones z ON z.id = ps.zone_id`;
    const total = (d.prepare(`SELECT COUNT(*) AS c ${join} ${where}`).get(...vals) as { c: number }).c;
    const rows = d
      .prepare(
        `SELECT ps.ticket_code AS ticket_code, v.license_plate AS license_plate,
           z.code AS zone_code, z.name AS zone_name,
           ps.check_in_at AS check_in_at, ps.check_out_at AS check_out_at,
           ps.total_fee AS total_fee, ps.monthly_pass_id AS monthly_pass_id,
           CASE WHEN ps.monthly_pass_id IS NOT NULL THEN 1 ELSE 0 END AS is_monthly,
           (SELECT p.payment_method FROM payments p WHERE p.session_id = ps.id
             ORDER BY p.paid_at DESC, p.id DESC LIMIT 1) AS payment_method
         ${join} ${where}
         ORDER BY ps.check_in_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...vals, limit, offset) as CustomerSessionRow[];
    const spent = d
      .prepare(
        `SELECT COALESCE(SUM(ps.total_fee), 0) AS s ${join} ${where} AND ps.status = 'completed'`,
      )
      .get(...vals) as { s: number };
    return ok({ rows, total, total_spent: spent.s } satisfies CustomerSessionsOutput);
  });

  // ---- customer area P3 (spec ./specs/customer-area.md §P3 — BE-009) ----
  // "Đăng ký trước — trả tiền tại quầy": customer tạo vé `pending`, staff xác
  // nhận qua `passes:confirm` (pending → active + INSERT payments cùng
  // transaction) hoặc từ chối (pending → cancelled). KHÔNG thanh toán online.
  register(db, 'customer:pass-request', 'none', (d, input: CustomerPassRequestInput) => {
    const me = requireCustomer();
    const mePhone = normalizePhone(me.phone);
    if (!mePhone) throw new AppError('Tài khoản chưa liên kết số điện thoại — vui lòng ra quầy');
    if (!Number.isInteger(input.vehicle_id) || input.vehicle_id < 1) {
      throw new AppError('Xe không hợp lệ');
    }
    if (![1, 3, 6, 12].includes(input.package_months)) {
      throw new AppError('Gói vé tháng không hợp lệ');
    }
    const startDate = input.start_date ?? sqliteNow(d).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new AppError('Ngày bắt đầu không hợp lệ (YYYY-MM-DD)');
    }
    const zoneId = input.zone_id ?? null;

    const tx = d.transaction(() => {
      // 1. Xe phải tồn tại + thuộc chính mình (verify owner_phone = me.phone).
      const vehicle = d.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(input.vehicle_id) as Vehicle | undefined;
      if (!vehicle) throw new AppError('Không tìm thấy xe');
      if (normalizePhone(vehicle.owner_phone) !== mePhone) {
        throw new AppError('Xe không thuộc tài khoản của bạn — vui lòng ra quầy');
      }
      // 2. Zone (nếu chọn): tồn tại + đang mở + nhận loại xe này.
      if (zoneId !== null) {
        const z = d.prepare(`SELECT * FROM parking_zones WHERE id = ?`).get(zoneId) as ParkingZone | undefined;
        if (!z) throw new AppError('Không tìm thấy khu vực');
        if (z.is_active !== 1) throw new AppError('Khu vực đã tắt — vui lòng chọn khu khác');
        if (z.vehicle_type_allowed !== 'both' && z.vehicle_type_allowed !== vehicle.vehicle_type) {
          throw new AppError(`Khu ${z.code} không nhận loại xe này.`);
        }
      }
      // 3. Chống trùng: đã có vé pending/active overlapping cùng xe + zone scope.
      const [y, m, day] = startDate.split('-').map(Number);
      const end = new Date(Date.UTC(y, m - 1 + input.package_months, day));
      const endStr = end.toISOString().slice(0, 10);
      const clash = d
        .prepare(
          `SELECT pass_code FROM monthly_passes
            WHERE vehicle_id = ? AND status IN ('pending', 'active')
              AND NOT (end_date < ? OR start_date > ?)
              AND (zone_id IS NULL OR zone_id = ? OR ? IS NULL)
            LIMIT 1`,
        )
        .get(vehicle.id, startDate, endStr, zoneId, zoneId) as { pass_code: string } | undefined;
      if (clash) throw new AppError(`Xe này đã có vé ${clash.pass_code} còn hiệu lực/chờ xác nhận`);
      // 4. Giá = công thức staff (tái dùng calculatePassPrice, gói 12T −10%).
      let base = 300000;
      if (zoneId !== null) {
        const z = d.prepare(`SELECT price_per_day FROM parking_zones WHERE id = ?`).get(zoneId) as { price_per_day: number };
        base = z.price_per_day * 30;
      }
      const price = calculatePassPrice(base, input.package_months);
      const now = new Date();
      const code = passCode(d, now);
      const r = d
        .prepare(
          `INSERT INTO monthly_passes
             (pass_code, vehicle_id, zone_id, customer_name, customer_phone, start_date, end_date, price, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(code, vehicle.id, zoneId, me.full_name.trim(), me.phone ?? '', startDate, endStr, price, me.id);
      return d.prepare(`SELECT * FROM monthly_passes WHERE id = ?`).get(r.lastInsertRowid) as MonthlyPass;
    });
    const pass = tx();
    return ok(pass, `Đã gửi đăng ký ${pass.pass_code} — mang ${pass.price.toLocaleString('vi-VN')}₫ ra quầy để kích hoạt.`);
  });

  // ---- customer area P3 follow-up (BE-010, FE-014 đề xuất) ----
  // `customer:passes`: list vé tháng của chính mình (xe có owner_phone =
  // me.phone, mine-only server-side như customer:vehicles/sessions BE-008)
  // để frontend bỏ workaround localStorage. Filter status optional, sort
  // mới nhất (created_at DESC, id DESC), pagination {limit,offset}.
  register(db, 'customer:passes', 'none', (d, input: CustomerPassesInput) => {
    const me = requireCustomer();
    const phone = normalizePhone(me.phone);
    if (!phone) throw new AppError('Tài khoản chưa liên kết số điện thoại — vui lòng ra quầy');
    const allowed: PassStatus[] = ['pending', 'active', 'expired', 'cancelled', 'suspended'];
    if (input.status !== undefined && !allowed.includes(input.status)) {
      throw new AppError('Trạng thái vé không hợp lệ');
    }
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = Math.max(0, input.offset ?? 0);
    const conds: string[] = [`${PHONE_NORM_SQL} = ?`];
    const vals: unknown[] = [phone];
    if (input.status) {
      conds.push(`mp.status = ?`);
      vals.push(input.status);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const join = `FROM monthly_passes mp JOIN vehicles v ON v.id = mp.vehicle_id`;
    const total = (d.prepare(`SELECT COUNT(*) AS c ${join} ${where}`).get(...vals) as { c: number }).c;
    const rows = d
      .prepare(`SELECT mp.* ${join} ${where} ORDER BY mp.created_at DESC, mp.id DESC LIMIT ? OFFSET ?`)
      .all(...vals, limit, offset) as MonthlyPass[];
    return ok({ rows, total } satisfies CustomerPassesOutput);
  });

  // ---- customer area P4 (spec ./specs/customer-area.md §P4 — BE-011, BE-019 24/24) ----
  // Đặt chỗ mọi giờ + qua đêm được (end <= start = sang hôm sau). Quota ≤ 2
  // pending|active/customer/ngày bắt đầu (COUNT trước INSERT — race nhỏ chấp
  // nhận được ở app single-writer). date backend ép = today (bỏ qua client).
  // expires_at = giờ KẾT THÚC + 20p (datetime đầy đủ, tự tràn ngày). Check-in
  // bằng mã ở sessions:check-in.
  register(db, 'customer:reserve', 'none', (d, input: CustomerReserveInput) => {
    const me = requireCustomer();
    const mePhone = (me.phone ?? '').trim().replace(/[\s.\-()]/g, '');
    if (!mePhone) throw new AppError('Tài khoản chưa liên kết số điện thoại — vui lòng ra quầy');
    const zone = d.prepare(`SELECT * FROM parking_zones WHERE id = ?`).get(input.zone_id) as ParkingZone | undefined;
    if (!zone) throw new AppError('Không tìm thấy khu vực');
    if (zone.is_active !== 1) throw new AppError('Khu vực đã tắt — vui lòng chọn khu khác');
    // Biển số gõ tay: UPPERCASE + copy lỗi cụ thể (không dùng normalizePlate generic).
    const plate = (input.license_plate ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (plate.length < 4) throw new AppError('Biển số chưa đúng — VD: 51H-12345.');
    // Tương thích loại xe: xe đã tồn tại → dùng type lưu sẵn; chưa có → dùng
    // vehicle_type client gửi (nếu có); cả hai đều thiếu → bỏ qua check này.
    const existing = d.prepare(`SELECT id, vehicle_type FROM vehicles WHERE license_plate = ?`).get(plate) as { id: number; vehicle_type: VehicleType } | undefined;
    const vtype: VehicleType | null = existing?.vehicle_type ?? input.vehicle_type ?? null;
    if (vtype && zone.vehicle_type_allowed !== 'both' && zone.vehicle_type_allowed !== vtype) {
      throw new AppError(`Khu ${zone.code} không nhận loại xe này.`);
    }
    // Khung giờ 24/24 + qua đêm: alias time_from/time_to (api-contract §13) → start_time/end_time.
    // end <= start = kết thúc sang hôm sau (VD: 23:00→01:00). KHÔNG giới hạn khung giờ.
    const start = (input.start_time ?? input.time_from ?? '').trim();
    const end = (input.end_time ?? input.time_to ?? '').trim();
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      throw new AppError('Khung giờ không hợp lệ (HH:mm) — VD: 08:00–12:00 hoặc 23:00–01:00 (qua đêm).');
    }
    if (start === end) throw new AppError('Giờ kết thúc phải sau giờ bắt đầu.');
    const durMin = reservationDurationMin(start, end);
    if (durMin < 15 || durMin > 240) throw new AppError('Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ.');
    const nowTime = sqliteNow(d).slice(11, 16);
    // Giờ bắt đầu không được quá khứ > 15p (spec P4.4) — so bằng phút cùng ngày bắt đầu (= today).
    if (toMinutes(start) < toMinutes(nowTime) - 15) {
      throw new AppError('Giờ bắt đầu đã qua — vui lòng chọn khung giờ khác.');
    }
    const today = sqliteNow(d).slice(0, 10);

    const tx = d.transaction(() => {
      // Quota mine-only: pending|active của chính mình trong hôm nay.
      const mine = (
        d.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE user_id = ? AND status IN ('pending','active') AND date = ?`).get(me.id, today) as { c: number }
      ).c;
      if (mine >= 2) throw new AppError('Bạn đã có 2 chỗ đang giữ.');
      // Capacity + auto-pick ô trống (hết → từ chối, không giữ theo khu suông).
      const spot = d.prepare(`SELECT * FROM parking_spots WHERE zone_id = ? AND status = 'available' ORDER BY spot_number LIMIT 1`).get(zone.id) as ParkingSpot | undefined;
      if (!spot) throw new AppError(`Khu ${zone.code} vừa hết chỗ giữ — chọn khu khác.`);
      const code = reservationCode(d, today);
      // BE-019: expires_at = giờ KẾT THÚC + 20p (datetime đầy đủ, qua đêm tràn ngày).
      const endDate = end > start ? today : nextDayOf(today);
      const expiresAt = addMinutesToDateTime(endDate, end, 20);
      const r = d
        .prepare(
          `INSERT INTO reservations
             (code, user_id, vehicle_id, license_plate, customer_phone, zone_id, spot_id,
              date, start_time, end_time, status, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(code, me.id, existing?.id ?? null, plate, me.phone ?? '', zone.id, spot.id, today, start, end, expiresAt);
      d.prepare(`UPDATE parking_spots SET status = 'reserved' WHERE id = ?`).run(spot.id);
      return d.prepare(`SELECT * FROM reservations WHERE id = ?`).get(r.lastInsertRowid) as Reservation;
    });
    const row = tx();
    const overnightNote = row.end_time > row.start_time ? '' : ' (qua đêm)';
    // BE-021 (E2): đặt lịch nhắc start − 20p; đặt muộn (<20p) → bắn 30s sau giữ.
    try {
      const gapMin = (toMinutes(start) - toMinutes(nowTime) + 1440) % 1440;
      scheduleReservationReminder(d, row.code, gapMin < E2_LEAD_MINUTES);
    } catch {
      // scheduler lỗi không được phá kết quả đặt chỗ
    }
    return ok(row, `Đã giữ chỗ ${plate} ở khu ${zone.code} — mã ${row.code}, hiệu lực đến ${row.end_time}${overnightNote}.`);
  });

  register(db, 'customer:reservations', 'none', (d, input: CustomerReservationsInput) => {
    const me = requireCustomer();
    const allowed: ReservationStatus[] = ['pending', 'active', 'completed', 'cancelled', 'expired'];
    if (input.status !== undefined && !allowed.includes(input.status)) {
      throw new AppError('Trạng thái đặt chỗ không hợp lệ');
    }
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = Math.max(0, input.offset ?? 0);
    const conds: string[] = [`r.user_id = ?`];
    const vals: unknown[] = [me.id];
    if (input.status) {
      conds.push(`r.status = ?`);
      vals.push(input.status);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const join = `FROM reservations r
      LEFT JOIN parking_zones z ON z.id = r.zone_id
      LEFT JOIN parking_spots s ON s.id = r.spot_id`;
    const total = (d.prepare(`SELECT COUNT(*) AS c ${join} ${where}`).get(...vals) as { c: number }).c;
    const rows = d
      .prepare(
        `SELECT r.*, z.code AS zone_code, z.name AS zone_name, s.spot_number AS spot_number
         ${join} ${where} ORDER BY r.date, r.start_time LIMIT ? OFFSET ?`,
      )
      .all(...vals, limit, offset) as CustomerReservationRow[];
    return ok({ rows, total } satisfies CustomerReservationsOutput);
  });

  register(db, 'customer:reserve-cancel', 'none', (d, input: CustomerReserveCancelInput) => {
    const me = requireCustomer();
    const code = (input.code ?? '').trim().toUpperCase();
    if (!code) throw new AppError('Mã đặt chỗ là bắt buộc');
    const tx = d.transaction(() => {
      // Mine-only: code + user_id cùng lúc (không lộ mã của người khác).
      const r = d.prepare(`SELECT * FROM reservations WHERE code = ? AND user_id = ?`).get(code, me.id) as Reservation | undefined;
      if (!r) throw new AppError('Không tìm thấy mã đặt chỗ của bạn');
      if (r.status !== 'pending') throw new AppError('Chỉ được hủy chỗ đang giữ');
      d.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).run(r.id);
      // Trả ô đã giữ về available (guard reserved để không đụng ô đã consume).
      if (r.spot_id !== null) {
        d.prepare(`UPDATE parking_spots SET status = 'available' WHERE id = ? AND status = 'reserved'`).run(r.spot_id);
      }
      return d.prepare(`SELECT * FROM reservations WHERE id = ?`).get(r.id) as Reservation;
    });
    const out = tx();
    // BE-021 (E2): hủy lịch nhắc của mã vừa hủy (không bắn cho reservation đã cancelled).
    try {
      cancelReservationReminder(code);
    } catch {
      // ignore
    }
    return ok(out, `Đã hủy giữ chỗ ${code}.`);
  });

  // ---- payments (append-only: list only, no update/delete by design) ----
  register(db, 'payments:list', 'staff', (d, input) => {
    const me = requireRole('staff');
    // S4: xem thu chi ca mình → report_self (staff-area.md S4.1).
    requirePerm(d, 'report_self');
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (input.from) {
      conds.push(`date(paid_at) >= date(?)`);
      vals.push(input.from);
    }
    if (input.to) {
      conds.push(`date(paid_at) <= date(?)`);
      vals.push(input.to);
    }
    if (input.mine_only) {
      conds.push(`received_by = ?`);
      vals.push(me.id);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    return ok(d.prepare(`SELECT * FROM payments ${where} ORDER BY paid_at DESC LIMIT 500`).all(...vals) as Payment[]);
  });

  // ---- activity log (màn "Nhật ký", spec ./specs/activity-log.md) ----
  // UNION ALL 3 nguồn read-only, KHÔNG tách row "thu phí" riêng (tránh double-count
  // với check_out/pass_sale — amount đã nằm trong row event, payment_method JOIN
  // thêm chỉ để hiển thị ở cột Ghi chú). Không lộ password_hash (chỉ JOIN username/full_name).
  register(db, 'activity:list', 'staff', (d, input) => {
    const me = requireRole('staff');
    // S4: báo cáo + hiệu suất ca mình → report_self (staff-area.md S4.1/S2.2).
    requirePerm(d, 'report_self');
    // Guard mine_only: staff bị force staff_id = chính mình (bỏ qua staff_id gửi lên).
    const effectiveStaffId = me.role_name === 'staff' ? me.id : input.staff_id;
    if (input.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) {
      throw new AppError('Ngày bắt đầu không hợp lệ (YYYY-MM-DD)');
    }
    if (input.to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
      throw new AppError('Ngày kết thúc không hợp lệ (YYYY-MM-DD)');
    }
    const allowedActions: ActivityAction[] = ['check_in', 'check_out', 'pass_sale'];
    if (input.action !== undefined && !allowedActions.includes(input.action)) {
      throw new AppError('Loại hành động không hợp lệ');
    }
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = Math.max(0, input.offset ?? 0);
    const search = input.search?.trim().toUpperCase() || null;
    const like = search ? `%${search}%` : null;

    // Filter chung áp cho từng nhánh: user_id (actor) + khoảng ngày theo `at`.
    // Search LIKE áp từng nhánh trên ticket/plate/username (COALESCE để giữ row
    // user đã xóa khi search khớp mã vé/biển số).
    const branchFilter = (atCol: string, actorCol: string): { sql: string; vals: unknown[] } => {
      const conds: string[] = [];
      const vals: unknown[] = [];
      if (effectiveStaffId !== undefined) {
        conds.push(`${actorCol} = ?`);
        vals.push(effectiveStaffId);
      }
      if (input.from) {
        conds.push(`date(${atCol}) >= date(?)`);
        vals.push(input.from);
      }
      if (input.to) {
        conds.push(`date(${atCol}) <= date(?)`);
        vals.push(input.to);
      }
      return { sql: conds.length > 0 ? `AND ${conds.join(' AND ')}` : '', vals };
    };
    const searchFilter = (ticketCol: string, plateCol: string): { sql: string; vals: unknown[] } => {
      if (!like) return { sql: '', vals: [] };
      return {
        sql: `AND (${ticketCol} LIKE ? OR ${plateCol} LIKE ? OR COALESCE(u.username, '') LIKE ?)`,
        vals: [like, like, like],
      };
    };

    const branches: string[] = [];
    const vals: unknown[] = [];
    const want = (a: ActivityAction): boolean => input.action === undefined || input.action === a;

    if (want('check_in')) {
      const f = branchFilter('ps.check_in_at', 'ps.created_by');
      const s = searchFilter('ps.ticket_code', 'v.license_plate');
      branches.push(
        `SELECT ps.check_in_at AS at, ps.created_by AS user_id, u.username AS username, u.full_name AS full_name,
          'check_in' AS action, ps.ticket_code AS ticket_code, v.license_plate AS license_plate,
          z.code AS zone_code, z.name AS zone_name, NULL AS amount,
          CASE WHEN ps.monthly_pass_id IS NOT NULL THEN 1 ELSE 0 END AS is_monthly_session,
          NULL AS payment_method, (z.code || ' — ' || z.name) AS note
        FROM parking_sessions ps
        JOIN vehicles v ON v.id = ps.vehicle_id
        JOIN parking_zones z ON z.id = ps.zone_id
        LEFT JOIN users u ON u.id = ps.created_by
        WHERE ps.created_by IS NOT NULL ${f.sql} ${s.sql}`,
      );
      vals.push(...f.vals, ...s.vals);
    }
    if (want('check_out')) {
      const f = branchFilter('ps.check_out_at', 'ps.closed_by');
      const s = searchFilter('ps.ticket_code', 'v.license_plate');
      branches.push(
        `SELECT ps.check_out_at AS at, ps.closed_by AS user_id, u.username AS username, u.full_name AS full_name,
          'check_out' AS action, ps.ticket_code AS ticket_code, v.license_plate AS license_plate,
          z.code AS zone_code, z.name AS zone_name, ps.total_fee AS amount, 0 AS is_monthly_session,
          (SELECT p.payment_method FROM payments p WHERE p.session_id = ps.id ORDER BY p.paid_at DESC, p.id DESC LIMIT 1) AS payment_method,
          (z.code || ' — ' || z.name) AS note
        FROM parking_sessions ps
        JOIN vehicles v ON v.id = ps.vehicle_id
        JOIN parking_zones z ON z.id = ps.zone_id
        LEFT JOIN users u ON u.id = ps.closed_by
        WHERE ps.status = 'completed' AND ps.check_out_at IS NOT NULL ${f.sql} ${s.sql}`,
      );
      vals.push(...f.vals, ...s.vals);
    }
    if (want('pass_sale')) {
      const f = branchFilter('mp.created_at', 'mp.created_by');
      const s = searchFilter('mp.pass_code', 'v.license_plate');
      branches.push(
        `SELECT mp.created_at AS at, mp.created_by AS user_id, u.username AS username, u.full_name AS full_name,
          'pass_sale' AS action, mp.pass_code AS ticket_code, v.license_plate AS license_plate,
          z.code AS zone_code, z.name AS zone_name, mp.price AS amount, 0 AS is_monthly_session,
          (SELECT p.payment_method FROM payments p WHERE p.monthly_pass_id = mp.id ORDER BY p.paid_at DESC, p.id DESC LIMIT 1) AS payment_method,
          (COALESCE(z.code, 'ALL') || ' — ' || COALESCE(z.name, 'Mọi khu')) AS note
        FROM monthly_passes mp
        JOIN vehicles v ON v.id = mp.vehicle_id
        LEFT JOIN parking_zones z ON z.id = mp.zone_id
        LEFT JOIN users u ON u.id = mp.created_by
        WHERE mp.created_by IS NOT NULL ${f.sql} ${s.sql}`,
      );
      vals.push(...f.vals, ...s.vals);
    }

    const union = branches.join(' UNION ALL ');
    const total = (d.prepare(`SELECT COUNT(*) AS c FROM (${union})`).get(...vals) as { c: number }).c;
    const rows = d.prepare(`SELECT * FROM (${union}) ORDER BY at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset) as ActivityRow[];
    return ok({ rows, total } satisfies ActivityListOutput);
  });

  // ---- staff area S3 (spec ./specs/staff-area.md §S3 — BE-013) ----
  // Ca + chấm công/bàn giao (migration-006). Guard staff cho mọi kênh đọc/
  // chấm; staff LUÔN ép user_id = me.id (mine-only, pattern activity:list) —
  // chỉ admin được truyền staff_id để chấm/chốt hộ. KHÔNG ép overlap ca ở
  // DB (Warning phía app khi shifts:update trùng giờ — S3.3).
  const LATE_GRACE_MIN = 10; // vào trễ quá start_time + 10p → status 'late'
  const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  const ATTENDANCE_ROW_SELECT = `a.*, s.code AS shift_code, s.name AS shift_name,
    s.start_time AS shift_start, s.end_time AS shift_end,
    u.username AS username, u.full_name AS full_name
    FROM attendance a JOIN shifts s ON s.id = a.shift_id
    LEFT JOIN users u ON u.id = a.user_id`;

  /** 'YYYY-MM-DD' lùi 1 ngày (quy ước ca đêm: work_date = ngày bắt đầu ca). */
  function yesterdayOf(today: string): string {
    const dt = new Date(`${today}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  }

  /** work_date của 1 ca tại giờ tường t ('HH:MM'): ca qua ngày + t < end → hôm qua. */
  function workDateForShift(shift: Shift, today: string, t: string): string {
    const st = shift.start_time.slice(0, 5);
    const en = shift.end_time.slice(0, 5);
    if (en < st && t < en) return yesterdayOf(today);
    return today;
  }

  /**
   * Ca hiện tại theo giờ tường (api-contract.md §14): 00:00–06:00 → NIGHT
   * của hôm qua; 06:00–14:00 → MORNING; 14:00–22:00 → AFTERNOON;
   * 22:00–24:00 → NIGHT today. Ưu tiên giờ admin đã cấu hình (shifts đang
   * mở); fallback mapping cứng theo hợp đồng khi không khớp ca nào.
   */
  function resolveCurrentShift(d: AppDb, nowStr: string): { shift: Shift; workDate: string } {
    const today = nowStr.slice(0, 10);
    const t = nowStr.slice(11, 16);
    const active = d.prepare(`SELECT * FROM shifts WHERE is_active = 1 ORDER BY id`).all() as Shift[];
    for (const s of active) {
      const st = s.start_time.slice(0, 5);
      const en = s.end_time.slice(0, 5);
      if (en > st) {
        if (t >= st && t < en) return { shift: s, workDate: today };
      } else if (t >= st || t < en) {
        return { shift: s, workDate: workDateForShift(s, today, t) };
      }
    }
    // Fallback cứng (§14) — resolve shift_id bằng code, không hardcode id.
    const code: ShiftCode = t < '06:00' ? 'NIGHT' : t < '14:00' ? 'MORNING' : t < '22:00' ? 'AFTERNOON' : 'NIGHT';
    const s = d.prepare(`SELECT * FROM shifts WHERE code = ?`).get(code) as Shift | undefined;
    if (!s) throw new AppError('Chưa cấu hình ca làm việc — liên hệ Admin.');
    return { shift: s, workDate: workDateForShift(s, today, t) };
  }

  /** Trễ = phút từ start_time ca đến giờ bấm vào (xuyên nửa đêm) > grace. */
  function isLateCheckIn(shift: Shift, workDate: string, nowStr: string): boolean {
    const today = nowStr.slice(0, 10);
    const t = nowStr.slice(11, 16);
    const startMin = toMinutes(shift.start_time.slice(0, 5));
    let elapsed = toMinutes(t) - startMin;
    if (workDate < today) elapsed += 24 * 60; // vào sau nửa đêm của ca qua ngày
    return elapsed > LATE_GRACE_MIN;
  }

  /** staff_id override: staff bị ép me.id; admin được chấm/chốt hộ khi truyền staff_id. */
  function resolveAttendanceUser(d: AppDb, staffIdInput: number | undefined): number {
    const me = requireRole('staff');
    if (staffIdInput === undefined) return me.id;
    if (me.role_name !== 'admin') return me.id; // staff gửi staff_id cũng bị bỏ qua
    const u = d.prepare(`SELECT id, is_active FROM users WHERE id = ?`).get(staffIdInput) as { id: number; is_active: 0 | 1 } | undefined;
    if (!u) throw new AppError('Không tìm thấy nhân viên');
    if (u.is_active !== 1) throw new AppError('Tài khoản nhân viên đang bị khóa');
    return u.id;
  }

  /** Khung giờ ca (UTC, khớp paid_at) để đối soát doanh thu trong ca. */
  function shiftWindow(d: AppDb, workDate: string, shift: Shift): { from: string; to: string } {
    const st = shift.start_time.slice(0, 5);
    const en = shift.end_time.slice(0, 5);
    const from = `${workDate} ${st}:00`;
    const to = en > st
      ? `${workDate} ${en}:00`
      : ((d.prepare(`SELECT date(?, '+1 day') AS d`).get(workDate) as { d: string }).d + ` ${en}:00`);
    return { from, to };
  }

  function revenueInShift(d: AppDb, userId: number, from: string, to: string): number {
    return (d.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE received_by = ? AND paid_at >= ? AND paid_at < ?`).get(userId, from, to) as { s: number }).s;
  }

  const vnd = (n: number): string => `${n.toLocaleString('vi-VN')}₫`;

  register(db, 'shifts:list', 'staff', (d) => {
    requireRole('staff');
    return ok(d.prepare(`SELECT * FROM shifts ORDER BY id`).all() as Shift[]);
  });

  register(db, 'shifts:update', 'admin', (d, input: ShiftUpdateInput) => {
    requireRole('admin');
    const cur = d.prepare(`SELECT * FROM shifts WHERE id = ?`).get(input.id) as Shift | undefined;
    if (!cur) throw new AppError('Không tìm thấy ca làm việc');
    const sets: string[] = [];
    const vals: unknown[] = [];
    const eff = {
      name: cur.name,
      start: cur.start_time.slice(0, 5),
      end: cur.end_time.slice(0, 5),
      active: cur.is_active,
    };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new AppError('Tên ca là bắt buộc');
      if (name.length > 50) throw new AppError('Tên ca tối đa 50 ký tự');
      eff.name = name;
      sets.push('name = ?');
      vals.push(name);
    }
    if (input.start_time !== undefined) {
      const st = input.start_time.trim();
      if (!HHMM_RE.test(st)) throw new AppError('Giờ bắt đầu không hợp lệ (HH:mm, VD: 06:00)');
      eff.start = st;
      sets.push('start_time = ?');
      vals.push(st);
    }
    if (input.end_time !== undefined) {
      const en = input.end_time.trim();
      if (!HHMM_RE.test(en)) throw new AppError('Giờ kết thúc không hợp lệ (HH:mm, VD: 14:00)');
      eff.end = en;
      sets.push('end_time = ?');
      vals.push(en);
    }
    if (input.is_active !== undefined) {
      if (input.is_active !== 0 && input.is_active !== 1) throw new AppError('Trạng thái ca không hợp lệ');
      eff.active = input.is_active;
      sets.push('is_active = ?');
      vals.push(input.is_active);
    }
    if (sets.length === 0) throw new AppError('Không có gì để cập nhật');
    if (eff.start === eff.end) throw new AppError('Giờ bắt đầu phải khác giờ kết thúc');
    d.prepare(`UPDATE shifts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, input.id);
    // Overlap Warning KHÔNG chặn (S3.3): so khoảng tròn 1440p với các ca đang mở khác.
    let overlapNote = '';
    if (eff.active === 1) {
      const segs = (s: string, e: string): Array<[number, number]> => {
        const a = toMinutes(s);
        const b = toMinutes(e);
        return b > a ? [[a, b]] : [[a, 1440], [0, b]];
      };
      const mine = segs(eff.start, eff.end);
      const others = d.prepare(`SELECT code, name, start_time, end_time FROM shifts WHERE id != ? AND is_active = 1`).all(input.id) as Shift[];
      const clash = others.filter((o) => {
        const theirs = segs(o.start_time.slice(0, 5), o.end_time.slice(0, 5));
        return mine.some(([a1, a2]) => theirs.some(([b1, b2]) => Math.max(a1, b1) < Math.min(a2, b2)));
      });
      if (clash.length > 0) {
        overlapNote = ` — lưu ý: khung giờ trùng với ${clash.map((c) => `${c.name} (${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)})`).join(', ')}`;
      }
    }
    const row = d.prepare(`SELECT * FROM shifts WHERE id = ?`).get(input.id) as Shift;
    const overnightNote = eff.end < eff.start ? ' (ca qua ngày)' : '';
    return ok(row, `Đã cập nhật ${row.name} ${eff.start}–${eff.end}${overnightNote}${overlapNote ? `${overlapNote} — kiểm tra lại.` : '.'}`);
  });

  register(db, 'attendance:check-in', 'staff', (d, input: AttendanceCheckInInput) => {
    const userId = resolveAttendanceUser(d, input.staff_id);
    const opening = input.opening_cash ?? 0;
    if (!Number.isInteger(opening) || opening < 0) {
      throw new AppError('Tiền đầu ca phải là số nguyên VND >= 0');
    }
    const nowStr = sqliteNow(d);
    const today = nowStr.slice(0, 10);
    // Resolve ca: ưu tiên shift_id → shift_code → auto theo giờ tường.
    let shift: Shift | undefined;
    if (input.shift_id !== undefined) {
      shift = d.prepare(`SELECT * FROM shifts WHERE id = ?`).get(input.shift_id) as Shift | undefined;
      if (!shift) throw new AppError('Không tìm thấy ca làm việc');
    } else if (input.shift_code !== undefined) {
      const allowed: ShiftCode[] = ['MORNING', 'AFTERNOON', 'NIGHT'];
      if (!allowed.includes(input.shift_code)) throw new AppError('Mã ca không hợp lệ');
      shift = d.prepare(`SELECT * FROM shifts WHERE code = ?`).get(input.shift_code) as Shift | undefined;
      if (!shift) throw new AppError('Không tìm thấy ca làm việc');
    } else {
      shift = resolveCurrentShift(d, nowStr).shift;
    }
    if (shift.is_active !== 1) throw new AppError(`Ca ${shift.name} đã tắt — không xếp ca mới`);
    const workDate = workDateForShift(shift, today, nowStr.slice(11, 16));
    const status: AttendanceStatus = isLateCheckIn(shift, workDate, nowStr) ? 'late' : 'present';
    try {
      const r = d
        .prepare(
          `INSERT INTO attendance (user_id, shift_id, work_date, check_in_at, opening_cash, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, shift.id, workDate, nowStr, opening, status);
      const row = d.prepare(`SELECT * FROM attendance WHERE id = ?`).get(r.lastInsertRowid) as Attendance;
      // BE-021 (E4): vào ca → đặt lịch nhắc end+30p (chốt ca hủy lịch).
      try {
        scheduleShiftReminder(d, row.id);
      } catch {
        // scheduler lỗi không được phá kết quả chấm công
      }
      return ok(
        row,
        status === 'late'
          ? `Đã vào ca ${shift.name} (trễ — quá giờ bắt đầu ${LATE_GRACE_MIN} phút).`
          : `Đã vào ca ${shift.name}.`,
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('UNIQUE')) throw new AppError('Bạn đã vào ca này.');
      throw new AppError('Chấm công thất bại — vui lòng thử lại');
    }
  });

  register(db, 'attendance:check-out', 'staff', (d, input: AttendanceCheckOutInput) => {
    const userId = resolveAttendanceUser(d, input.staff_id);
    const closing: number | null = input.closing_cash ?? null;
    if (closing !== null && (!Number.isInteger(closing) || closing < 0)) {
      throw new AppError('Tiền cuối ca phải là số nguyên VND >= 0');
    }
    // undefined → giữ note cũ; null/rỗng → NULL (xóa); có chữ → trim (max 500).
    let note: string | null | undefined;
    if (input.handover_note === undefined) {
      note = undefined;
    } else {
      const t = (input.handover_note ?? '').trim();
      if (t.length > 500) throw new ValidationError({ handover_note: ['Ghi chú bàn giao tối đa 500 ký tự.'] });
      note = t || null;
    }
    const tx = d.transaction(() => {
      // Chốt ca đang mở gần nhất (ca hôm nay, hoặc "chốt bù" ca hôm qua còn treo).
      const row = d
        .prepare(`SELECT ${ATTENDANCE_ROW_SELECT} WHERE a.user_id = ? AND a.check_out_at IS NULL ORDER BY a.work_date DESC, a.id DESC LIMIT 1`)
        .get(userId) as AttendanceRow | undefined;
      if (!row || !row.check_in_at) throw new AppError('Bạn chưa vào ca — bấm "Vào ca" trước');
      const nowStr = sqliteNow(d);
      if (nowStr <= row.check_in_at) throw new AppError('Chưa thể chốt ca — vui lòng thử lại sau ít giây');
      const shift = d.prepare(`SELECT * FROM shifts WHERE id = ?`).get(row.shift_id) as Shift;
      const w = shiftWindow(d, row.work_date, shift);
      const revenue = revenueInShift(d, userId, w.from, w.to);
      const finalClosing = closing ?? row.closing_cash;
      d.prepare(
        `UPDATE attendance SET check_out_at = ?, closing_cash = ?, handover_note = ? WHERE id = ?`,
      ).run(nowStr, finalClosing, note === undefined ? row.handover_note : note, row.id);
      const out = d.prepare(`SELECT * FROM attendance WHERE id = ?`).get(row.id) as Attendance;
      const variance = finalClosing === null ? null : finalClosing - row.opening_cash - revenue;
      return { out, revenue, variance, shiftName: shift.name, workDate: row.work_date, opening: row.opening_cash };
    });
    const { out, revenue, variance, shiftName, workDate, opening } = tx();
    // BE-021 (E4): chốt ca (kể cả chốt bù) → hủy lịch nhắc ca đó.
    try {
      cancelShiftReminder(out.id);
    } catch {
      // ignore
    }
    const warn = variance !== null && variance !== 0
      ? ` — đối soát lệch ${variance > 0 ? '+' : '−'}${vnd(Math.abs(variance))} (thực ${closing !== null ? vnd(closing) : '—'} − đầu ca ${vnd(opening)} − thu trong ca ${vnd(revenue)}), admin đối soát sau.`
      : variance === 0
        ? ' (đối soát khớp).'
        : '.';
    return ok({ attendance: out, revenue_in_shift: revenue, variance } satisfies AttendanceCheckOutOutput, `Đã chốt ca ${shiftName} ngày ${workDate}${warn}`);
  });

  register(db, 'attendance:today', 'staff', (d) => {
    const me = requireRole('staff');
    const nowStr = sqliteNow(d);
    const { shift, workDate } = resolveCurrentShift(d, nowStr);
    const attendance = d
      .prepare(`SELECT * FROM attendance WHERE user_id = ? AND shift_id = ? AND work_date = ?`)
      .get(me.id, shift.id, workDate) as Attendance | undefined ?? null;
    // Banner "chốt bù": row cũ nhất còn treo, loại trừ row ca hiện tại (nếu có).
    const pending_close = d
      .prepare(
        `SELECT * FROM attendance WHERE user_id = ? AND check_out_at IS NULL
         AND id != COALESCE(?, -1) ORDER BY work_date ASC, id ASC LIMIT 1`,
      )
      .get(me.id, attendance?.id ?? null) as Attendance | undefined ?? null;
    return ok({ shift, work_date: workDate, attendance, pending_close } satisfies AttendanceTodayOutput);
  });

  register(db, 'attendance:list', 'staff', (d, input: AttendanceListInput) => {
    const me = requireRole('staff');
    // Staff ép me (pattern mine_only); admin lọc staff_id optional.
    const effectiveStaffId = me.role_name === 'staff' ? me.id : input.staff_id;
    if (input.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) {
      throw new AppError('Ngày bắt đầu không hợp lệ (YYYY-MM-DD)');
    }
    if (input.to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
      throw new AppError('Ngày kết thúc không hợp lệ (YYYY-MM-DD)');
    }
    if (input.from && input.to && input.from > input.to) {
      throw new AppError('Khoảng ngày không hợp lệ (từ > đến)');
    }
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (effectiveStaffId !== undefined) {
      conds.push(`a.user_id = ?`);
      vals.push(effectiveStaffId);
    }
    if (input.from) {
      conds.push(`a.work_date >= ?`);
      vals.push(input.from);
    }
    if (input.to) {
      conds.push(`a.work_date <= ?`);
      vals.push(input.to);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (d.prepare(`SELECT COUNT(*) AS c FROM attendance a ${where}`).get(...vals) as { c: number }).c;
    const rows = d
      .prepare(`SELECT ${ATTENDANCE_ROW_SELECT} ${where} ORDER BY a.work_date DESC, a.id DESC LIMIT ? OFFSET ?`)
      .all(...vals, limit, offset) as AttendanceRow[];
    return ok({ rows, total } satisfies AttendanceListOutput);
  });

  // ---- management area M1 (spec ./specs/management-area.md §M1.2 — BE-015) ----
  // reports:transactions — detail từng giao dịch thu phí (admin-only, read-only).
  // JOIN payments + sessions + passes + vehicles + zones + users; KHÔNG cột/bảng mới.
  // Aggregate tab dùng views §10 (frontend gọi 2 lần, không IPC compare riêng).
  register(db, 'reports:transactions', 'admin', (d, input) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
      throw new AppError('Khoảng ngày không hợp lệ (YYYY-MM-DD)');
    }
    if (input.from > input.to) throw new AppError('Ngày bắt đầu phải ≤ ngày kết thúc');
    if (input.kind !== undefined && !['casual', 'monthly', 'adjust'].includes(input.kind)) {
      throw new AppError('Loại vé không hợp lệ');
    }
    if (input.payment_method !== undefined && !['cash', 'transfer', 'card', 'e_wallet'].includes(input.payment_method)) {
      throw new AppError('Hình thức thanh toán không hợp lệ');
    }
    if (input.granularity !== undefined && !['day', 'week', 'month', 'year'].includes(input.granularity)) {
      throw new AppError('Granularity không hợp lệ (day/week/month/year)');
    }
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const offset = Math.max(0, input.offset ?? 0);
    const zoneIds = (input.zone_ids ?? []).filter((n) => Number.isInteger(n));
    const search = input.search?.trim().toUpperCase() || null;

    // kind: adjust = note điều chỉnh; monthly = vé tháng (trực tiếp hoặc qua session);
    // còn lại = vé lượt. (Note quầy hiện tại: 'Ve thang …' không dấu → không chạm LIKE dưới.)
    const kindExpr = `CASE WHEN p.note LIKE 'điều chỉnh%' THEN 'adjust' WHEN p.monthly_pass_id IS NOT NULL OR ps.monthly_pass_id IS NOT NULL THEN 'monthly' ELSE 'casual' END`;
    const conds: string[] = [`date(p.paid_at) >= date(?)`, `date(p.paid_at) <= date(?)`];
    const vals: unknown[] = [input.from, input.to];
    if (zoneIds.length > 0) {
      conds.push(`COALESCE(ps.zone_id, mp.zone_id) IN (${zoneIds.map(() => '?').join(',')})`);
      vals.push(...zoneIds);
    }
    if (input.kind) {
      conds.push(`${kindExpr} = ?`);
      vals.push(input.kind);
    }
    if (input.payment_method) {
      conds.push(`p.payment_method = ?`);
      vals.push(input.payment_method);
    }
    if (search) {
      const like = `%${search}%`;
      conds.push(
        `(COALESCE(ps.ticket_code, mp.pass_code, '') LIKE ? OR COALESCE(vs.license_plate, vm.license_plate, '') LIKE ?)`,
      );
      vals.push(like, like);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const fromSql = `FROM payments p
      LEFT JOIN parking_sessions ps ON ps.id = p.session_id
      LEFT JOIN monthly_passes mp ON mp.id = p.monthly_pass_id
      LEFT JOIN vehicles vs ON vs.id = ps.vehicle_id
      LEFT JOIN vehicles vm ON vm.id = mp.vehicle_id
      LEFT JOIN parking_zones zs ON zs.id = ps.zone_id
      LEFT JOIN parking_zones zm ON zm.id = mp.zone_id
      LEFT JOIN users u ON u.id = p.received_by`;
    const selectCols = `p.paid_at AS paid_at, p.id AS payment_id, ${kindExpr} AS kind,
      COALESCE(ps.ticket_code, mp.pass_code) AS ticket_code,
      COALESCE(vs.license_plate, vm.license_plate) AS license_plate,
      COALESCE(zs.code, zm.code) AS zone_code, COALESCE(zs.name, zm.name) AS zone_name,
      u.full_name AS received_by_name, u.username AS received_by_username,
      p.payment_method AS payment_method, p.amount AS amount, p.note AS note`;
    const total = (d.prepare(`SELECT COUNT(*) AS c ${fromSql} ${where}`).get(...vals) as { c: number }).c;
    const rows = d
      .prepare(`SELECT ${selectCols} ${fromSql} ${where} ORDER BY p.paid_at DESC, p.id DESC LIMIT ? OFFSET ?`)
      .all(...vals, limit, offset) as TxRow[];
    const agg = d
      .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(p.amount), 0) AS s ${fromSql} ${where}`)
      .get(...vals) as { c: number; s: number };
    const txCount = agg.c;
    const revenue = agg.s;
    return ok({
      rows,
      total,
      summary: { revenue, tx_count: txCount, avg: txCount > 0 ? Math.round(revenue / txCount) : 0 },
    } satisfies TxListOutput);
  });

  // ---- management area M2 (spec ./specs/management-area.md §M2.2 — BE-015) ----
  // app-config:get/set — JSON cạnh DB (KHÔNG bảng DB). Whitelist keys, validate
  // kiểu + cross-rule (ngưỡng ngày > tối thiểu); lỗi mang mã INVALID_PHONE |
  // LOGO_TOO_LARGE | INVALID_FEE_RULE trong message + errors field-level.
  register(db, 'app-config:get', 'admin', (d) => ok(loadParkingSettings(d)));
  register(db, 'app-config:set', 'admin', (d, input) => {
    try {
      return ok(saveParkingSettings(d, ((input.patch ?? {}) as ConfigPatch) ?? {}));
    } catch (e) {
      const errs = (e as { errors?: Record<string, string[]> }).errors;
      if (errs) throw new ValidationError(errs);
      if (e instanceof AppError) throw e;
      throw new AppError('Không lưu được cấu hình — vui lòng thử lại');
    }
  });

  // ---- management area M3 (spec ./specs/management-area.md §M3.2 — BE-015) ----
  // backup:now — checkpoint WAL + copy file DB. dest_path undefined → save-dialog
  // ở main (không nhận binary từ renderer). DB_BUSY → retry 2s × 3.
  register(db, 'backup:now', 'admin', async (d, input) => {
    checkpointWithRetry(d);
    const dbPath = dbFilePath(d);
    let dest = input.dest_path?.trim() || '';
    if (!dest) {
      if (!dialog || typeof dialog.showSaveDialog !== 'function') {
        throw new AppError('Không mở được hộp thoại lưu file — hãy truyền dest_path');
      }
      const r = await dialog.showSaveDialog({
        title: 'Sao lưu dữ liệu',
        defaultPath: `parking-${stampShort()}.db`,
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
      });
      if (r.canceled || !r.filePath) throw new AppError('Đã hủy sao lưu');
      dest = r.filePath;
    }
    try {
      fs.copyFileSync(dbPath, dest);
    } catch {
      throw new AppError('Không ghi được file sao lưu — kiểm tra dung lượng/quyền.');
    }
    let size = 0;
    try {
      size = fs.statSync(dest).size;
    } catch {
      size = 0;
    }
    return ok({ path: dest, size_bytes: size, backed_up_at: sqliteNow(d) });
  });

  // restore:from-file — dialog mở file ở MAIN (không nhận binary từ renderer);
  // validate header SQLite + integrity + FK + bảng bắt buộc + user_version;
  // chặn khi còn xe đang đỗ; auto-backup hiện tại (pre-restore-TIMESTAMP.db)
  // trước khi chép đè; xong yêu cầu restart (needRestart: true).
  register(db, 'restore:from-file', 'admin', async (d, input) => {
    let src = input.source_path?.trim() || '';
    if (!src) {
      if (!dialog || typeof dialog.showOpenDialog !== 'function') {
        throw new AppError('Không mở được hộp thoại chọn file — hãy truyền source_path');
      }
      const r = await dialog.showOpenDialog({
        title: 'Khôi phục dữ liệu',
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) throw new AppError('Đã hủy khôi phục');
      src = r.filePaths[0];
    }
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      throw new AppError('Không tìm thấy file nguồn');
    }
    const parked = (d.prepare(`SELECT COUNT(*) AS c FROM parking_sessions WHERE status = 'parked'`).get() as {
      c: number;
    }).c;
    if (parked > 0) {
      throw new AppError(`Còn ${parked} xe đang đỗ (HAS_PARKED_VEHICLES) — check-out hết trước khi khôi phục`);
    }
    const currentUv = d.pragma('user_version', { simple: true }) as number;
    try {
      validateRestoreFile(src, typeof currentUv === 'number' ? currentUv : 0);
    } catch (e) {
      // Giữ mã lỗi NOT_SQLITE | INTEGRITY_FAIL | SCHEMA_MISMATCH trong message
      // để frontend match (validateRestoreFile ném Error thường).
      throw new AppError(e instanceof Error ? e.message : 'File backup không hợp lệ');
    }
    checkpointWithRetry(d);
    const dbPath = dbFilePath(d);
    const backupPath = path.join(path.dirname(dbPath), `parking-pre-restore-${stampLong()}.db`);
    try {
      fs.copyFileSync(dbPath, backupPath);
    } catch {
      throw new AppError('Không sao lưu được DB hiện tại — dừng khôi phục để an toàn');
    }
    const restoredAt = sqliteNow(d);
    d.pragma('wal_checkpoint(TRUNCATE)');
    d.close();
    try {
      fs.copyFileSync(src, dbPath);
      for (const suffix of ['-wal', '-shm', '-journal']) {
        try {
          fs.unlinkSync(`${dbPath}${suffix}`);
        } catch {
          // ignore — file phụ có thể không tồn tại
        }
      }
    } catch {
      restartRequired = true;
      throw new AppError('Chép file thất bại — dùng bản pre-restore để cứu dữ liệu rồi khởi động lại app');
    }
    restartRequired = true;
    return ok({ backup_path: backupPath, restored_at: restoredAt, needRestart: true as const });
  });

  // ---- desktop notifications V1 (spec ./specs/notifications.md — BE-021) ----
  // Local scheduler E1–E4 (Windows Toast qua Electron Notification, KHÔNG FCM).
  // IPC mới duy nhất: dry-run quét thật + bắn Toast mẫu để QA click thử deep-link
  // (event `notify:deep-link` renderer tự đăng ký — preload KHÔNG đụng).
  register(db, 'notify:test', 'none', (d, input: NotifyTestInput) => {
    const me = getCurrentUser();
    if (!me) throw new AppError('Chưa đăng nhập');
    const sample = input?.sample;
    if (sample !== undefined && sample !== 'E1' && sample !== 'E2' && sample !== 'E3' && sample !== 'E4') {
      throw new AppError('Sự kiện mẫu không hợp lệ (E1/E2/E3/E4)');
    }
    return ok(runNotificationCatchup(d, { sample }));
  });
}

// Re-export for renderer-side typing convenience.
export type { IpcResult };
export { toUserDTO };
export type { VehicleType, PaymentMethod, PassStatus };
export type FeePreviewType = FeePreview;
export type CheckInInputType = CheckInInput;
