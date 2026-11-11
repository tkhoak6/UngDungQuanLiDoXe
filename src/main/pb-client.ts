// PocketBase online client — singleton + health check + auth ops + mapping
// đúng schema server thật (BE-017, nguồn: specs/pb-server-map.json).
// V1: AUTH TRƯỚC (login/register). Data sync (zones/spots/...) để P2 —
// file này đã có sẵn mapping enum + helper parking_lot để P2 dùng ngay.
// Local-first giữ nguyên: mọi lỗi mạng/server-từ chối ở đây đều được caller
// (auth.ts) fallback về SQLite; file này KHÔNG bao giờ để raw SDK error lọt ra IPC.
//
// Kỹ thuật: dùng bundle CJS (`pocketbase/cjs`, require trực tiếp) thay vì root
// ESM — Electron/Node 20 main-process (CommonJS) không require() được .mjs.
// Types vẫn lấy từ package root (type-only import, bị xóa lúc compile).
import type PocketBase from 'pocketbase';
import type { AppDb } from './db';
import { getPbBaseUrl, getPbParkingLot } from './app-config';
import type { PbStatus, PbTestResult } from '../shared/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PocketBaseCtor = require('pocketbase/cjs') as new (baseUrl: string) => PocketBase;

export const PB_AUTH_TIMEOUT_MS = 8000;
export const PB_HEALTH_TIMEOUT_MS = 6000;

/**
 * Lỗi user-safe từ PB (message tiếng Việt, hiện trực tiếp được).
 * Ngữ nghĩa: server đã trả lời RÕ RÀNG (khóa tài khoản/sai role/chưa cấu
 * hình/phiên hết hạn) → caller KHÔNG fallback local mà trả message này.
 * Mọi lỗi khác (mất mạng/timeout/sai pass/5xx) → Error thường → fallback local.
 */
export class PbNoFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PbNoFallbackError';
  }
}

/**
 * Record `users` PocketBase theo SCHEMA SERVER THẬT (pb-server-map.json).
 * Server dùng `name` (KHÔNG có `full_name`), `status` active/inactive
 * (KHÔNG có cột boolean `is_active`), role server
 * system_admin/parking_manager/staff/customer.
 * KHÔNG có: address, start_date, permissions, notes (local-only — xem auth.ts).
 */
export interface PbUserRecord {
  id: string;
  email: string;
  username?: string | null;
  name: string;
  phone?: string | null;
  avatar?: string | null;
  role: string;
  status?: string | null;
  /** Compat BE-016 (server cũ/giả định) — server thật không có cột này. */
  is_active?: boolean | null;
  organization?: string | null;
  assigned_lots?: string[] | null;
  employee_code?: string | null;
  position?: string | null;
  last_login_at?: string | null;
  customer?: string | null;
  created: string;
  updated: string;
}

/**
 * Role mapping 2 chiều (merge-plan §3.1/§5.3).
 * - Server → local: system_admin→admin, parking_manager→admin (app không có
 *   role này — đọc như admin theo rules server), staff→staff, customer→customer.
 * - Local → server: admin→system_admin, staff→staff, customer→customer
 *   (guest KHÔNG có row server → null).
 */
export type LocalMirrorRole = 'admin' | 'staff' | 'customer';

export function pbRoleToLocal(role: string): LocalMirrorRole | null {
  switch ((role ?? '').trim()) {
    case 'system_admin':
    case 'parking_manager': // app không có parking_manager — đọc như admin
      return 'admin';
    case 'staff':
      return 'staff';
    case 'customer':
      return 'customer';
    default:
      return null;
  }
}

export function localRoleToPb(role: string): 'system_admin' | 'staff' | 'customer' | null {
  switch ((role ?? '').trim()) {
    case 'admin':
      return 'system_admin';
    case 'staff':
      return 'staff';
    case 'customer':
      return 'customer';
    default:
      return null; // guest → không có row server
  }
}

// ---- Enum mapping local ↔ server (merge-plan §3 — P2 data-sync dùng) ----
// Local giữ nguyên (SQLite + UI không đổi); map khi ghi/đọc PB.

