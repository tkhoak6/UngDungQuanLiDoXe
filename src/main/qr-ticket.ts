// Vé QR ký HMAC-SHA256 (spec ./specs/qr-anpr.md §1.2 — BE-018 V1a).
// Format chốt (dot-separated, QR alphanumeric-friendly):
//   P1.<ticket_code>.<PLATE_NORM>.<IN_TS>.<SIG>
// Trong đó:
// - P1: version payload (=1). Máy đọc version lạ → từ chối "cập nhật app".
// - ticket_code: nguyên văn `T-YYYYMMDD-XXXX`.
// - PLATE_NORM: biển số chuẩn hóa UPPERCASE, bỏ mọi ký tự ngoài [A-Z0-9]
//   (superset của "bỏ -/./space" trong spec — cùng kết quả với biển VN).
// - IN_TS: check_in_at dạng epoch phút (số phút từ epoch UTC, int).
// - SIG: base64url(HMAC-SHA256(key, "P1.<ticket>.<plate>.<ts>")) — 43 ký tự, không padding.
// Thuật toán: HMAC-SHA256 duy nhất (không MD5/SHA1). So sánh chữ ký bằng
// constant-time compare (crypto.timingSafeEqual).
// Chống dùng lại KHÔNG nằm ở chữ ký: backend đối soát `status='parked'` ở DB
// (vé completed quét lại → từ chối "đã sử dụng"). Chữ ký chỉ chống giả/sửa.
import crypto from 'node:crypto';
import type { AppDb } from './db';
import { loadParkingSettings, saveParkingSettings } from './app-config';
import type { QrVerifyReason } from '../shared/types';

export const QR_PAYLOAD_VERSION = 'P1';
export const QR_KEY_ID = 1; // V1: 1 key duy nhất (rotation sang P2 để P2 — spec §1.2)
const MAX_QR_LEN = 512; // chặn input quá khổ trước khi split/regex (QR thật < 220 ký tự)

