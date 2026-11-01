import { useEffect, useState, type JSX } from 'react';
import { AuthProvider, useAuth } from './store/auth';
import { AppShell, type PageKey } from './layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ZonesPage } from './pages/ZonesPage';
import { SessionsPage } from './pages/SessionsPage';
import { PassesPage } from './pages/PassesPage';
import { RevenuePage } from './pages/RevenuePage';
import { ActivityPage } from './pages/ActivityPage';
import { AttendancePage } from './pages/AttendancePage';
import { ManagementPage } from './pages/ManagementPage';
import { UsersPage } from './pages/UsersPage';
import { StaffProfilePage } from './pages/StaffProfilePage';
import { GuestPage } from './pages/GuestPage';
import { EmptyState, Toasts } from './components/ui';
import { PERM_META, hasNoPerms } from './lib/perms';
import type { StaffPermissionKey } from './types';

// FE-020 S4: deep-link guard theo perms (staff gọi URL/page bị thu quyền →
// redirect Dashboard + toast tiếng Việt, cùng pattern DS-006 §1).
const PAGE_PERM: Record<PageKey, StaffPermissionKey | null> = {
  dashboard: null, // landing — luôn vào được (mất hết quyền → empty-state S4.4)
  zones: null, // admin-only (staffBlocked sẵn)
  sessions: 'checkin',
  passes: 'pass_sale',
  revenue: null, // admin-only (staffBlocked sẵn)
  management: null, // admin-only (staffBlocked sẵn, staff deep-link → landing + toast)
  activity: 'report_self',
  attendance: null, // giữ guard cũ (BE-014 không map — mọi staff chấm công được)
  users: null, // admin-only (staffBlocked sẵn)
  profile: null, // xem hồ sơ luôn được; SỬA cần profile_self (khóa trong page)
  guest: null,
};