/** sessions.status: local 'parked' ↔ server 'parking'. */
export function localSessionStatusToPb(s: string): string {
  return s === 'parked' ? 'parking' : s;
}
export function pbSessionStatusToLocal(s: string): string {
  return s === 'parking' ? 'parked' : s;
}

/** parking_spots.status: local 'available' ↔ server 'empty'. */
export function localSpotStatusToPb(s: string): string {
  return s === 'available' ? 'empty' : s;
}
export function pbSpotStatusToLocal(s: string): string {
  return s === 'empty' ? 'available' : s;
}

/** reservations.status: local → server (merge-plan §3.8). */
const RESERVATION_TO_PB: Record<string, string> = {
  pending: 'pending',
  active: 'confirmed',
  completed: 'checked_in',
  cancelled: 'cancelled',
  expired: 'no_show',
};
const RESERVATION_FROM_PB: Record<string, string> = {
  pending: 'pending',
  confirmed: 'active',
  checked_in: 'completed',
  cancelled: 'cancelled',
  no_show: 'expired',
};
export function localReservationStatusToPb(s: string): string {
  return RESERVATION_TO_PB[s] ?? s;
}
export function pbReservationStatusToLocal(s: string): string {
  return RESERVATION_FROM_PB[s] ?? s;
}

/** payments.method: local → server (merge-plan §3.7: card không có → bank_transfer + ghi "card" vào note). */
export function localPaymentMethodToPb(m: string): { method: string; noteSuffix: string | null } {
  switch (m) {
    case 'cash':
      return { method: 'cash', noteSuffix: null };
    case 'transfer':
      return { method: 'bank_transfer', noteSuffix: null };
    case 'card':
      return { method: 'bank_transfer', noteSuffix: 'card' };
    case 'e_wallet':
      return { method: 'momo', noteSuffix: null };
    default:
      return { method: m, noteSuffix: null };
  }
}

/** Tên collection server (merge-plan §5.1: spots→parking_spots, sessions→parking_sessions, passes→monthly_passes). */
export const PB_COLLECTIONS = {
  users: 'users',
  zones: 'zones',
  spots: 'parking_spots',
  sessions: 'parking_sessions',
  vehicles: 'vehicles',
  customers: 'customers',
  passes: 'monthly_passes',
  payments: 'payments',
  reservations: 'reservations',
  shifts: 'shifts',
  attendance: 'attendance',
} as const;

let cached: { baseUrl: string; pb: PocketBase } | null = null;

function clientFor(baseUrl: string): PocketBase {
  if (!cached || cached.baseUrl !== baseUrl) {
    if (cached) {
      try {
        cached.pb.authStore.clear();
      } catch {
        // ignore — client cũ bỏ đi, auth cũ không dùng lại
      }
    }
    const pb = new PocketBaseCtor(baseUrl);
    pb.autoCancellation(false);
    cached = { baseUrl, pb };
  }
  return cached.pb;
}

/**
 * Singleton client theo URL trong app-config.
 * Trả null khi admin đặt local-only (pb_url = null) → caller vào local ngay.
 */
export function getPbClient(db: AppDb): PocketBase | null {
  const baseUrl = getPbBaseUrl(db);
  if (!baseUrl) return null;
  return clientFor(baseUrl);
}

/** Xóa token online đang giữ (gọi khi logout — best-effort, không throw). */
export function pbClearAuth(): void {
  try {
    cached?.pb.authStore.clear();
  } catch {
    // ignore
  }
}

/** `status` số từ SDK khi server đã phản hồi; null = mất mạng/timeout/abort. */
function pbStatusOf(e: unknown): number | null {
  const s = (e as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' ? s : null;
}

function withAbort<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fn(ctrl.signal).finally(() => clearTimeout(t));
}