/** Chuẩn hóa biển số cho payload QR: UPPERCASE + chỉ giữ [A-Z0-9]. */
export function normalizePlateForQr(plate: string): string {
  return (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** `YYYY-MM-DD HH:MM:SS` (UTC, DB) → epoch phút (int). */
export function checkInToEpochMin(checkInAt: string): number {
  const ms = new Date(`${checkInAt.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(ms)) throw new Error('Giờ vào vé không hợp lệ');
  return Math.floor(ms / 60000);
}

/** epoch phút → `YYYY-MM-DD HH:MM:SS` UTC (đảo ngược để đối soát, nếu cần). */
export function epochMinToCheckIn(ts: number): string {
  return new Date(ts * 60000).toISOString().slice(0, 19).replace('T', ' ');
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecode(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  return Buffer.from(b64 + '='.repeat(pad), 'base64');
}

function isValidKeyB64(s: string): boolean {
  try {
    return b64urlDecode(s).length === 32 || Buffer.from(s, 'base64').length === 32;
  } catch {
    return false;
  }
}

function keyToBytes(keyB64: string): Buffer {
  // Lưu chuẩn base64 thường; chấp nhận cả base64url (tương thích file tay sửa).
  const raw = keyB64.includes('-') || keyB64.includes('_') ? b64urlDecode(keyB64) : Buffer.from(keyB64, 'base64');
  if (raw.length !== 32) throw new Error('Khóa ký QR không hợp lệ — liên hệ Admin cấu hình lại');
  return raw;
}

/**
 * Lấy key ký hiện tại; sinh 256-bit lần đầu và persist vào app-config.json
 * (cùng chỗ ParkingSettings — KHÔNG hardcode, KHÔNG log, KHÔNG in vào QR).
 * Backup/restore `.db` + `app-config.json` phải đi cùng nhau (key mất → QR cũ invalid).
 */
export function ensureQrHmacKey(db: AppDb): { keyB64: string; keyId: number } {
  const current = loadParkingSettings(db) as unknown as Record<string, unknown>;
  const existing = current.qr_hmac_key_b64;
  if (typeof existing === 'string' && isValidKeyB64(existing) && keyToBytes(existing).length === 32) {
    return { keyB64: existing, keyId: QR_KEY_ID };
  }
  const fresh = crypto.randomBytes(32).toString('base64');
  // KHÔNG log key ra console/file dưới mọi hình thức.
  saveParkingSettings(db, { qr_hmac_key_b64: fresh });
  return { keyB64: fresh, keyId: QR_KEY_ID };
}

/** Chỉ đọc key (dùng khi verify phía server mà chưa muốn tự sinh key). */
export function readQrHmacKey(db: AppDb): { keyB64: string; keyId: number } | null {
  const current = loadParkingSettings(db) as unknown as Record<string, unknown>;
  const existing = current.qr_hmac_key_b64;
  if (typeof existing === 'string') {
    try {
      if (keyToBytes(existing).length === 32) return { keyB64: existing, keyId: QR_KEY_ID };
    } catch {
      return null;
    }
  }
  return null;
}

export interface QrPayload {
  version: string;
  ticketCode: string;
  plateNorm: string;
  epochMin: number;
}

/**
 * Ký vé → chuỗi QR text (backend ký, frontend/mobile KHÔNG tự ký).
 * Không chạm DB — caller tự resolve ticket/plate/check_in_at.
 */
export function signTicket(args: { ticketCode: string; licensePlate: string; checkInAt: string; keyB64: string }): string {
  const ticket = (args.ticketCode ?? '').trim();
  if (!/^T-\d{8}-\d{4}$/.test(ticket)) throw new Error('Mã vé không hợp lệ');
  const plate = normalizePlateForQr(args.licensePlate);
  if (plate.length < 2) throw new Error('Biển số không hợp lệ');
  const ts = checkInToEpochMin(args.checkInAt);
  const unsigned = `${QR_PAYLOAD_VERSION}.${ticket}.${plate}.${ts}`;
  const sig = b64urlEncode(crypto.createHmac('sha256', keyToBytes(args.keyB64)).update(unsigned, 'ascii').digest());
  return `${unsigned}.${sig}`;
}

/**
 * Verify chữ ký offline (máy staff dùng key trong secure storage tự check
 * mà không cần mạng — spec §1.3.2). Chỉ check format + version + HMAC.
 * KHÔNG check DB status ở đây (đối soát `parked` do caller/IPC làm).
 */
export function verifyQrSignature(
  qrText: string,
  keyB64: string,
): { ok: true; payload: QrPayload } | { ok: false; reason: QrVerifyReason } {
  const text = (qrText ?? '').trim();
  if (!text || text.length > MAX_QR_LEN) return { ok: false, reason: 'INVALID_FORMAT' };
  const parts = text.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'INVALID_FORMAT' };
  const [version, ticket, plate, tsRaw, sig] = parts;
  if (version !== QR_PAYLOAD_VERSION) return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  if (!/^T-\d{8}-\d{4}$/.test(ticket)) return { ok: false, reason: 'INVALID_FORMAT' };
  if (!/^[A-Z0-9]{2,12}$/.test(plate)) return { ok: false, reason: 'INVALID_FORMAT' };
  if (!/^\d{1,10}$/.test(tsRaw)) return { ok: false, reason: 'INVALID_FORMAT' };
  if (!/^[A-Za-z0-9\-_]{43}$/.test(sig)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  let key: Buffer;
  try {
    key = keyToBytes(keyB64);
  } catch {
    return { ok: false, reason: 'NO_KEY' };
  }
  const unsigned = `${version}.${ticket}.${plate}.${tsRaw}`;
  const expected = crypto.createHmac('sha256', key).update(unsigned, 'ascii').digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sig);
  } catch {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
  if (actual.length !== expected.length) return { ok: false, reason: 'INVALID_SIGNATURE' };
  // Constant-time compare — chống timing attack (spec §1.2).
  if (!crypto.timingSafeEqual(actual, expected)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  return { ok: true, payload: { version, ticketCode: ticket, plateNorm: plate, epochMin: Number(tsRaw) } };
}
