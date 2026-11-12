// FE-025 — Thông báo desktop V1 (spec ./specs/notifications.md §5, nối BE-021).
// Đăng ký listener `notify:deep-link` (Toast click từ main scheduler) +
// permission/rationale/fallback-banner helpers. Chỉ `src/renderer/*` — KHÔNG
// đụng main/preload/DB. Vì preload hiện tại chỉ expose `api.invoke`, subscribe
// thử bridge mở rộng `onNotifyDeepLink` (khi BE bổ sung 3 dòng preload) VÀ
// window CustomEvent cùng tên kênh (mock `notify:test {sample}` dispatch để
// QA click-through ngay trên bản web/vite).

import { NOTIFY_DEEP_LINK_CHANNEL } from '../../shared/types';
import type { NotifyDeepLink } from '../types';

export { NOTIFY_DEEP_LINK_CHANNEL };
export type { NotifyDeepLink };

type DeepLinkHandler = (link: NotifyDeepLink) => void;

interface NotifyBridge {
  onNotifyDeepLink?: (cb: DeepLinkHandler) => (() => void) | void;
}

function getNotifyBridge(): NotifyBridge | null {
  const w = window as unknown as { api?: NotifyBridge };
  return w.api && typeof w.api.onNotifyDeepLink === 'function' ? w.api : null;
}

/** Đăng ký listener deep-link. Trả về unsubscribe. Không throw khi thiếu bridge. */
export function subscribeNotifyDeepLink(cb: DeepLinkHandler): () => void {
  const cleanups: Array<() => void> = [];
  // 1) Preload bridge mở rộng (Electron thật, khi BE bổ sung `on`).
  try {
    const bridge = getNotifyBridge();
    if (bridge?.onNotifyDeepLink) {
      const off = bridge.onNotifyDeepLink(cb);
      if (typeof off === 'function') cleanups.push(off);
    }
  } catch {
    // bridge lạ — bỏ qua, vẫn còn CustomEvent fallback
  }
  // 2) Window CustomEvent (mock testNotify + QA tay qua DevTools).
  const onCustom = (e: Event): void => {
    const detail = (e as CustomEvent<NotifyDeepLink>).detail;
    if (detail && typeof detail.tab === 'string') cb(detail);
  };
  window.addEventListener(NOTIFY_DEEP_LINK_CHANNEL, onCustom);
  cleanups.push(() => window.removeEventListener(NOTIFY_DEEP_LINK_CHANNEL, onCustom));
  return () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  };
}

/** Phát deep-link giả lập (mock testNotify + test tay). Không dùng ở production. */
export function dispatchNotifyDeepLink(link: NotifyDeepLink): void {
  window.dispatchEvent(new CustomEvent(NOTIFY_DEEP_LINK_CHANNEL, { detail: link }));
}

// ---- Notification permission (spec §5) ----

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyPermission(): NotifyPermission {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    const p = Notification.permission;
    return p === 'granted' || p === 'denied' ? p : 'default';
  } catch {
    return 'unsupported';
  }
}

/** Xin quyền hệ thống. Chỉ gọi SAU rationale (§5.1) — không gọi lúc mở app. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  try {
    if (typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
      return 'unsupported';
    }
    const p = await Notification.requestPermission();
    return p === 'granted' || p === 'denied' ? p : 'default';
  } catch {
    return 'unsupported';
  }
}

// ---- Rationale §5.1: tối đa 2 lần, sau hành động liên quan đầu tiên ----

const RATIONALE_KEY = 'parking:notify-rationale-v1';

function readRationaleCount(): number {
  try {
    return Number(localStorage.getItem(RATIONALE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** true = nên hiện rationale Việt TRƯỚC system prompt (permission default + <2 lần). */
export function shouldShowNotifyRationale(): boolean {
  return notifyPermission() === 'default' && readRationaleCount() < 2;
}

export function markRationaleShown(): void {
  try {
    localStorage.setItem(RATIONALE_KEY, String(readRationaleCount() + 1));
  } catch {
    // non-fatal
  }
}

// ---- Fallback banner §5.2: strip Warning khi toast bị chặn/tắt ----

const BANNER_KEY_PREFIX = 'parking:notify-banner-dismissed-';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // nhớ 7 ngày

/** true = nên hiện banner fallback (permission không granted + chưa đóng trong 7 ngày). */
export function shouldShowFallbackBanner(surface: string): boolean {
  if (notifyPermission() === 'granted' || notifyPermission() === 'unsupported') return false;
  try {
    const raw = localStorage.getItem(BANNER_KEY_PREFIX + surface);
    if (!raw) return true;
    return Date.now() - Number(raw) > DISMISS_TTL_MS;
  } catch {
    return true;
  }
}

export function dismissFallbackBanner(surface: string): void {
  try {
    localStorage.setItem(BANNER_KEY_PREFIX + surface, String(Date.now()));
  } catch {
    // non-fatal
  }
}

export type NotifySurface = 'passes' | 'reservations' | 'attendance';

/** Copy banner fallback theo màn (§5.2) — cùng giọng spec, không phát minh thêm. */
export const FALLBACK_COPY: Record<NotifySurface, string> = {
  passes: 'Thông báo đang tắt — vé sắp hết hạn sẽ không hiện Toast.',
  reservations: 'Thông báo đang tắt — hãy tự canh giờ giữ chỗ.',
  attendance: 'Thông báo đang tắt — nhớ tự chốt ca đúng giờ.',
};
