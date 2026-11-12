// FE-025 — Banner fallback + rationale xin quyền (spec notifications.md §5).
// Banner: strip Warning persistent khi toast bị chặn/tắt (§5.2), nút Đóng nhớ
// 7 ngày + link "Hướng dẫn bật". Rationale: dialog Việt TRƯỚC system prompt
// (§5.1), tối đa 2 lần — gọi sau hành động liên quan đầu tiên.

import { useState, type JSX } from 'react';
import { Alert, Button, Dialog } from './ui';
import {
  FALLBACK_COPY,
  dismissFallbackBanner,
  markRationaleShown,
  notifyPermission,
  requestNotifyPermission,
  shouldShowFallbackBanner,
  type NotifySurface,
} from '../lib/notify';

export type RationaleTrigger = 'reservation' | 'pass' | 'shift';

const RATIONALE_TITLE: Record<RationaleTrigger, string> = {
  reservation: 'Bật thông báo để không lỡ giờ giữ chỗ?',
  pass: 'Bật thông báo để không quên gia hạn vé?',
  shift: 'Bật thông báo để không quên chốt ca?',
};

/** Strip Warning fallback khi toast bị chặn/tắt (§5.2). role="status", không alert. */
export function NotifyFallbackBanner({ surface }: { surface: NotifySurface }): JSX.Element | null {
  const [visible, setVisible] = useState(() => shouldShowFallbackBanner(surface));
  const [guide, setGuide] = useState(false);
  if (!visible) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="alert alert-warning" role="status">
        <span>
          {FALLBACK_COPY[surface]}{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: 0, height: 'auto' }}
            onClick={() => setGuide((v) => !v)}
            aria-expanded={guide}
          >
            Hướng dẫn bật
          </button>
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-neutral btn-sm"
          onClick={() => {
            dismissFallbackBanner(surface);
            setVisible(false);
          }}
          aria-label="Đóng thông báo này trong 7 ngày"
        >
          Để sau
        </button>
      </div>
      {guide && (
        <div className="card" style={{ marginTop: 8 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Bật thông báo trên Windows</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            <li>Mở <span className="mono">Settings → System → Notifications</span>.</li>
            <li>Bật công tắc cho <strong>Bãi xe thông minh</strong>.</li>
            <li>Tắt <span className="mono">Do not disturb</span> / Focus Assist trong giờ trực.</li>
          </ol>
          <p style={{ fontSize: 12, color: 'var(--color-text-60)', margin: '8px 0 0' }}>
            Chỉ 4 việc quan trọng (vé sắp hết · giữ chỗ · bãi đầy · ca chưa chốt), không quảng cáo.
          </p>
        </div>
      )}
    </div>
  );
}

/** Dialog rationale Việt trước system prompt (§5.1). */
export function NotifyRationaleDialog({
  trigger,
  onDone,
}: {
  trigger: RationaleTrigger;
  onDone: (granted: boolean) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function handleEnable(): Promise<void> {
    setBusy(true);
    const p = await requestNotifyPermission();
    setBusy(false);
    markRationaleShown();
    onDone(p === 'granted');
  }

  function handleLater(): void {
    markRationaleShown();
    onDone(false);
  }

  return (
    <Dialog title={RATIONALE_TITLE[trigger]} onClose={handleLater} label="Xin phép hiện thông báo">
      <ul style={{ margin: '0 0 4px', paddingLeft: 20, fontSize: 14 }}>
        <li>Vé tháng sắp hết hạn</li>
        <li>Giữ chỗ sắp tới giờ</li>
        <li>Ca chưa chốt sau giờ hết ca</li>
      </ul>
      <p style={{ fontSize: 12, color: 'var(--color-text-60)' }}>
        Chỉ 4 việc quan trọng, không quảng cáo. Tắt bất kỳ lúc nào trong Cài đặt.
      </p>
      <div className="dialog-foot">
        <button className="btn btn-neutral" onClick={handleLater}>Để sau</button>
        <Button onClick={() => void handleEnable()} disabled={busy} aria-busy={busy}>
          {busy ? 'Đang chờ…' : 'Bật thông báo'}
        </Button>
      </div>
    </Dialog>
  );
}

/** Trạng thái quyền hiện tại — dùng trong màn Quản lý (nút "Gửi thử"). */
export function notifyPermissionLabel(): string {
  const p = notifyPermission();
  if (p === 'granted') return 'Đang bật';
  if (p === 'denied') return 'Đang tắt (bị chặn ở OS)';
  if (p === 'default') return 'Chưa hỏi';
  return 'Không hỗ trợ';
}