async function pingHealth(baseUrl: string, timeoutMs: number): Promise<{ reachable: boolean; latencyMs: number | null }> {
  const t0 = Date.now();
  try {
    const res = await withAbort(
      (signal) => fetch(`${baseUrl}/api/health`, { signal }),
      timeoutMs,
    );
    if (!res.ok) return { reachable: false, latencyMs: null };
    return { reachable: true, latencyMs: Date.now() - t0 };
  } catch {
    return { reachable: false, latencyMs: null };
  }
}

/**
 * Trạng thái online cho IPC `pb:status` (không throw — mất mạng = offline).
 * `mode` luôn 'local-first' ở V1 (giữ chế độ local mặc định theo out-of-scope).
 * Kèm `parking_lot` đang dùng (merge-plan §4); null = chưa cấu hình = local-only.
 */
export async function pbGetStatus(db: AppDb): Promise<PbStatus> {
  const parkingLot = getPbParkingLot(db);
  const baseUrl = getPbBaseUrl(db);
  if (!baseUrl) return { online: false, mode: 'local-first', pb_url: '', latency_ms: null, parking_lot: parkingLot };
  const h = await pingHealth(baseUrl, PB_HEALTH_TIMEOUT_MS);
  return { online: h.reachable, mode: 'local-first', pb_url: baseUrl, latency_ms: h.latencyMs, parking_lot: parkingLot };
}

/**
 * Test kết nối cho IPC `pb:test` (admin).
 * `urlOverride` chỉ test tạm, không lưu (lưu URL qua app-config:set {pb_url}).
 */
export async function pbTestConnection(db: AppDb, urlOverride?: string): Promise<PbTestResult> {
  const target = (urlOverride ?? '').trim().replace(/\/+$/, '') || getPbBaseUrl(db) || '';
  if (!target) {
    throw new PbNoFallbackError('Chưa cấu hình địa chỉ máy chủ online — vào Cấu hình (M2) để nhập.');
  }
  if (!/^https?:\/\/.+\..+/.test(target)) {
    throw new PbNoFallbackError('Địa chỉ máy chủ online không hợp lệ (phải bắt đầu bằng http(s)://)');
  }
  const h = await pingHealth(target, PB_HEALTH_TIMEOUT_MS);
  return { reachable: h.reachable, pb_url: target, latency_ms: h.latencyMs };
}

/**
 * ID bãi server bắt buộc cho mọi create/filter PB (merge-plan §4).
 * Thiếu → PbNoFallbackError VI (caller hiện message, KHÔNG fallback lặng).
 */
export function requirePbParkingLot(db: AppDb): string {
  const lot = getPbParkingLot(db);
  if (!lot) {
    throw new PbNoFallbackError(
      'Chưa cấu hình bãi xe (mã parking_lot) — vào Cấu hình nhập ID bãi do system_admin cấp để đồng bộ online.',
    );
  }
  return lot;
}

/**
 * Chuỗi filter SDK kèm parking_lot cho P2 list (tránh thấy dữ liệu bãi khác).
 * VD: `parking_lot = "pbc_abc..."`. Escape `"` phòng ID lạ.
 */
export function pbLotFilter(db: AppDb): string {
  const lot = requirePbParkingLot(db);
  return `parking_lot = "${lot.replace(/"/g, '\\"')}"`;
}

/**
 * Login PB — server cho phép identity `username` HOẶC `email`
 * (identityFields đã có cả 2 sau thao tác tay §2A; customer login username = SĐT).
 * - Thành công → record (caller kiểm tra khóa/role rồi mirror local).
 * - Sai pass/mất mạng/timeout/server 5xx → Error thường → caller FALLBACK local.
 * - KHÔNG lộ raw SDK error (message nội bộ, không trả ra IPC).
 */
