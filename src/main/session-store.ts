// Remember-me sessions (BE-023): opaque token bền vững qua restart app.
//
// QUYẾT ĐỊNH LƯU TRỮ: file JSON `sessions.json` cạnh DB (cùng thư mục
// parking.db, pattern atomic tmp+rename như app-config) — KHÔNG thêm bảng,
// KHÔNG migration, KHÔNG đụng schema.sql. Lý do: desktop single-operator,
// token chỉ cần lookup theo hash + expiry (không cần JOIN/query phức tạp),
// revoke = xóa dòng file; mobile dùng sau qua đúng contract này
// (`auth:login {remember}` → token, `auth:resume {token}` → xoay vòng).
//
// BẢO MẬT:
// - Token raw (32 bytes CSPRNG, base64url) chỉ trả về client ĐÚNG 1 lần
//   (lúc issue/rotate). File chỉ lưu SHA-256 hex — lộ file cũng không
//   suy ra token đang hiệu lực.
// - KHÔNG bao giờ lưu/trả password ở đây (module này không biết password).
// - So sánh hash bằng timingSafeEqual (2 hex cùng độ dài).
// - File ghi mode 0o600 (best-effort, Windows bỏ qua).
// - Brute-force: state in-memory — sai 5 lần → khóa `auth:resume` 60s +
//   delay 300ms mỗi lần sai + message chung (không phân biệt sai/hết hạn
//   để tránh oracle).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppDb } from './db';

export const SESSIONS_FILE_NAME = 'sessions.json';
/** Hạn remember-me: 30 ngày (đúng hợp đồng BE-023). */
export const REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000;
/** Trần token/user (chống phình file khi login remember nhiều lần). */
const MAX_SESSIONS_PER_USER = 5;

/** Brute-force guard cho `auth:resume` (in-memory, reset khi restart app). */
export const RESUME_MAX_FAILS = 5;
export const RESUME_BLOCK_MS = 60_000;
export const RESUME_FAIL_DELAY_MS = 300;
let resumeFailCount = 0;
let resumeBlockedUntilMs = 0;

export interface RememberSessionRecord {
  token_hash: string;
  user_id: number;
  created_at_ms: number;
  expires_at_ms: number;
}

/** File sessions nằm cùng thư mục DB (dev: ./data, packaged: userData). */
export function sessionsPathForDb(db: AppDb): string {
  const name = (db as unknown as { name?: unknown }).name;
  const dir =
    typeof name === 'string' && name !== ':memory:' ? path.dirname(name) : process.cwd();
  return path.join(dir, SESSIONS_FILE_NAME);
}

export function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function isValidRow(r: unknown): r is RememberSessionRecord {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.token_hash === 'string' &&
    /^[0-9a-f]{64}$/.test(o.token_hash) &&
    Number.isInteger(o.user_id) &&
    Number.isInteger(o.created_at_ms) &&
    Number.isInteger(o.expires_at_ms)
  );
}

export function loadRememberSessions(db: AppDb): RememberSessionRecord[] {
  const p = sessionsPathForDb(db);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRow);
  } catch {
    // File hỏng (sửa tay/crash giữa write): quarantine để giữ chứng cứ,
    // coi như không còn session nào (user login lại).
    try {
      fs.renameSync(p, `${p}.corrupt-${Date.now()}`);
    } catch {
      // ignore
    }
    return [];
  }
}

export function saveRememberSessions(db: AppDb, rows: RememberSessionRecord[]): void {
  const p = sessionsPathForDb(db);
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(rows), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, p);
}

function pruneExpired(rows: RememberSessionRecord[], nowMs: number): RememberSessionRecord[] {
  return rows.filter((r) => r.expires_at_ms > nowMs);
}

/**
 * Cấp token remember-me mới cho user (login `remember: true` hoặc xoay vòng
 * ở resume). Trả raw token 1 lần duy nhất — caller phải gửi cho client ngay.
 */
export function issueRememberToken(
  db: AppDb,
  userId: number,
  nowMs: number = Date.now(),
): { token: string; expires_at_ms: number } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires_at_ms = nowMs + REMEMBER_TTL_MS;
  let rows = pruneExpired(loadRememberSessions(db), nowMs);
  // Trần/user: giữ mới nhất, drop cũ nhất vượt trần.
  const others = rows.filter((r) => r.user_id !== userId);
  const mine = rows.filter((r) => r.user_id === userId).slice(-(MAX_SESSIONS_PER_USER - 1));
  rows = [
    ...others,
    ...mine,
    { token_hash: sha256Hex(token), user_id: userId, created_at_ms: nowMs, expires_at_ms },
  ];
  saveRememberSessions(db, rows);
  return { token, expires_at_ms };
}

/**
 * Đổi token lấy user_id (single-use: đúng + còn hạn → XÓA ngay để caller
 * issue token mới = xoay vòng; sai/hết hạn → giữ nguyên file).
 * Không phân biệt lý do fail (chống oracle) — caller fail message chung.
 */
export function consumeRememberToken(
  db: AppDb,
  token: string,
  nowMs: number = Date.now(),
): { ok: true; user_id: number } | { ok: false } {
  const rows = loadRememberSessions(db);
  const want = sha256Hex(token);
  let matched: RememberSessionRecord | undefined;
  for (const r of rows) {
    // 2 hex 64 ký tự → timingSafeEqual an toàn (không throw lệch length).
    const a = Buffer.from(r.token_hash, 'utf8');
    const b = Buffer.from(want, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      matched = r;
      break;
    }
  }
  if (!matched || matched.expires_at_ms <= nowMs) {
    // Hết hạn → dọn luôn dòng đó (không báo khác sai token).
    if (matched) {
      saveRememberSessions(
        db,
        rows.filter((r) => r.token_hash !== matched?.token_hash),
      );
    }
    return { ok: false };
  }
  saveRememberSessions(
    db,
    rows.filter((r) => r.token_hash !== matched?.token_hash),
  );
  return { ok: true, user_id: matched.user_id };
}

/** Thu hồi 1 token (logout có token). Không throw khi file mất. */
export function revokeRememberToken(db: AppDb, token: string): boolean {
  const want = sha256Hex(token);
  const rows = loadRememberSessions(db);
  if (!rows.some((r) => r.token_hash === want)) return false;
  try {
    saveRememberSessions(
      db,
      rows.filter((r) => r.token_hash !== want),
    );
  } catch {
    return false;
  }
  return true;
}

// ---- brute-force guard (in-memory) ----

export function isResumeBlocked(nowMs: number = Date.now()): boolean {
  return nowMs < resumeBlockedUntilMs;
}

export function noteResumeFailure(nowMs: number = Date.now()): void {
  resumeFailCount += 1;
  if (resumeFailCount >= RESUME_MAX_FAILS) {
    resumeBlockedUntilMs = nowMs + RESUME_BLOCK_MS;
  }
}

export function resetResumeFailures(): void {
  resumeFailCount = 0;
  resumeBlockedUntilMs = 0;
}

/** Chỉ dùng cho test (reset state in-memory giữa các case). */
export function resetResumeGuardForTest(): void {
  resetResumeFailures();
}
