// Parking settings store — JSON file beside the DB (userData/app-config.json).
// Spec: ./specs/management-area.md §M2.2. NOT a DB table (P2 mới có bảng
// app_settings khi sync nhiều máy). Frontend caches under localStorage
// 'parking.settings.v1' (offline fallback) — backend file là nguồn sự thật.
// Fee rule (fee_grace_minutes / fee_day_threshold_hours) là hằng số công thức
// §8 — fee-calculator đọc qua opts, không hardcode ở handler.
import fs from 'node:fs';
import path from 'node:path';
import type { AppDb } from './db';
import type { ParkingSettings } from '../shared/types';

export const CONFIG_FILE_NAME = 'app-config.json';
export const LOGO_MAX_BYTES = 512 * 1024; // 512KB
const VN_PHONE_RE = /^0\d{9}$/;

/** URL PocketBase online mặc định (BE-016, theo hợp đồng Leader).
 * File cũ chưa có `pb_url` → dùng URL này; admin xóa (null) = local-only. */
export const DEFAULT_PB_URL = 'https://mqaue7.bot-keep.xyz';

/** Chuẩn hóa URL: trim + bỏ trailing slash; chuỗi rỗng → null. */
function normalizePbUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\/+$/, '');
  return t ? t : null;
}

export const DEFAULT_SETTINGS: Omit<ParkingSettings, 'updated_at'> = {
  lot_name: 'Bãi giữ xe',
  address: null,
  phone: null,
  logo_data_url: null,
  fee_grace_minutes: 30,
  fee_day_threshold_hours: 12,
  pb_url: DEFAULT_PB_URL,
  // BE-017: null = chưa cấu hình = local-only cho tới khi user nhập ID bãi
  // (merge-plan §4 — server bắt buộc parking_lot ở mọi create/filter).
  pb_parking_lot: null,
  // BE-018 (qr-anpr.md §1.2): key HMAC-SHA256 256-bit ký vé QR, base64 chuẩn.
  // null = chưa sinh (sinh lười ở ensureQrHmacKey lúc ký/cấp key lần đầu).
  // KHÔNG hardcode, KHÔNG log, KHÔNG trả cho client ngoài `auth:qr-key`.
  qr_hmac_key_b64: null,
  qr_key_id: 1,
};

/** Config lives next to the DB file (dev: ./data, packaged: userData). */
export function configPathForDb(db: AppDb): string {
  const name = (db as unknown as { name?: unknown }).name;
  const dir = typeof name === 'string' && name !== ':memory:' ? path.dirname(name) : process.cwd();
  return path.join(dir, CONFIG_FILE_NAME);
}

function withDefaults(raw: unknown): ParkingSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    lot_name: typeof r.lot_name === 'string' && r.lot_name.trim() ? r.lot_name : DEFAULT_SETTINGS.lot_name,
    address: typeof r.address === 'string' ? r.address : null,
    phone: typeof r.phone === 'string' ? r.phone : null,
    logo_data_url: typeof r.logo_data_url === 'string' ? r.logo_data_url : null,
    fee_grace_minutes:
      Number.isInteger(r.fee_grace_minutes) ? (r.fee_grace_minutes as number) : DEFAULT_SETTINGS.fee_grace_minutes,
    fee_day_threshold_hours:
      Number.isInteger(r.fee_day_threshold_hours)
        ? (r.fee_day_threshold_hours as number)
        : DEFAULT_SETTINGS.fee_day_threshold_hours,
    // BE-016: file cũ thiếu key (undefined) → default URL; null/rỗng đã lưu → giữ
    // local-only (không tự nhảy về default để tôn trọng lựa chọn của admin).
    pb_url: r.pb_url === undefined ? DEFAULT_PB_URL : normalizePbUrl(r.pb_url),
    // BE-017: file cũ thiếu key → null (local-only cho tới khi user cấu hình).
    // Chuỗi rỗng/không hợp lệ trong file tay sửa → null (không throw).
    pb_parking_lot:
      typeof r.pb_parking_lot === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(r.pb_parking_lot.trim())
        ? r.pb_parking_lot.trim()
        : null,
    // BE-018: key ký QR — giữ nguyên chuỗi base64 đã lưu (null khi chưa sinh).
    // Validate độ dài thật ở ensureQrHmacKey/readQrHmacKey (qr-ticket.ts),
    // ở đây chỉ loại chuỗi rỗng/không phải base64 (không throw để fee preview không vỡ).
    qr_hmac_key_b64:
      typeof r.qr_hmac_key_b64 === 'string' && /^[A-Za-z0-9+/=_-]{40,60}$/.test(r.qr_hmac_key_b64.trim())
        ? r.qr_hmac_key_b64.trim()
        : null,
    qr_key_id: r.qr_key_id === 1 ? 1 : 1, // V1: 1 key duy nhất (rotation để P2 — qr-anpr.md §1.2)
    updated_at: typeof r.updated_at === 'string' && r.updated_at ? r.updated_at : new Date().toISOString(),
  };
}

