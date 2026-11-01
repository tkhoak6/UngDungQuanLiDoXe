// FE-020 S4 — helpers phân quyền staff (spec staff-area.md S4).
// Single place for: labels/mô tả tiếng Việt, presets, resolve raw → map,
// và strip đuôi kỹ thuật `(NO_PERMISSION:<key>)` của backend (BE-014) thành
// toast tiếng Việt thân thiện.

import { STAFF_DEFAULTS } from '../types';
import type { RoleName, StaffPermissionKey, StaffPermissions } from '../types';

export const PERM_KEYS: StaffPermissionKey[] = [
  'checkin',
  'pass_sale',
  'report_self',
  'profile_self',
  'reservation',
];

export const PERM_META: Record<StaffPermissionKey, { label: string; desc: string }> = {
  checkin: { label: 'Check-in / out + thu phí', desc: 'Nhận xe vào, thu phí lúc ra, xem biên lai tạm tính.' },
  pass_sale: { label: 'Bán vé tháng', desc: 'Bán mới, gia hạn, duyệt hoặc từ chối vé chờ xác nhận.' },
  report_self: { label: 'Báo cáo ca mình', desc: 'Xem Nhật ký hoạt động và Hiệu suất của chính mình.' },
  profile_self: { label: 'Tự sửa SĐT / địa chỉ', desc: 'Cho phép sửa số điện thoại và địa chỉ trong Hồ sơ của tôi.' },
  reservation: { label: 'Xác nhận đặt chỗ', desc: 'Dùng mã giữ chỗ R-… lúc check-in cho khách đã đặt trước.' },
};

// Presets cho dialog edit (delegation FE-020):
// - Full: đủ 5 quyền (giữ nguyên như hiện tại).
// - Thu ngân cơ bản: check-in + bán vé + đặt chỗ, không xem báo cáo.
// - Chỉ xem: chỉ xem báo cáo ca mình, không thao tác.
export const PRESET_FULL: StaffPermissions = { ...STAFF_DEFAULTS };
export const PRESET_CASHIER: StaffPermissions = {
  checkin: 1,
  pass_sale: 1,
  report_self: 0,
  profile_self: 1,
  reservation: 1,
};
export const PRESET_VIEWER: StaffPermissions = {
  checkin: 0,
  pass_sale: 0,
  report_self: 1,
  profile_self: 0,
  reservation: 0,
};

/** Parse raw `permissions` (JSON string | null) → object hoặc null (= mặc định full). */
export function parsePermRaw(raw: string | null | undefined): StaffPermissions | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const out: StaffPermissions = { ...STAFF_DEFAULTS };
    let known = false;
    for (const k of PERM_KEYS) {
      const v = parsed[k];
      if (v === 1 || v === true || v === '1') {
        out[k] = 1;
        known = true;
      } else if (v === 0 || v === false || v === '0') {
        out[k] = 0;
        known = true;
      }
    }
    return known ? out : null;
  } catch {
    return null; // JSON hỏng = full (cùng rule resolvePerm backend BE-014)
  }
}

/** Resolve map cuối cùng để render: admin → full; staff → raw ?? defaults. */
export function resolvePerms(role: RoleName, raw: string | null | undefined): StaffPermissions {
  if (role === 'admin') return { ...STAFF_DEFAULTS };
  return parsePermRaw(raw) ?? { ...STAFF_DEFAULTS };
}

/** Mất toàn bộ quyền (landing staff → empty-state, spec S4.4). */
export function hasNoPerms(perms: StaffPermissions): boolean {
  return PERM_KEYS.every((k) => perms[k] !== 1);
}

const NO_PERM_RE = /\s*\(NO_PERMISSION:([a-z_]+)\)/;

/**
 * Strip đuôi kỹ thuật `(NO_PERMISSION:<key>)` của backend (BE-014) và map
 * sang câu tiếng Việt thân thiện (S4.3). Message không chứa suffix → giữ nguyên.
 */
export function friendlyPermError(msg: string): string {
  const m = NO_PERM_RE.exec(msg);
  if (!m) return msg;
  const key = m[1] as StaffPermissionKey;
  const label = PERM_META[key]?.label ?? 'thực hiện thao tác này';
  return `Tài khoản của bạn không có quyền ${label} — liên hệ quản lý.`;
}

/** Trích key quyền từ suffix backend (để App guard deep-link theo đúng key). */
export function noPermKey(msg: string): StaffPermissionKey | null {
  const m = NO_PERM_RE.exec(msg);
  if (!m) return null;
  return (PERM_KEYS as string[]).includes(m[1]) ? (m[1] as StaffPermissionKey) : null;
}