function Root(): JSX.Element {
  const { role, perms } = useAuth();
  const [page, setPage] = useState<PageKey>('dashboard');
  const [denied, setDenied] = useState(false);
  const [deniedPerm, setDeniedPerm] = useState<StaffPermissionKey | null>(null);

  // Cross-screen rule §4: `/` focuses search, `Esc` closes topmost layer
  // (dialogs handle Esc themselves + return focus to trigger).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === '/' && !typing) {
        const search = document.getElementById('global-search');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // DS-006 §1: staff deep-linking to Nhân viên bounces to Check-in/out
  // (safePage below) — flash the spec'd warning toast once per attempt.
  // FE-020 S4: mở rộng cho page bị thu quyền theo perms → về Dashboard.
  useEffect(() => {
    if (role !== 'staff') {
      setDenied(false);
      setDeniedPerm(null);
      return undefined;
    }
    const need = PAGE_PERM[page];
    if (need && perms && perms[need] !== 1) {
      setDenied(true);
      setDeniedPerm(need);
      const t = window.setTimeout(() => { setDenied(false); setDeniedPerm(null); }, 4000);
      return () => window.clearTimeout(t);
    }
    if (page === 'users') {
      setDenied(true);
      setDeniedPerm(null);
      const t = window.setTimeout(() => { setDenied(false); setDeniedPerm(null); }, 4000);
      return () => window.clearTimeout(t);
    }
    setDenied(false);
    setDeniedPerm(null);
    return undefined;
  }, [role, page, perms]);

  if (role === null) return <LoginPage />;

  // Staff lands on Check-in/out; guest + logged-in customer get the
  // chromeless map (spec auth-flow.md §6: customer has no shell, header
  // carries name + Đăng xuất instead — see GuestPage).
  const effective: PageKey = role === 'guest' ? 'guest' : page === 'guest' && role !== 'guest' ? page : page;

  if (role === 'guest' || role === 'customer') return <GuestPage />;

  // Guard role → page access (api-contract.md §11 permission matrix).
  // DS-006: staff deep-linking to Nhân viên is bounced with a warning toast.
  // FE-011: 'activity' deliberately NOT in staffBlocked — staff sees it
  // mine_only (page forces staff_id = me.id, hides the staff filter).
  // FE-017 S1d: 'profile' NOT blocked — staff xem/sửa hồ sơ chính mình.
  // FE-019 S3: 'attendance' KHÔNG vào staffBlocked — staff chấm công
  // mine_only (page ép staff_id = me.id, ẩn filter NV + tab Định nghĩa ca).
  // FE-020 S4: thêm chặn theo perms — staff mất flag → bounce về Dashboard
  // (mất hết quyền → empty-state S4.4, xem noPerms bên dưới).
  const staffBlocked: PageKey[] = ['zones', 'revenue', 'management', 'users'];
  const permNeed = role === 'staff' ? PAGE_PERM[effective] : null;
  const permDenied = role === 'staff' && permNeed !== null && perms !== null && perms[permNeed] !== 1;
  // DS-006: bounce mặc định về Check-in/out; staff mất `checkin` → về
  // Dashboard (landing luôn vào được) thay vì màn trắng.
  const landing: PageKey = role === 'staff' && perms !== null && perms.checkin !== 1 ? 'dashboard' : 'sessions';
  const safePage: PageKey = role === 'staff' && (staffBlocked.includes(effective) || permDenied) ? landing : effective;

  // FE-020 S4.4: staff bị thu HẾT quyền → empty-state ở landing (tránh màn trắng).
  const noPerms = role === 'staff' && perms !== null && hasNoPerms(perms);

  // Guest map is always chromeless — no sidebar/topbar for any role (spec §g).
  // FE-006: admin/staff mở Sơ đồ từ nav có nút "Trở lại" → về trang shell
  // mặc định theo role (admin → dashboard, staff → sessions).
  if (safePage === 'guest') return <GuestPage onBack={() => setPage(role === 'staff' ? 'sessions' : 'dashboard')} />;

  const deniedText = deniedPerm
    ? `Bạn không có quyền ${PERM_META[deniedPerm].label} — liên hệ quản lý.`
    : 'Bạn không có quyền truy cập trang này.';

  // FE-020 S4.4: staff mất hết quyền → empty-state ở mọi page trong shell
  // (tránh màn trắng; các màn con đã bị ẩn khỏi nav).
  if (noPerms) {
    return (
      <>
        <AppShell page="dashboard" onNavigate={setPage}>
          <div className="card">
            <EmptyState
              title="Chưa được gán quyền nào"
              hint="Tài khoản của bạn chưa được gán quyền nào — liên hệ quản lý để được cấp quyền làm việc."
            />
          </div>
        </AppShell>
        {denied && <Toasts items={[{ id: 0, tone: 'danger', text: deniedText }]} />}
      </>
    );
  }

  return (
    <>
      <AppShell page={safePage} onNavigate={setPage}>
        {safePage === 'dashboard' && <DashboardPage onGoZones={() => setPage('zones')} />}
        {safePage === 'zones' && <ZonesPage />}
        {safePage === 'sessions' && <SessionsPage />}
        {safePage === 'passes' && <PassesPage />}
        {safePage === 'revenue' && <RevenuePage />}
        {safePage === 'management' && <ManagementPage onNavigate={setPage} />}
        {safePage === 'activity' && <ActivityPage />}
        {safePage === 'attendance' && <AttendancePage />}
        {safePage === 'users' && <UsersPage />}
        {safePage === 'profile' && <StaffProfilePage />}
      </AppShell>
      {/* DS-006 §1: deep-link guard toast for staff hitting Nhân viên */}
      {/* FE-020 S4: toast theo đúng quyền bị thiếu (label tiếng Việt). */}
      {denied && <Toasts items={[{ id: 0, tone: 'danger', text: deniedText }]} />}
    </>
  );
}

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
