import type { JSX, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChartColumn,
  SquareParking,
  Ticket,
  CreditCard,
  ChartLine,
  Settings2,
  ScrollText,
  Users,
  Map,
  CircleUserRound,
  IdCard,
  CalendarClock,
} from 'lucide-react';
import { useAuth } from '../store/auth';
import type { RoleName, StaffPermissionKey } from '../types';

export type PageKey = 'dashboard' | 'zones' | 'sessions' | 'passes' | 'revenue' | 'management' | 'activity' | 'attendance' | 'users' | 'profile' | 'guest';

// FE-020 S4: nav ẩn theo perms (staff mất flag → mất menu tương ứng).
// admin luôn thấy hết (resolvePerm backend: admin → full). attendance giữ
// nguyên (BE-014 không map guard — mọi staff chấm công được).
const NAV: Array<{ key: PageKey; label: string; icon: LucideIcon; roles: RoleName[]; perm?: StaffPermissionKey }> = [
  { key: 'dashboard', label: 'Dashboard', icon: ChartColumn, roles: ['admin', 'staff'] },
  { key: 'zones', label: 'Khu vực', icon: SquareParking, roles: ['admin'] },
  { key: 'sessions', label: 'Check-in / out', icon: Ticket, roles: ['admin', 'staff'], perm: 'checkin' },
  { key: 'passes', label: 'Vé tháng', icon: CreditCard, roles: ['admin', 'staff'], perm: 'pass_sale' },
  { key: 'revenue', label: 'Báo cáo', icon: ChartLine, roles: ['admin'] },
  // FE-021 (spec management-area.md §0): "Quản lý" sau Báo cáo, trước Nhật ký
  // (cuối nhóm quản trị). Admin-only — staff không thấy nav (App bounce +
  // toast khi deep-link, cùng pattern Nhân viên DS-006).
  { key: 'management', label: 'Quản lý', icon: Settings2, roles: ['admin'] },
  // FE-011 (spec activity-log.md §1): "Nhật ký" sau Lịch sử, trước Nhân viên
  // (cuối nhóm quản trị). Repo chưa có nav "Lịch sử" riêng → đặt giữa Báo cáo
  // và Nhân viên. Admin full, staff mine_only (ẩn filter NV trong page).
  // FE-020 S4: Nhật ký (log + Hiệu suất) cần `report_self`.
  { key: 'activity', label: 'Nhật ký', icon: ScrollText, roles: ['admin', 'staff'], perm: 'report_self' },
  // FE-019 S3 (spec staff-area.md S3.3): "Chấm công" sau Nhật ký — staff +
  // admin thấy (staff mine_only, admin thêm staff-filter + tab Định nghĩa ca).
  { key: 'attendance', label: 'Chấm công', icon: CalendarClock, roles: ['admin', 'staff'] },
  { key: 'users', label: 'Nhân viên', icon: Users, roles: ['admin'] },
  // FE-017 S1d: "Hồ sơ của tôi" — staff + admin (render với mọi role đã login).
  { key: 'profile', label: 'Hồ sơ của tôi', icon: IdCard, roles: ['admin', 'staff'] },
  { key: 'guest', label: 'Sơ đồ chỗ trống', icon: Map, roles: ['admin', 'staff', 'guest'] },
];

const TITLES: Record<PageKey, string> = {
  dashboard: 'Dashboard tổng quan',
  zones: 'Quản lý khu vực',
  sessions: 'Check-in / Check-out',
  passes: 'Vé tháng',
  revenue: 'Báo cáo doanh thu',
  management: 'Quản lý',
  activity: 'Nhật ký hoạt động',
  attendance: 'Chấm công',
  users: 'Nhân viên',
  profile: 'Hồ sơ của tôi',
  guest: 'Sơ đồ chỗ trống',
};

interface Props {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
  children: ReactNode;
}

export function AppShell({ page, onNavigate, children }: Props): JSX.Element {
  const { fullName, role, perms, logout } = useAuth();
  // FE-026: dropdown avatar ở topbar cho MỌI role (admin trước đây chỉ có nút
  // ở sidebar). 1 click Đăng xuất, KHÔNG confirm — toast "Đã đăng xuất" hiện
  // ở màn Login (cờ sessionStorage trong store).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        avatarRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const roleLabel = role === 'admin' ? 'Admin' : role === 'staff' ? 'Nhân viên' : role === 'customer' ? 'Khách hàng' : 'Khách';
  // FE-020 S4: staff mất flag → mất menu tương ứng. perms null (đang tải/boot)
  // → hiển thị như full để tránh nhấp nháy ẩn menu.
  const items = NAV.filter((n) => {
    if (role === null || !n.roles.includes(role)) return false;
    if (role === 'staff' && n.perm && perms && perms[n.perm] !== 1) return false;
    return true;
  });

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Điều hướng chính">
        <div className="sidebar-logo">
          <SquareParking size={20} strokeWidth={2} aria-hidden="true" /> BãiXe
        </div>
        <nav className="sidebar-nav">
          {items.map((n) => (
            <button
              key={n.key}
              className={`nav-item${page === n.key ? ' active' : ''}`}
              aria-current={page === n.key ? 'page' : undefined}
              onClick={() => onNavigate(n.key)}
            >
              <span aria-hidden="true" className="nav-icon"><n.icon size={16} strokeWidth={2} aria-hidden="true" /></span>{' '}
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-role">
          <div style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{fullName}</div>
          <div style={{ margin: '6px 0' }}>
            <span className="badge badge-primary">
              <span className="dot" aria-hidden="true" />
              {role === 'admin' ? 'Admin' : role === 'staff' ? 'Nhân viên' : role === 'customer' ? 'Khách hàng' : 'Khách'}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout} style={{ paddingLeft: 0 }}>
            Đăng xuất
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="topbar-title">{TITLES[page]}</span>
          <div className="topbar-right">
            <span className="mono" style={{ fontSize: 12, color: 'var(--color-text-60)' }}>
              Ca sáng · 07:00–15:00
            </span>
            {/* FE-026: avatar dropdown (Tên + vai trò + Đăng xuất) cho MỌI role. */}
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                ref={avatarRef}
                type="button"
                className="btn btn-ghost btn-sm"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Tài khoản ${fullName} — mở menu`}
                onClick={() => setMenuOpen((v) => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <CircleUserRound size={16} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--color-text-60)' }} />
                <span style={{ fontSize: 13, fontWeight: 500, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fullName}
                </span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  aria-label="Menu tài khoản"
                  className="card"
                  style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 220, padding: 12, zIndex: 50 }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</div>
                  <div style={{ margin: '6px 0 12px' }}>
                    <span className="badge badge-primary">
                      <span className="dot" aria-hidden="true" />
                      {roleLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="btn btn-neutral btn-sm btn-block"
                    onClick={() => { setMenuOpen(false); logout(); }}
                  >
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