export async function pbLogin(db: AppDb, username: string, password: string): Promise<PbUserRecord> {
  const pb = getPbClient(db);
  if (!pb) throw new Error('PB_DISABLED');
  try {
    const auth = await withAbort(
      (signal) => pb.collection(PB_COLLECTIONS.users).authWithPassword(username, password, { signal }),
      PB_AUTH_TIMEOUT_MS,
    );
    const rec = auth.record as unknown as PbUserRecord | null | undefined;
    if (!rec || typeof rec !== 'object' || !(rec.username || rec.email)) {
      throw new PbNoFallbackError('Máy chủ online trả về dữ liệu lạ — vui lòng thử lại');
    }
    // Server thật dùng `status` active/inactive (giữ compat `is_active` BE-016).
    const locked = rec.status ? rec.status !== 'active' : rec.is_active === false;
    if (locked) {
      throw new PbNoFallbackError('Tài khoản bị khóa — liên hệ Admin.');
    }
    const role = (rec.role ?? '').trim();
    if (role === 'guest') {
      throw new PbNoFallbackError('Vai trò Khách không cần đăng nhập');
    }
    if (!pbRoleToLocal(role)) {
      throw new PbNoFallbackError('Tài khoản online chưa được phân quyền — liên hệ Admin.');
    }
    return rec;
  } catch (e) {
    if (e instanceof PbNoFallbackError) throw e;
    // 400/401/403/404 (sai pass/chưa import user) + mất mạng/timeout/5xx
    // → caller fallback local (giữ local-first, xem auth.ts). Không lộ raw.
    throw new Error(`PB_AUTH_FALLBACK:${pbStatusOf(e) ?? 'offline'}`);
  }
}

/**
 * Tạo user customer trên PB.
 * Payload đúng schema server: `name` (KHÔNG phải `full_name`), `email`
 * bắt buộc (dùng placeholder `SĐT@lot.local` khi không có email thật —
 * merge-plan §2A), `status: 'active'`.
 * LƯU Ý server `users.createRule = role=system_admin` (pb-server-map.json):
 * signup ẩn danh sẽ 403 cho tới khi server nới rule — caller best-effort
 * (thất bại → giữ local, đánh dấu chưa đồng bộ, offline vẫn dùng được).
 * Thất bại (mất mạng/trùng SĐT online) → Error thường → caller giữ local.
 */
export function pbCustomerEmailPlaceholder(phone: string): string {
  return `${phone}@lot.local`;
}

export async function pbRegisterCustomer(
  db: AppDb,
  input: { phone: string; password: string; full_name: string },
): Promise<void> {
  const pb = getPbClient(db);
  if (!pb) throw new Error('PB_DISABLED');
  try {
    await withAbort(
      (signal) =>
        pb.collection(PB_COLLECTIONS.users).create(
          {
            username: input.phone,
            email: pbCustomerEmailPlaceholder(input.phone),
            password: input.password,
            passwordConfirm: input.password,
            name: input.full_name,
            phone: input.phone,
            role: 'customer',
            status: 'active',
          },
          { signal },
        ),
      PB_AUTH_TIMEOUT_MS,
    );
  } catch {
    throw new Error('PB_REGISTER_FALLBACK');
  }
}

/**
 * Auto-refresh token online (dùng cho P2 data-sync; V1 chưa có IPC gọi).
 * - Token còn hạn → gọi `authRefresh`, trả client đã refresh.
 * - 401/hết hạn → clear + PbNoFallbackError (buộc đăng nhập lại).
 * - Mất mạng → Error thường (caller tự quyết retry/offline).
 */
export async function pbEnsureAuth(db: AppDb): Promise<PocketBase> {
  const pb = getPbClient(db);
  if (!pb) throw new PbNoFallbackError('Chưa cấu hình máy chủ online.');
  if (!pb.authStore.isValid) {
    throw new PbNoFallbackError('Phiên online hết hạn — vui lòng đăng nhập lại');
  }
  try {
    await withAbort((signal) => pb.collection(PB_COLLECTIONS.users).authRefresh({ signal }), PB_HEALTH_TIMEOUT_MS);
    return pb;
  } catch (e) {
    const st = pbStatusOf(e);
    if (st === 401) {
      try {
        pb.authStore.clear();
      } catch {
        // ignore
      }
      throw new PbNoFallbackError('Phiên online hết hạn — vui lòng đăng nhập lại');
    }
    throw new Error(`PB_REFRESH_FALLBACK:${st ?? 'offline'}`);
  }
}
