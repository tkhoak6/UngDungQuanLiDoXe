// PocketBase online client — singleton + health check + auth ops (BE-016).
// Scope V1: AUTH TRƯỚC (login/register). Data sync (zones/spots/...) để P2.
// Local-first giữ nguyên: mọi lỗi mạng/server-từ chối ở đây đều được caller
// (auth.ts) fallback về SQLite; file này KHÔNG bao giờ để raw SDK error lọt ra IPC.
//
// Kỹ thuật: dùng bundle CJS (`pocketbase/cjs`, require trực tiếp) thay vì root
// ESM — Electron/Node 20 main-process (CommonJS) không require() được .mjs.
// Types vẫn lấy từ package root (type-only import, bị xóa lúc compile).
import type PocketBase from 'pocketbase';
import type { AppDb } from './db';
import { getPbBaseUrl } from './app-config';
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

/** Record `users` PocketBase (subset dùng ở V1 — xem specs/pocketbase-collections.json). */
export interface PbUserRecord {
  id: string;
  username: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  start_date: string | null;
  role: string;
  is_active: boolean;
  permissions: unknown;
  created: string;
  updated: string;
}

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
 */
export async function pbGetStatus(db: AppDb): Promise<PbStatus> {
  const baseUrl = getPbBaseUrl(db);
  if (!baseUrl) return { online: false, mode: 'local-first', pb_url: '', latency_ms: null };
  const h = await pingHealth(baseUrl, PB_HEALTH_TIMEOUT_MS);
  return { online: h.reachable, mode: 'local-first', pb_url: baseUrl, latency_ms: h.latencyMs };
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
 * Login PB bằng username (staff username / SĐT customer — PB `allowUsernameAuth`).
 * - Thành công → record (caller kiểm tra khóa/role rồi mirror local).
 * - Sai pass/mất mạng/timeout/server 5xx → Error thường → caller FALLBACK local.
 * - KHÔNG lộ raw SDK error (message nội bộ, không trả ra IPC).
 */
export async function pbLogin(db: AppDb, username: string, password: string): Promise<PbUserRecord> {
  const pb = getPbClient(db);
  if (!pb) throw new Error('PB_DISABLED');
  try {
    const auth = await withAbort(
      (signal) => pb.collection('users').authWithPassword(username, password, { signal }),
      PB_AUTH_TIMEOUT_MS,
    );
    const rec = auth.record as unknown as PbUserRecord | null | undefined;
    if (!rec || typeof rec !== 'object' || !rec.username) {
      throw new PbNoFallbackError('Máy chủ online trả về dữ liệu lạ — vui lòng thử lại');
    }
    if (rec.is_active === false) {
      throw new PbNoFallbackError('Tài khoản bị khóa — liên hệ Admin.');
    }
    const role = (rec.role ?? '').trim();
    if (!role || role === 'guest') {
      throw new PbNoFallbackError('Vai trò Khách không cần đăng nhập');
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
 * Tạo user customer trên PB (role server-fix 'customer' — client LUÔN gửi
 * đúng role này; chống nâng quyền thật sự phải chờ hook P2 `pb_hooks`,
 * xem backend-summary BE-016 §rủi ro).
 * Thất bại (mất mạng/trùng SĐT online) → Error thường → caller giữ local,
 * đánh dấu chưa đồng bộ (offline vẫn dùng được).
 */
export async function pbRegisterCustomer(
  db: AppDb,
  input: { phone: string; password: string; full_name: string },
): Promise<void> {
  const pb = getPbClient(db);
  if (!pb) throw new Error('PB_DISABLED');
  try {
    await withAbort(
      (signal) =>
        pb.collection('users').create(
          {
            username: input.phone,
            password: input.password,
            passwordConfirm: input.password,
            full_name: input.full_name,
            phone: input.phone,
            role: 'customer',
            is_active: true,
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
    await withAbort((signal) => pb.collection('users').authRefresh({ signal }), PB_HEALTH_TIMEOUT_MS);
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
