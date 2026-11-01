import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { Phone } from 'lucide-react';
import { Alert, Badge, Button } from '../components/ui';
import { formatDateShort } from '../lib/format';
import type { UserDTO, StaffSelfProfile } from '../types';

// FE-017 S1b/S1d: drawer "Hồ sơ nhân viên" 400px phải (reuse pattern drawer §e).
// - Admin (UsersPage): full + section Ghi chú nội bộ + footer Sửa/Khóa-Mở.
// - Staff (Hồ sơ của tôi): showNotes=false → ẨN cả section + footer chỉ note liên hệ quản lý.

type ProfileUser = UserDTO | StaffSelfProfile;

function tenureLabel(startDate: string | null): string | null {
  if (!startDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  if (months < 1) return 'Mới vào làm';
  const y = Math.floor(months / 12);
  const mo = months % 12;
  if (y === 0) return `${mo} tháng`;
  if (mo === 0) return `${y} năm`;
  return `${y} năm ${mo} tháng`;
}

function nullDash(v: string | null): ReactNode {
  return v ? <span>{v}</span> : <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>—</span>;
}

interface Props {
  user: ProfileUser;
  isSelf?: boolean;
  showNotes: boolean;
  onClose: () => void;
  onEdit?: () => void;
  toggleLabel?: string;
  onToggle?: () => void;
  /** inline: render card tĩnh trong page (Hồ sơ của tôi) — không overlay/Esc/scroll-lock. */
  inline?: boolean;
}

export function StaffDrawer({ user, isSelf = false, showNotes, onClose, onEdit, toggleLabel, onToggle, inline = false }: Props): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const trigger = useRef<Element | null>(null);
  const tenure = tenureLabel(user.start_date);
  const notes = (user as UserDTO).notes ?? null;

  useEffect(() => {
    if (inline) return;
    trigger.current = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (trigger.current instanceof HTMLElement) trigger.current.focus();
    };
  }, [onClose, inline]);

  const active = user.is_active === 1;

  const body = (
    <aside
      className={inline ? 'card' : 'drawer drawer-400'}
      role={inline ? undefined : 'dialog'}
      aria-label={inline ? undefined : `Hồ sơ nhân viên ${user.full_name}`}
      aria-modal={inline ? undefined : true}
    >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{user.full_name}{isSelf && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-60)' }}> (bạn)</span>}</h2>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {user.role_name === 'admin' ? <Badge tone="primary">Admin</Badge> : <Badge tone="secondary">Nhân viên</Badge>}
              {active ? <Badge tone="success">Hoạt động</Badge> : <Badge tone="danger">Bị khóa</Badge>}
            </div>
          </div>
          <button ref={closeRef} type="button" className="btn btn-neutral btn-sm" onClick={onClose} aria-label="Đóng hồ sơ" style={inline ? { display: 'none' } : undefined}>
            Đóng
          </button>
        </div>

        <section aria-label="Liên hệ" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: 'var(--color-text-60)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Liên hệ</h3>
          <dl style={{ margin: 0, display: 'grid', gap: 6, fontSize: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ width: 110, color: 'var(--color-text-60)', flexShrink: 0 }}>Tên đăng nhập</dt>
              <dd style={{ margin: 0 }}><span className="mono" style={{ fontSize: 14 }}>{user.username}</span></dd>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ width: 110, color: 'var(--color-text-60)', flexShrink: 0 }}>SĐT</dt>
              <dd style={{ margin: 0 }}>
                {user.phone ? (
                  <a className="mono" style={{ fontSize: 14 }} href={`tel:${user.phone}`} aria-label={`Gọi ${user.phone}`}>
                    <Phone size={12} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: -1, marginRight: 4 }} />{user.phone}
                  </a>
                ) : <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>—</span>}
              </dd>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ width: 110, color: 'var(--color-text-60)', flexShrink: 0 }}>Địa chỉ</dt>
              <dd style={{ margin: 0 }}>{nullDash(user.address)}</dd>
            </div>
          </dl>
        </section>

        <section aria-label="Công việc" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, margin: '0 0 8px', color: 'var(--color-text-60)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Công việc</h3>
          <dl style={{ margin: 0, display: 'grid', gap: 6, fontSize: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ width: 110, color: 'var(--color-text-60)', flexShrink: 0 }}>Ngày vào làm</dt>
              <dd style={{ margin: 0 }}>
                {user.start_date
                  ? <span className="mono" style={{ fontSize: 14 }}>{formatDateShort(user.start_date)}</span>
                  : <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>—</span>}
              </dd>
            </div>
            {tenure && (
              <div style={{ display: 'flex', gap: 8 }}>
                <dt style={{ width: 110, color: 'var(--color-text-60)', flexShrink: 0 }}>Thâm niên</dt>
                <dd style={{ margin: 0 }}>{tenure}</dd>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <dt style={{ width: 110, color: 'var(--color-text-60)', flexShrink: 0 }}>Trạng thái</dt>
              <dd style={{ margin: 0 }}>{active ? 'Đang làm việc' : 'Đã khóa'}</dd>
            </div>
          </dl>
        </section>

        {showNotes && (
          <section aria-label="Ghi chú nội bộ" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 8px', color: 'var(--color-text-60)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ghi chú nội bộ</h3>
            {notes
              ? <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{notes}</p>
              : <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>—</span>}
          </section>
        )}

        {(onEdit ?? onToggle) && (
          <div className="dialog-foot" style={{ marginTop: 24 }}>
            {onToggle && toggleLabel && <Button variant="neutral" onClick={onToggle}>{toggleLabel}</Button>}
            {onEdit && <Button onClick={onEdit}>Sửa hồ sơ</Button>}
          </div>
        )}
        {!onEdit && !onToggle && !showNotes && (
          <div style={{ marginTop: 24 }}>
            <Alert tone="warning">Muốn đổi họ tên, tên đăng nhập hoặc ngày vào làm — liên hệ quản lý để cập nhật.</Alert>
          </div>
        )}
      </aside>
  );

  if (inline) return body;
  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {body}
    </div>
  );
}