/** Read settings; missing/corrupt file → defaults (không throw để fee preview không vỡ). */
export function loadParkingSettings(db: AppDb): ParkingSettings {
  try {
    const p = configPathForDb(db);
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS, updated_at: new Date().toISOString() };
    return withDefaults(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS, updated_at: new Date().toISOString() };
  }
}

export interface ConfigPatch {
  lot_name?: unknown;
  address?: unknown;
  phone?: unknown;
  logo_data_url?: unknown;
  fee_grace_minutes?: unknown;
  fee_day_threshold_hours?: unknown;
  pb_url?: unknown; // BE-016: string http(s) URL hoặc null (local-only)
  pb_parking_lot?: unknown; // BE-017: string ID bãi server hoặc null (chưa cấu hình)
  qr_hmac_key_b64?: unknown; // BE-018: base64 key 256-bit (chỉ nội bộ ensureQrHmacKey dùng)
}

/**
 * Validate patch (whitelist keys — key lạ bị bỏ qua im lặng). Throw Error
 * với message chứa mã lỗi để frontend match: INVALID_PHONE | LOGO_TOO_LARGE
 * | INVALID_FEE_RULE (+ ValidationError ở handler cho field-level inline).
 */
export function validateParkingPatch(
  patch: ConfigPatch,
): Pick<
  ParkingSettings,
  | 'lot_name'
  | 'address'
  | 'phone'
  | 'logo_data_url'
  | 'fee_grace_minutes'
  | 'fee_day_threshold_hours'
  | 'pb_url'
  | 'pb_parking_lot'
  | 'qr_hmac_key_b64'
> {
  const errors: Record<string, string[]> = {};
  const out: Record<string, unknown> = {};

  if (patch.lot_name !== undefined) {
    const t = typeof patch.lot_name === 'string' ? patch.lot_name.trim() : '';
    if (!t) errors.lot_name = ['Tên bãi xe là bắt buộc.'];
    else if (t.length > 100) errors.lot_name = ['Tên bãi xe tối đa 100 ký tự.'];
    else out.lot_name = t;
  }
  if (patch.address !== undefined) {
    if (patch.address === null) out.address = null;
    else {
      const t = typeof patch.address === 'string' ? patch.address.trim() : '';
      if (!t) out.address = null;
      else if (t.length > 255) errors.address = ['Địa chỉ tối đa 255 ký tự.'];
      else out.address = t;
    }
  }
  if (patch.phone !== undefined) {
    if (patch.phone === null) out.phone = null;
    else {
      const t = typeof patch.phone === 'string' ? patch.phone.trim() : '';
      if (!t) out.phone = null;
      else if (!VN_PHONE_RE.test(t)) errors.phone = ['SĐT không hợp lệ (INVALID_PHONE). VD: 0901234567.'];
      else out.phone = t;
    }
  }
  if (patch.logo_data_url !== undefined) {
    if (patch.logo_data_url === null) out.logo_data_url = null;
    else if (typeof patch.logo_data_url !== 'string' || !patch.logo_data_url) out.logo_data_url = null;
    else {
      const m = /^(data:image\/(png|jpeg);base64,)([A-Za-z0-9+/=]+)$/.exec(patch.logo_data_url.trim());
      if (!m) errors.logo_data_url = ['Logo phải là ảnh PNG/JPG (dataURL).'];
      else {
        const bytes = Math.floor(m[3].length * 3 * 0.25);
        if (bytes > LOGO_MAX_BYTES) {
          errors.logo_data_url = [`Logo vượt quá 512KB (LOGO_TOO_LARGE) — hãy nén ảnh rồi thử lại.`];
        } else out.logo_data_url = patch.logo_data_url.trim();
      }
    }
  }

  // Fee rule: validate từng biên trước, ràng buộc chéo sau (trên giá trị hiệu dụng).
  let grace = out.fee_grace_minutes as number | undefined;
  let threshold = out.fee_day_threshold_hours as number | undefined;
  if (patch.fee_grace_minutes !== undefined) {
    const v = patch.fee_grace_minutes;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 120) {
      errors.fee_grace_minutes = ['Thời gian tối thiểu 0–120 phút (INVALID_FEE_RULE).'];
    } else {
      grace = v as number;
      out.fee_grace_minutes = grace;
    }
  }
  if (patch.fee_day_threshold_hours !== undefined) {
    const v = patch.fee_day_threshold_hours;
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 24) {
      errors.fee_day_threshold_hours = ['Ngưỡng áp giá ngày 1–24 giờ (INVALID_FEE_RULE).'];
    } else {
      threshold = v as number;
      out.fee_day_threshold_hours = threshold;
    }
  }

  // BE-016: URL máy chủ online. null/rỗng = local-only (không thử online).
  if (patch.pb_url !== undefined) {
    if (patch.pb_url === null) {
      out.pb_url = null;
    } else {
      const t = normalizePbUrl(patch.pb_url);
      if (!t || t.length > 500 || !/^https?:\/\/.+\..+/.test(t)) {
        errors.pb_url = ['Địa chỉ máy chủ online không hợp lệ (VD: https://ten-mien-cua-ban).'];
      } else {
        out.pb_url = t;
      }
    }
  }

  // BE-017: ID bãi server (parking_lots). null/rỗng = chưa cấu hình = local-only
  // (không thử online). Xin id từ system_admin (merge-plan §4).
  if (patch.pb_parking_lot !== undefined) {
    if (patch.pb_parking_lot === null) {
      out.pb_parking_lot = null;
    } else {
      const t = typeof patch.pb_parking_lot === 'string' ? patch.pb_parking_lot.trim() : '';
      if (!t) {
        out.pb_parking_lot = null;
      } else if (t.length > 100 || !/^[A-Za-z0-9_-]+$/.test(t)) {
        errors.pb_parking_lot = ['Mã bãi xe không hợp lệ — nhập ID bãi do system_admin cấp (VD: pbc_…).'];
      } else {
        out.pb_parking_lot = t;
      }
    }
  }

  // BE-018: key ký QR — nội bộ (ensureQrHmacKey). Chấp nhận base64/base64url
  // decode ra đúng 32 bytes; sai → lỗi (không tự sinh ở đây).
  if (patch.qr_hmac_key_b64 !== undefined) {
    const t = typeof patch.qr_hmac_key_b64 === 'string' ? patch.qr_hmac_key_b64.trim() : '';
    if (!t) {
      errors.qr_hmac_key_b64 = ['Khóa ký QR không hợp lệ — liên hệ Admin cấu hình lại.'];
    } else {
      try {
        const raw = t.includes('-') || t.includes('_')
          ? Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - ((t.replace(/-/g, '+').replace(/_/g, '/').length) % 4)) % 4), 'base64')
          : Buffer.from(t, 'base64');
        if (raw.length !== 32) {
          errors.qr_hmac_key_b64 = ['Khóa ký QR không hợp lệ — liên hệ Admin cấu hình lại.'];
        } else {
          out.qr_hmac_key_b64 = t;
        }
      } catch {
        errors.qr_hmac_key_b64 = ['Khóa ký QR không hợp lệ — liên hệ Admin cấu hình lại.'];
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Dữ liệu cấu hình không hợp lệ');
    (err as unknown as { errors: Record<string, string[]> }).errors = errors;
    throw err;
  }
  // Ràng buộc chéo cần cả 2 giá trị hiệu dụng → merge với file hiện tại ở save.
  return out as ReturnType<typeof validateParkingPatch>;
}

