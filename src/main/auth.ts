// Auth: bcrypt login, in-memory session (single-operator desktop app),
// role guards matching api-contract.md §11 permission matrix.
import bcrypt from 'bcryptjs';
import type { AppDb } from './db';
import type { RoleName, StaffPermissionKey, StaffPermissions, UserDTO } from '../shared/types';
import { STAFF_DEFAULTS } from '../shared/types';

export type ActorRole = 'admin' | 'staff';

let currentUser: UserDTO | null = null;

export function getCurrentUser(): UserDTO | null {
  return currentUser;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  address: string | null; // v005 S1: session cache để users:profile dùng ngay (notes KHÔNG vào session)
  start_date: string | null; // v005 S1: như trên
  permissions: string | null; // v007 S4: raw JSON 5 flags (resolve lúc toUserDTO)
  role_id: number;
  role_name: RoleName;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

const USER_COLUMNS = `u.id, u.username, u.full_name, u.phone, u.address, u.start_date, u.permissions, u.role_id, r.name AS role_name,
        u.is_active, u.created_at, u.updated_at`;

export function toUserDTO(r: UserRow): UserDTO {
  return {
    id: r.id,
    username: r.username,
    full_name: r.full_name,
    phone: r.phone,
    address: r.address,
    start_date: r.start_date,
    // notes: KHÔNG map vào session DTO — admin-only, chỉ đọc qua users:list/update (S1.4)
    permissions: r.permissions ?? null,
    perms: resolvePerms(r.role_name, r.permissions ?? null),
    role_id: r.role_id,
    role_name: r.role_name,
    is_active: r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * S4 phân quyền chi tiết (staff-area.md S4.1 + api-contract.md §3/§11).
 * - Canonical 5 keys, giá trị 0|1. Parse CHẤP NHẬN boolean true/false
 *   (normalize về 0|1); partial JSON thiếu key = default 1; key lạ → bỏ qua.
 * - DB NULL (staff cũ) = full; JSON hỏng = full + không throw (fallback an toàn).
 * - role 'admin' luôn full (bỏ qua cột).
 */
const PERM_KEYS: StaffPermissionKey[] = ['checkin', 'pass_sale', 'report_self', 'profile_self', 'reservation'];

const PERM_LABELS: Record<StaffPermissionKey, string> = {
  checkin: 'check-in/check-out và thu phí',
  pass_sale: 'bán/gia hạn vé tháng',
  report_self: 'xem báo cáo và hiệu suất ca mình',
  profile_self: 'tự sửa SĐT/địa chỉ của mình',
  reservation: 'xác nhận/hủy đặt chỗ',
};

function normalizePermValue(v: unknown): 0 | 1 | null {
  if (v === 1 || v === true || v === '1') return 1;
  if (v === 0 || v === false || v === '0') return 0;
  return null;
}

function parsePermsRaw(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const o: unknown = JSON.parse(raw);
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
    return o as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Resolve full map 5 flags (login/me/users:list — frontend ẩn menu theo `perms`). */
export function resolvePerms(roleName: RoleName | string, raw: string | null | undefined): StaffPermissions {
  if (roleName === 'admin') return { ...STAFF_DEFAULTS };
  const o = parsePermsRaw(raw);
  const one = (k: StaffPermissionKey): 0 | 1 => {
    if (!o) return 1;
    return normalizePermValue(o[k]) ?? 1;
  };
  return {
    checkin: one('checkin'),
    pass_sale: one('pass_sale'),
    report_self: one('report_self'),
    profile_self: one('profile_self'),
    reservation: one('reservation'),
  };
}

/** Contract S4.3: resolvePerm(user, key) = admin ? 1 : (parse(user.permissions)?.[key] ?? 1). */
export function resolvePerm(
  user: { role_name: RoleName | string; permissions: string | null | undefined },
  key: StaffPermissionKey,
): 0 | 1 {
  return resolvePerms(user.role_name, user.permissions ?? null)[key];
}

/**
 * Guard flag S4 cho IPC staff (tương thích ngược 3 lớp — staff-area.md S4.1):
 * admin → pass luôn; staff → check flag, thiếu → FORBIDDEN Việt
 * `... (NO_PERMISSION:<key>)` để frontend map sang toast (S4.3).
 * Đọc fresh từ DB (không dùng session cache) để flag admin vừa gán
 * áp dụng ngay ở thao tác tiếp theo (S4.2).
 */
export function requirePerm(db: AppDb, key: StaffPermissionKey): UserDTO {
  const u = getCurrentUser();
  if (!u) throw new AppError('Chưa đăng nhập');
  if (u.role_name === 'admin') return u;
  if (u.role_name !== 'staff' && u.role_name !== 'customer') {
    throw new AppError('Không có quyền thực hiện thao tác này');
  }
  const row = db
    .prepare(`SELECT r.name AS role_name, u.permissions AS permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`)
    .get(u.id) as { role_name: RoleName; permissions: string | null } | undefined;
  const role = row?.role_name ?? u.role_name;
  if (role === 'admin') return u;
  if (role !== 'staff') throw new AppError('Không có quyền thực hiện thao tác này');
  if (resolvePerms(role, row?.permissions ?? null)[key] !== 1) {
    throw new AppError(`Tài khoản của bạn không có quyền ${PERM_LABELS[key]} — liên hệ quản lý (NO_PERMISSION:${key})`);
  }
  return u;
}

export function findUserByUsername(db: AppDb, username: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.phone, u.address, u.start_date, u.permissions, u.role_id, r.name AS role_name,
              u.is_active, u.created_at, u.updated_at
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.username = ?`,
    )
    .get(username) as UserRow | undefined;
}

export function login(db: AppDb, username: string, password: string): UserDTO {
  const clean = (username ?? '').trim();
  if (!clean || !password) throw new AppError('Tên đăng nhập và mật khẩu là bắt buộc');
  const row = findUserByUsername(db, clean);
  // Dummy compare to keep timing uniform when user does not exist.
  const hash = row?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalid12';
  const okPw = bcrypt.compareSync(password, hash);
  if (!row || !okPw) throw new AppError('Sai tài khoản hoặc mật khẩu');
  if (row.is_active !== 1) throw new AppError('Tài khoản bị khóa — liên hệ Admin.');
  if (row.role_name === 'guest') throw new AppError('Vai trò Khách không cần đăng nhập');
  currentUser = toUserDTO(row);
  return currentUser;
}

export function logout(): void {
  currentUser = null;
}

/** User-facing error (safe to show in UI). Anything else is treated as internal. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Guard by permission matrix (api-contract.md §11):
 *  - 'admin': admin only (zone config, users, revenue reports)
 *  - 'staff': admin OR staff (check-in/out, passes, guest views need no login)
 */
export function requireRole(which: ActorRole): UserDTO {
  const u = getCurrentUser();
  if (!u) throw new AppError('Chưa đăng nhập');
  if (which === 'admin' && u.role_name !== 'admin') throw new AppError('Chỉ Admin được thực hiện thao tác này');
  if (which === 'staff' && u.role_name !== 'admin' && u.role_name !== 'staff') {
    throw new AppError('Không có quyền thực hiện thao tác này');
  }
  return u;
}

/**
 * Customer guard (spec ./specs/customer-area.md §P2.2 — mine-only server-side).
 * Kênh customer:* chỉ dành cho role 'customer'; admin/staff dùng kênh nghiệp vụ
 * riêng (vehicles:find, sessions:history). Không nhận phone từ client.
 */
export function requireCustomer(): UserDTO {
  const u = getCurrentUser();
  if (!u) throw new AppError('Chưa đăng nhập');
  if (u.role_name !== 'customer') throw new AppError('Kênh này chỉ dành cho khách hàng');
  return u;
}

/** Refresh in-memory session sau khi user tự đổi hồ sơ (P1: users:update self). */export function refreshCurrentUser(db: AppDb, id: number): UserDTO | null {
  const row = db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    )
    .get(id) as UserRow | undefined;
  if (!row) return null;
  const dto = toUserDTO(row);
  if (currentUser && currentUser.id === id) currentUser = dto;
  return dto;
}

export function hashPassword(plain: string): string {
  if (!plain || plain.length < 6) throw new AppError('Mật khẩu phải từ 6 ký tự');
  return bcrypt.hashSync(plain, 10);
}

/**
 * Customer self-registration (api-contract.md §12, migration-002).
 * Public channel — KHÔNG cho client chọn role (server fix 'customer'),
 * username = phone = SĐT. KHÔNG auto-login (frontend gọi auth:login sau).
 * Chống spam tối thiểu: trim + validate SĐT + UNIQUE DB + message chung
 * (không lộ SĐT nào đã tồn tại ngoài việc báo trùng để user đăng nhập).
 * Chưa có rate-limit IPC (app desktop single-operator; xem backend-summary.md).
 */
export function registerCustomer(
  db: AppDb,
  input: { phone: string; password: string; full_name: string },
): UserDTO {
  const phone = (input.phone ?? '').trim();
  const fullName = (input.full_name ?? '').trim();
  if (!/^0\d{9}$/.test(phone)) {
    throw new AppError('Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0)');
  }
  if (!fullName) throw new AppError('Họ tên là bắt buộc');
  // hashPassword tự validate >= 6 ký tự.
  const hash = hashPassword(input.password ?? '');

  const role = db.prepare(`SELECT id FROM roles WHERE name = 'customer'`).get() as { id: number } | undefined;
  if (!role) throw new AppError('Chưa có vai trò Khách — vui lòng mở lại app để chạy migration');

  const tx = db.transaction(() => {
    try {
      const r = db
        .prepare(
          `INSERT INTO users (username, password_hash, full_name, phone, role_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(phone, hash, fullName, phone, role.id);
      const row = db
        .prepare(
          `SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        )
        .get(r.lastInsertRowid) as UserRow | undefined;
      if (!row) throw new AppError('Đăng ký thất bại — vui lòng thử lại');
      return toUserDTO(row);
    } catch (e) {
      if (e instanceof AppError) throw e;
      // username và phone đều UNIQUE → message chung, không lộ cột nào trùng.
      throw new AppError('Số điện thoại này đã được đăng ký — vui lòng đăng nhập');
    }
  });
  return tx();
}