/** Cross-field rule: ngưỡng ngày (phút) phải lớn hơn tối thiểu. */
export function assertFeeCrossRule(graceMinutes: number, dayThresholdHours: number): void {
  if (dayThresholdHours * 60 <= graceMinutes) {
    const err = new Error('Ngưỡng ngày phải lớn hơn thời gian tối thiểu (INVALID_FEE_RULE).');
    (err as unknown as { errors: Record<string, string[]> }).errors = {
      fee_day_threshold_hours: ['Ngưỡng ngày phải lớn hơn thời gian tối thiểu (INVALID_FEE_RULE).'],
    };
    throw err;
  }
}

/** Merge patch vào file (atomic write tmp + rename). Throw Error có `.errors` khi invalid. */
export function saveParkingSettings(db: AppDb, patch: ConfigPatch): ParkingSettings {
  const current = loadParkingSettings(db);
  const valid = validateParkingPatch(patch);
  const next: ParkingSettings = { ...current, ...valid, updated_at: new Date().toISOString() };
  assertFeeCrossRule(next.fee_grace_minutes, next.fee_day_threshold_hours);
  const p = configPathForDb(db);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  return next;
}

/**
 * URL PocketBase hiệu dụng (BE-016 — auth/data online đọc từ đây).
 * - file chưa có key → DEFAULT_PB_URL (fresh install trỏ sẵn server theo hợp đồng).
 * - admin lưu null/rỗng → null = local-only (bỏ qua mọi thử online, vào local ngay).
 */
export function getPbBaseUrl(db: AppDb): string | null {
  try {
    const s = loadParkingSettings(db);
    const u = typeof s.pb_url === 'string' ? s.pb_url.trim().replace(/\/+$/, '') : '';
    return u ? u : null;
  } catch {
    return DEFAULT_PB_URL;
  }
}

/**
 * ID bãi server hiệu dụng (BE-017 — merge-plan §4).
 * - Mọi create/filter PB PHẢI gắn kèm (server bắt buộc `parking_lot*`).
 * - null = chưa cấu hình = local-only (caller hiện message Việt hướng dẫn nhập).
 */
export function getPbParkingLot(db: AppDb): string | null {
  try {
    const s = loadParkingSettings(db);
    const v = typeof s.pb_parking_lot === 'string' ? s.pb_parking_lot.trim() : '';
    return v ? v : null;
  } catch {
    return null;
  }
}
