import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { Alert, Badge, Button, Dialog, EmptyState, Field, RetryPanel, SkeletonRows, Toasts, type ToastItem } from '../components/ui';
import { callApi } from '../lib/api';
import { mockApi } from '../lib/mockApi';
import { formatDateShort, isValidVNPhone, todayLocal } from '../lib/format';
import { PERM_KEYS, PERM_META, PRESET_CASHIER, PRESET_FULL, PRESET_VIEWER, parsePermRaw } from '../lib/perms';
import { useAuth } from '../store/auth';
import type { StaffPermissions, UserDTO } from '../types';
import { StaffDrawer } from './StaffDrawer';

type Status = 'loading' | 'error' | 'ready';
type SortKey = 'username' | 'created_at';
type SortDir = 'asc' | 'desc';

interface CreateForm {
  username: string;
  full_name: string;
  password: string;
  confirm: string;
  role: 'admin' | 'staff';
}

const EMPTY_CREATE: CreateForm = { username: '', full_name: '', password: '', confirm: '', role: 'staff' };

// FE-009: edit form (users:update). Password fields stay empty = keep unchanged.
// FE-017 S1: + phone/address/start_date/notes (admin-only patch, BE-012).
interface EditForm {
  username: string;
  full_name: string;
  newPw: string;
  confirm: string;
  phone: string;
  address: string;
  start_date: string;
  notes: string;
}

const EMPTY_EDIT: EditForm = { username: '', full_name: '', newPw: '', confirm: '', phone: '', address: '', start_date: '', notes: '' };

function usernameIssue(raw: string): string | null {
  const v = raw.trim();
  if (v.length > 0 && v.length < 3) return 'Tên đăng nhập tối thiểu 3 ký tự.';
  if (/\s/.test(v)) return 'Tên đăng nhập không chứa khoảng trắng.';
  if (v.length > 0 && v.normalize('NFD').replace(/[\u0300-\u036f]/g, '') !== v) {
    return 'Tên đăng nhập không dấu (vd staff02).';
  }
  return null;
}

function isForbiddenError(err: string): boolean {
  return /FORBIDDEN/i.test(err);
}

function isDuplicateError(err: string): boolean {
  return /tồn tại|trùng|duplicate|UNIQUE/i.test(err);
}

export function UsersPage(): JSX.Element {
  const { role, userId, logout, refreshProfile, refreshMe } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'staff'>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'locked'>('all');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<10 | 20 | 50>(10);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE);
  const [dupError, setDupError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ user: UserDTO; next: 0 | 1 } | null>(null);
  const [toggling, setToggling] = useState(false);
  // FE-009: edit dialog state
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT);
  const [editDup, setEditDup] = useState<string | null>(null);
  const [editPhoneDup, setEditPhoneDup] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editTouched, setEditTouched] = useState(false); // FE-010: show required-error only after blur/submit attempt
  const [showEditPw, setShowEditPw] = useState(false);
  // FE-020 S4: section Quyền hạn — null = DB NULL = "Mặc định full" (giữ
  // nguyên như hiện tại); object = flags đã gán. Orig để tính dirty.
  const [editPerms, setEditPerms] = useState<StaffPermissions | null>(null);
  const [editPermsOrig, setEditPermsOrig] = useState<StaffPermissions | null>(null);
  const [permAnnounce, setPermAnnounce] = useState('');
  const [permError, setPermError] = useState<string | null>(null);
  // FE-017 S1: drawer hồ sơ 400px (click row / nút Eye).
  const [detail, setDetail] = useState<UserDTO | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [flashMsg, setFlashMsg] = useState('');
  const [undo, setUndo] = useState<{ id: number; prev: 0 | 1; username: string } | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const undoTimer = useRef(0);
  const flashTimer = useRef(0);

  const pushToast = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const load = useCallback(async () => {
    if (role !== 'admin') return; // route-guarded — no IPC for staff/guest
    setStatus('loading');
    setForbidden(false);
    const res = await callApi((a) => a.listUsers(), () => mockApi.listUsers());
    if (!res.ok) {
      const msg = res.error ?? 'Lỗi tải danh sách tài khoản';
      if (isForbiddenError(msg)) {
        setForbidden(true);
        setError(msg);
        setStatus('error');
        return;
      }
      setError(msg);
      setStatus('error');
      return;
    }
    setUsers(res.data ?? []);
    setStatus('ready');
  }, [role]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    window.clearTimeout(undoTimer.current);
    window.clearTimeout(flashTimer.current);
    return () => {
      window.clearTimeout(undoTimer.current);
      window.clearTimeout(flashTimer.current);
    };
  }, []);

  const activeAdminCount = useMemo(
    () => users.filter((u) => u.role_name === 'admin' && u.is_active === 1).length,
    [users],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (q && !`${u.username} ${u.full_name}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== 'all' && u.role_name !== roleFilter) return false;
      if (activeFilter === 'active' && u.is_active !== 1) return false;
      if (activeFilter === 'locked' && u.is_active !== 0) return false;
      return true;
    });
    if (sortKey === null) return filtered;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'username') return a.username.localeCompare(b.username, 'vi') * dir;
      return (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) * dir;
    });
  }, [users, query, roleFilter, activeFilter, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [query, roleFilter, activeFilter, perPage, users.length]);

  function toggleSort(key: SortKey): void {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    }
  }

  function sortProps(key: SortKey): { 'aria-sort': 'ascending' | 'descending' | 'none'; label: string } {
    if (sortKey !== key) return { 'aria-sort': 'none', label: 'Sắp xếp' };
    return sortDir === 'asc'
      ? { 'aria-sort': 'ascending', label: 'Đang tăng dần — nhấn để đảo' }
      : { 'aria-sort': 'descending', label: 'Đang giảm dần — nhấn để đảo' };
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * perPage, safePage * perPage);
  const rangeFrom = rows.length === 0 ? 0 : (safePage - 1) * perPage + 1;
  const rangeTo = Math.min(safePage * perPage, rows.length);

  // ---- route guard: non-admin never sees the table (App.tsx also redirects) ----
  if (role !== 'admin') {
    return (
      <div className="card">
        <Alert tone="danger">Phiên của bạn không còn quyền Admin — đăng nhập lại.</Alert>
        <div style={{ marginTop: 12 }}>
          <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
        </div>
      </div>
    );
  }

  function openCreate(): void {
    setForm(EMPTY_CREATE);
    setDupError(null);
    setShowPw(false);
    setCapsOn(false);
    setFormOpen(true);
  }

  const nameIssue = usernameIssue(form.username);
  const fullNameEmpty = form.full_name.trim() === '';
  const fullNameLong = form.full_name.trim().length > 100;
  const pwShort = form.password.length > 0 && form.password.length < 6;
  const confirmMismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const canSubmit =
    !saving &&
    form.username.trim().length >= 3 &&
    nameIssue === null &&
    !fullNameEmpty &&
    !fullNameLong &&
    form.password.length >= 6 &&
    form.confirm === form.password &&
    form.confirm.length > 0;

  async function handleCreate(): Promise<void> {
    if (!canSubmit) return;
    setSaving(true);
    const res = await callApi(
      (a) => a.createUser({
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        role: form.role,
      }),
      () => mockApi.createUser({
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        role: form.role,
      }),
    );
    setSaving(false);
    if (!res.ok) {
      const msg = res.error ?? 'Tạo tài khoản thất bại';
      if (isForbiddenError(msg)) {
        setForbidden(true);
        setFormOpen(false);
        pushToast('danger', 'Phiên của bạn không còn quyền Admin — đăng nhập lại.');
        return;
      }
      if (isDuplicateError(msg)) {
        setDupError('Tên đăng nhập đã tồn tại.');
        return;
      }
      pushToast('danger', msg);
      return;
    }
    const created = res.data;
    setFormOpen(false);
    setForm(EMPTY_CREATE); // clear password from memory — never shown again
    setDupError(null);
    pushToast('success', created ? `Đã tạo tài khoản ${created.username}.` : 'Đã tạo tài khoản mới.');
    if (created) {
      setFlashId(created.id);
      setFlashMsg(`Đã thêm tài khoản ${created.username} vào danh sách.`);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => { setFlashId(null); setFlashMsg(''); }, 1000);
    }
    void load();
  }

  // ---- FE-009: edit (users:update) ----
  // FE-017 S1: prefill thêm phone/address/start_date/notes.
  // FE-020 S4: prefill Quyền hạn từ `permissions` raw (NULL = Mặc định full).
  function openEdit(u: UserDTO): void {
    setEditing(u);
    setEditForm({
      username: u.username,
      full_name: u.full_name,
      newPw: '',
      confirm: '',
      phone: u.phone ?? '',
      address: u.address ?? '',
      start_date: u.start_date ?? '',
      notes: u.notes ?? '',
    });
    const parsed = parsePermRaw(u.permissions);
    setEditPerms(parsed);
    setEditPermsOrig(parsed);
    setPermAnnounce('');
    setPermError(null);
    setEditDup(null);
    setEditPhoneDup(null);
    setEditTouched(false);
    setShowEditPw(false);
  }

  const editNameIssue = usernameIssue(editForm.username);
  const editFullEmpty = editForm.full_name.trim() === '';
  const editFullLong = editForm.full_name.trim().length > 100;
  const editPwShort = editForm.newPw.length > 0 && editForm.newPw.length < 6;
  const editConfirmMismatch = editForm.confirm.length > 0 && editForm.confirm !== editForm.newPw;
  // Password change is optional: confirm required only when a new password is typed.
  const editPwIncomplete = editForm.newPw.length > 0 && editForm.confirm.length === 0;
  // FE-017 S1 validation: phone VN optional unique, start_date <= today, max lengths.
  const editPhoneTrim = editForm.phone.trim();
  const editPhoneIssue = editPhoneTrim === '' ? null : !isValidVNPhone(editPhoneTrim) ? 'Số điện thoại chưa đúng — 10 số, bắt đầu bằng 0.' : null;
  const editAddrTrim = editForm.address.trim();
  const editAddrLong = editAddrTrim.length > 255;
  const editStartTrim = editForm.start_date.trim();
  const editStartFuture = editStartTrim !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(editStartTrim) || editStartTrim > todayLocal());
  const editNotesTrim = editForm.notes.trim();
  const editNotesLong = editNotesTrim.length > 500;

  // Only send fields that actually changed (BE-005 requires ≥1 field).
  // FE-020 S4: `permissions` — null = reset về Mặc định full (DB NULL).
  const editPatch: { username?: string; full_name?: string; new_password?: string; phone?: string | null; address?: string | null; start_date?: string | null; notes?: string | null; permissions?: StaffPermissions | null } = {};
  // FE-020 S4: so sánh object (JSON) vì null ≡ full nhưng raw khác nhau.
  const permsDirty = JSON.stringify(editPerms) !== JSON.stringify(editPermsOrig);
  if (editing) {
    if (editForm.username.trim() !== editing.username) editPatch.username = editForm.username.trim();
    if (editForm.full_name.trim() !== editing.full_name) editPatch.full_name = editForm.full_name.trim();
    if (editForm.newPw.length > 0) editPatch.new_password = editForm.newPw;
    const phoneNext = editPhoneTrim === '' ? null : editPhoneTrim;
    if (phoneNext !== (editing.phone ?? null)) editPatch.phone = phoneNext;
    const addrNext = editAddrTrim === '' ? null : editAddrTrim;
    if (addrNext !== (editing.address ?? null)) editPatch.address = addrNext;
    const startNext = editStartTrim === '' ? null : editStartTrim;
    if (startNext !== (editing.start_date ?? null)) editPatch.start_date = startNext;
    const notesNext = editNotesTrim === '' ? null : editNotesTrim;
    if (notesNext !== (editing.notes ?? null)) editPatch.notes = notesNext;
    // Chỉ gửi quyền khi sửa staff khác (section ẩn với admin/self).
    if (editing.role_name === 'staff' && editing.id !== userId && permsDirty) {
      editPatch.permissions = editPerms;
    }
  }
  const editDirty = Object.keys(editPatch).length > 0;
  const canEditSave =
    editing !== null &&
    !editSaving &&
    editDirty &&
    editForm.username.trim().length >= 3 &&
    editNameIssue === null &&
    !editFullEmpty &&
    !editFullLong &&
    !editPwShort &&
    !editConfirmMismatch &&
    !editPwIncomplete &&
    editPhoneIssue === null &&
    !editAddrLong &&
    !editStartFuture &&
    !editNotesLong &&
    (editForm.newPw.length === 0 || editForm.confirm === editForm.newPw);

  async function handleEditSave(): Promise<void> {
    if (!editing || !canEditSave) return;
    setEditSaving(true);
    const target = editing;
    const wasSelf = target.id === userId;
    const oldUsername = target.username;
    const res = await callApi(
      (a) => a.updateUser(target.id, editPatch),
      () => mockApi.updateUser(target.id, editPatch),
    );
    setEditSaving(false);
    if (!res.ok) {
      const msg = res.error ?? 'Cập nhật tài khoản thất bại';
      if (isForbiddenError(msg)) {
        setForbidden(true);
        setEditing(null);
        pushToast('danger', 'Phiên của bạn không còn quyền Admin — đăng nhập lại.');
        return;
      }
      // FE-017 S1: SĐT trùng → inline dưới ô SĐT; username trùng → dưới ô username.
      const fieldPhone = res.fields?.phone ?? '';
      if (/SĐT đã được dùng|UNIQUE.*phone/i.test(`${msg} ${fieldPhone}`)) {
        setEditPhoneDup('SĐT đã được dùng.');
        return;
      }
      if (isDuplicateError(msg)) {
        setEditDup('Tên đăng nhập đã tồn tại.');
        return;
      }
      // Field-level errors từ backend (ValidationError) → inline nếu map được.
      if (res.fields?.phone) { setEditPhoneDup(res.fields.phone); return; }
      // FE-020 S4: lỗi whitelist quyền → inline dưới section Quyền hạn.
      if (res.fields?.permissions) { setPermError(res.fields.permissions); return; }
      pushToast('danger', msg);
      return;
    }
    const updated = res.data;
    const newUsername = updated ? updated.username : editForm.username.trim();
    setEditing(null);
    setEditForm(EMPTY_EDIT); // clear password from memory — never shown again
    setEditDup(null);
    setPermError(null);
    if (wasSelf) {
      // Sidebar shows full_name; username change takes effect at next login.
      if (updated) refreshProfile(updated.full_name);
      // FE-020 S4 edge: admin sửa đúng phiên đang login → refresh auth:me
      // để perms mới áp dụng ngay (không bắt đăng nhập lại).
      if (updated && updated.perms) void refreshMe();
      const renamed = newUsername !== oldUsername;
      pushToast('success', renamed
        ? `Đã cập nhật tài khoản ${newUsername}. Tên đăng nhập mới dùng từ lần đăng nhập sau.`
        : `Đã cập nhật tài khoản ${newUsername}.`);
    } else {
      pushToast('success', permsDirty
        ? `Đã cập nhật quyền cho ${newUsername}.`
        : `Đã cập nhật tài khoản ${newUsername}.`);
    }
    if (updated) {
      setFlashId(updated.id);
      setFlashMsg(`Đã cập nhật tài khoản ${updated.username}.`);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => { setFlashId(null); setFlashMsg(''); }, 1000);
    }
    void load();
  }

  async function handleToggle(): Promise<void> {
    if (!confirm || toggling) return;
    if (confirm.next === 0 && confirm.user.role_name === 'admin' && activeAdminCount <= 1) return;
    setToggling(true);
    const res = await callApi(
      (a) => a.toggleUserActive(confirm.user.id, confirm.next),
      () => mockApi.toggleUserActive(confirm.user.id, confirm.next),
    );
    setToggling(false);
    if (!res.ok) {
      const msg = res.error ?? 'Đổi trạng thái thất bại';
      if (isForbiddenError(msg)) setForbidden(true);
      pushToast('danger', msg);
      return;
    }
    const { user, next } = confirm;
    setConfirm(null);
    if (next === 0) {
      setUndo({ id: user.id, prev: 1, username: user.username });
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
      pushToast('success', `Đã khóa tài khoản ${user.username}.`);
    } else {
      setUndo(null);
      pushToast('success', `Đã mở khóa tài khoản ${user.username}.`);
    }
    void load();
  }

  async function handleUndo(): Promise<void> {
    if (!undo) return;
    const target = undo;
    setUndo(null);
    window.clearTimeout(undoTimer.current);
    const res = await callApi(
      (a) => a.toggleUserActive(target.id, target.prev),
      () => mockApi.toggleUserActive(target.id, target.prev),
    );
    if (!res.ok) {
      pushToast('danger', res.error ?? 'Hoàn tác thất bại');
      return;
    }
    pushToast('success', `Đã hoàn tác — mở lại tài khoản ${target.username}.`);
    void load();
  }

  if (status === 'loading') {
    return <div className="card" aria-busy="true" aria-label="Đang tải tài khoản"><SkeletonRows rows={8} /></div>;
  }

  if (status === 'error') {
    return (
      <div className="card">
        {forbidden ? (
          <div>
            <Alert tone="danger">Phiên của bạn không còn quyền Admin — đăng nhập lại.</Alert>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Button variant="neutral" onClick={logout}>Đăng nhập lại</Button>
              <Button variant="neutral" onClick={() => void load()}>Tải lại</Button>
            </div>
          </div>
        ) : (
          <RetryPanel message={error} onRetry={() => void load()} />
        )}
      </div>
    );
  }

  const confirmIsSelf = confirm !== null && confirm.user.id === userId;
  const confirmLastAdmin =
    confirm !== null &&
    confirm.next === 0 &&
    confirm.user.role_name === 'admin' &&
    confirm.user.is_active === 1 &&
    activeAdminCount <= 1;
  const showOnlyMine = users.length === 1 && query.trim() === '' && roleFilter === 'all' && activeFilter === 'all';

  return (
    <div>
      <div className="sr-only" aria-live="polite">{flashMsg}</div>
      {forbidden && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">Phiên của bạn không còn quyền Admin — đăng nhập lại.</Alert>
        </div>
      )}
      <div className="toolbar" role="search">
        <label className="sr-only" htmlFor="global-search">Tìm tài khoản</label>
        <input
          id="global-search"
          className="input search-input"
          style={{ width: 240 }}
          placeholder="Tìm tên đăng nhập, họ tên…  ( / )"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" style={{ width: 160 }} aria-label="Lọc vai trò" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}>
          <option value="all">Tất cả vai trò</option>
          <option value="admin">Admin</option>
          <option value="staff">Nhân viên</option>
        </select>
        <select className="select" style={{ width: 160 }} aria-label="Lọc trạng thái" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
          <option value="all">Mọi trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="locked">Bị khóa</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={openCreate}><Plus size={16} strokeWidth={2} aria-hidden="true" /> Thêm nhân viên</button>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          {showOnlyMine ? (
            <EmptyState
              title="Chưa có tài khoản nhân viên nào"
              hint="Cần đổi vai trò? Hiện chỉ hỗ trợ Khóa + tạo mới."
              action={<button className="btn btn-primary" onClick={openCreate}>Thêm nhân viên đầu tiên</button>}
            />
          ) : (
            <EmptyState
              title="Không tìm thấy tài khoản"
              hint="Thử từ khóa khác hoặc xóa bộ lọc đang áp dụng. Cần đổi vai trò? Hiện chỉ hỗ trợ Khóa + tạo mới."
              action={<button className="btn btn-neutral" onClick={() => { setQuery(''); setRoleFilter('all'); setActiveFilter('all'); }}>Xóa bộ lọc</button>}
            />
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col" aria-sort={sortProps('username')['aria-sort']}>
                  <button type="button" className="th-sort" aria-label={`Tên đăng nhập — ${sortProps('username').label}`} onClick={() => toggleSort('username')}>
                    Tên đăng nhập{sortKey === 'username' ? (sortDir === 'asc' ? <ChevronUp size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />) : null}
                  </button>
                </th>
                <th scope="col">Họ tên</th>
                {/* FE-017 S1a: + cột SĐT sau Họ tên (mono 14). address/start_date/notes xem ở drawer. */}
                <th scope="col">SĐT</th>
                <th scope="col">Vai trò</th>
                <th scope="col">Trạng thái</th>
                <th scope="col" aria-sort={sortProps('created_at')['aria-sort']}>
                  <button type="button" className="th-sort" aria-label={`Ngày tạo — ${sortProps('created_at').label}`} onClick={() => toggleSort('created_at')}>
                    Ngày tạo{sortKey === 'created_at' ? (sortDir === 'asc' ? <ChevronUp size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />) : null}
                  </button>
                </th>
                <th scope="col"><span className="sr-only">Hành động</span></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => {
                const isSelf = u.id === userId;
                const active = u.is_active === 1;
                return (
                  <tr
                    key={u.id}
                    className={u.id === flashId ? 'row-flash' : undefined}
                    onClick={() => setDetail(u)}
                    style={{ cursor: 'pointer' }}
                    title={`Xem hồ sơ ${u.username}`}
                  >
                    <td><span className="mono" style={{ fontSize: 14 }}>{u.username}</span></td>
                    <td>
                      <strong style={{ fontSize: 16, fontWeight: 500 }}>{u.full_name}</strong>
                      {isSelf && <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}> (bạn)</span>}
                    </td>
                    <td>{u.phone ? <span className="mono" style={{ fontSize: 14 }}>{u.phone}</span> : <span style={{ fontSize: 12, color: 'var(--color-text-60)' }}>—</span>}</td>
                    <td>{u.role_name === 'admin' ? <Badge tone="primary">Admin</Badge> : <Badge tone="secondary">Nhân viên</Badge>}</td>
                    <td>
                      {active ? (
                        <Badge tone="success">Hoạt động</Badge>
                      ) : (
                        <Badge tone="danger"><Lock size={12} strokeWidth={2} aria-hidden="true" /> Bị khóa</Badge>
                      )}
                    </td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{formatDateShort(u.created_at.slice(0, 10))}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {/* FE-017 S1b: nút Eye mở drawer hồ sơ (pattern §e vé tháng). */}
                      <button
                        className="icon-btn"
                        title="Xem hồ sơ"
                        aria-label={`Xem hồ sơ ${u.username}`}
                        onClick={() => setDetail(u)}
                      >
                        <Eye size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        title="Sửa tài khoản"
                        aria-label={`Sửa tài khoản ${u.username}`}
                        onClick={() => openEdit(u)}
                      >
                        <Pencil size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        title={active ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                        aria-label={`${active ? 'Khóa' : 'Mở khóa'} tài khoản ${u.username}`}
                        disabled={isSelf}
                        onClick={() => setConfirm({ user: u, next: active ? 0 : 1 })}
                      >
                        {active
                          ? <Lock size={16} strokeWidth={2} aria-hidden="true" />
                          : <LockOpen size={16} strokeWidth={2} aria-hidden="true" />}
                      </button>
                      {isSelf && <span className="sr-only">Không thể tự khóa chính mình</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="pager" aria-label="Phân trang">
          <span className="mono" style={{ fontSize: 12 }}>Hiển thị {rangeFrom}–{rangeTo} / {rows.length} tài khoản</span>
          <span className="spacer" />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
            Số dòng
            <select className="select" style={{ width: 90, height: 32 }} aria-label="Số dòng mỗi trang" value={perPage} onChange={(e) => setPerPage(Number(e.target.value) as 10 | 20 | 50)}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
          <button className="btn btn-neutral btn-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Trang trước">‹ Trước</button>
          <span className="mono" style={{ fontSize: 12 }} aria-live="polite">Trang {safePage}/{totalPages}</span>
          <button className="btn btn-neutral btn-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Trang sau">Sau ›</button>
        </div>
      )}

      {formOpen && (
        <Dialog title="Thêm nhân viên" onClose={() => { if (!saving) setFormOpen(false); }}>
          <Field
            label="Tên đăng nhập *"
            value={form.username}
            autoComplete="username"
            onChange={(e) => { setForm((f) => ({ ...f, username: e.target.value })); setDupError(null); }}
            hint="≥3 ký tự, duy nhất, không dấu (vd staff02)"
            error={dupError ?? nameIssue ?? undefined}
          />
          <Field
            label="Họ tên *"
            value={form.full_name}
            autoComplete="name"
            maxLength={100}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            error={fullNameEmpty ? undefined : fullNameLong ? 'Họ tên tối đa 100 ký tự.' : undefined}
          />
          {fullNameEmpty && <span className="field-error" style={{ marginTop: -8, marginBottom: 8, display: 'block' }}>Họ tên là bắt buộc.</span>}
          <div className="field">
            <label htmlFor="new-user-pw">Mật khẩu *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="new-user-pw"
                className="input"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                autoComplete="new-password"
                aria-invalid={pwShort}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                onKeyUp={(e) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)}
              />
              <button type="button" className="btn btn-neutral" aria-pressed={showPw} onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                {showPw ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
              </button>
            </div>
            {capsOn && <span className="field-hint caps-hint"><TriangleAlert size={16} strokeWidth={2} aria-hidden="true" /> Caps-Lock đang bật</span>}
            {pwShort
              ? <span className="field-error">Mật khẩu tối thiểu 6 ký tự.</span>
              : <span className="field-hint">≥6 ký tự — cấp cho nhân viên và yêu cầu đổi sau bàn giao.{form.password.length > 0 && form.password.length < 8 ? ' (Mật khẩu yếu)' : ''}</span>}
          </div>
          <div className="field">
            <label htmlFor="new-user-pw2">Xác nhận mật khẩu *</label>
            <input
              id="new-user-pw2"
              className="input"
              type={showPw ? 'text' : 'password'}
              value={form.confirm}
              autoComplete="new-password"
              aria-invalid={confirmMismatch}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
              onKeyUp={(e) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)}
            />
            {confirmMismatch && <span className="field-error">Mật khẩu xác nhận chưa khớp.</span>}
          </div>
          <div className="field">
            <label id="new-user-role">Vai trò</label>
            <div className="seg" role="group" aria-labelledby="new-user-role">
              {(['staff', 'admin'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={form.role === r} onClick={() => setForm((f) => ({ ...f, role: r }))}>
                  {r === 'staff' ? 'Nhân viên' : 'Admin'}
                </button>
              ))}
            </div>
          </div>
          {form.role === 'admin' && (
            <Alert tone="warning">Tài khoản Admin có toàn quyền (giá, báo cáo, khóa tài khoản). Chỉ cấp cho người quản lý.</Alert>
          )}
          <div className="dialog-foot">
            <button className="btn btn-neutral" disabled={saving} onClick={() => setFormOpen(false)}>Hủy</button>
            <Button onClick={() => void handleCreate()} disabled={!canSubmit} aria-busy={saving}>
              {saving ? 'Đang tạo…' : form.role === 'admin' ? 'Tạo tài khoản Admin' : 'Tạo tài khoản'}
            </Button>
          </div>
        </Dialog>
      )}

      {editing && (
        <Dialog title={`Sửa hồ sơ ${editing.username}`} onClose={() => { if (!editSaving) setEditing(null); }} wide>
          <Field
            label="Tên đăng nhập *"
            value={editForm.username}
            autoComplete="username"
            onChange={(e) => { setEditForm((f) => ({ ...f, username: e.target.value })); setEditDup(null); }}
            hint="≥3 ký tự, duy nhất, không dấu (vd staff02)"
            error={editDup ?? editNameIssue ?? undefined}
          />
          <Field
            label="Họ tên *"
            value={editForm.full_name}
            autoComplete="name"
            maxLength={100}
            onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
            onBlur={() => setEditTouched(true)}
            error={editFullEmpty ? undefined : editFullLong ? 'Họ tên tối đa 100 ký tự.' : undefined}
          />
          {editTouched && editFullEmpty && <span className="field-error" style={{ marginTop: -8, marginBottom: 8, display: 'block' }}>Họ tên là bắt buộc.</span>}
          {/* FE-017 S1c: 2-column grid SĐT + Ngày vào làm; full-width Địa chỉ + Ghi chú. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="edit-user-phone">SĐT</label>
              <input
                id="edit-user-phone"
                className="input mono"
                style={{ fontSize: 14 }}
                inputMode="tel"
                placeholder="09… (trống = chưa có)"
                value={editForm.phone}
                aria-invalid={Boolean(editPhoneIssue ?? editPhoneDup)}
                aria-describedby={editPhoneIssue ?? editPhoneDup ? 'edit-phone-desc' : undefined}
                onChange={(e) => { setEditForm((f) => ({ ...f, phone: e.target.value })); setEditPhoneDup(null); }}
              />
              {(editPhoneDup ?? editPhoneIssue) && <span id="edit-phone-desc" className="field-error">{editPhoneDup ?? editPhoneIssue}</span>}
            </div>
            <div className="field">
              <label htmlFor="edit-user-start">Ngày vào làm</label>
              <input
                id="edit-user-start"
                className="input"
                type="date"
                value={editStartTrim}
                max={todayLocal()}
                aria-invalid={editStartFuture}
                onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
              />
              {editStartFuture && <span className="field-error">Ngày vào làm không thể là tương lai.</span>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-user-addr">Địa chỉ</label>
            <input
              id="edit-user-addr"
              className="input"
              placeholder="Trống = chưa có"
              value={editForm.address}
              maxLength={256}
              aria-invalid={editAddrLong}
              onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
            />
            {editAddrLong && <span className="field-error">Địa chỉ tối đa 255 ký tự.</span>}
          </div>
          <div className="field">
            <label htmlFor="edit-user-notes">Ghi chú nội bộ</label>
            <textarea
              id="edit-user-notes"
              className="textarea"
              rows={3}
              placeholder="Chỉ admin thấy — kỷ luật, bàn giao… (trống = không có)"
              value={editForm.notes}
              aria-describedby="edit-notes-count"
              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
            />
            <span id="edit-notes-count" className={editNotesLong ? 'field-error' : 'field-hint'} aria-live="off">
              {editNotesTrim.length}/500{editNotesLong ? ' — Ghi chú tối đa 500 ký tự.' : ''}
            </span>
          </div>
          {/* FE-020 S4.2: section Quyền hạn — chỉ khi sửa staff khác
              (sửa admin → ẩn + note; tự sửa → ẩn theo spec S4.4). */}
          {editing.role_name === 'staff' && editing.id !== userId && (
            <div className="field" aria-labelledby="edit-perms-heading">
              <span id="edit-perms-heading" style={{ fontSize: 14, fontWeight: 500, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                Quyền hạn
                {editPerms === null && <Badge tone="primary">Mặc định full</Badge>}
              </span>
              <span className="field-hint" style={{ display: 'block', marginBottom: 8 }}>
                Mặc định nhân viên có đủ 5 quyền (giữ nguyên như hiện tại). Tắt quyền sẽ ẩn menu tương ứng ở máy họ.
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }} role="group" aria-label="Mẫu quyền nhanh">
                <button type="button" className="btn btn-neutral btn-sm" onClick={() => { setEditPerms({ ...PRESET_FULL }); setPermError(null); setPermAnnounce('Đã chọn mẫu Full — đủ 5 quyền.'); }}>Full</button>
                <button type="button" className="btn btn-neutral btn-sm" onClick={() => { setEditPerms({ ...PRESET_CASHIER }); setPermError(null); setPermAnnounce('Đã chọn mẫu Thu ngân cơ bản.'); }}>Thu ngân cơ bản</button>
                <button type="button" className="btn btn-neutral btn-sm" onClick={() => { setEditPerms({ ...PRESET_VIEWER }); setPermError(null); setPermAnnounce('Đã chọn mẫu Chỉ xem.'); }}>Chỉ xem</button>
                {editPerms !== null && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditPerms(null); setPermError(null); setPermAnnounce('Đã khôi phục Mặc định full.'); }}>Khôi phục mặc định</button>
                )}
              </div>
              <div className="sr-only" aria-live="polite">{permAnnounce}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PERM_KEYS.map((key) => {
                  const resolved = editPerms ?? { checkin: 1 as const, pass_sale: 1 as const, report_self: 1 as const, profile_self: 1 as const, reservation: 1 as const };
                  const on = resolved[key] === 1;
                  const meta = PERM_META[key];
                  return (
                    <div key={key} className="perm-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{meta.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-60)' }}>{meta.desc}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={meta.label}
                        className={`switch${on ? ' on' : ''}`}
                        onClick={() => {
                          setEditPerms((prev) => {
                            const base = prev ?? { checkin: 1 as const, pass_sale: 1 as const, report_self: 1 as const, profile_self: 1 as const, reservation: 1 as const };
                            return { ...base, [key]: base[key] === 1 ? 0 : 1 };
                          });
                          setPermError(null);
                          setPermAnnounce(`${meta.label}: ${on ? 'đã tắt' : 'đã bật'}.`);
                        }}
                      >
                        <span className="switch-knob" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const orig = editPermsOrig ?? { checkin: 1 as const, pass_sale: 1 as const, report_self: 1 as const, profile_self: 1 as const, reservation: 1 as const };
                const cur = editPerms ?? { checkin: 1 as const, pass_sale: 1 as const, report_self: 1 as const, profile_self: 1 as const, reservation: 1 as const };
                const removed = PERM_KEYS.filter((k) => orig[k] === 1 && cur[k] !== 1);
                if (removed.length === 0) return null;
                return (
                  <div style={{ marginTop: 8 }}>
                    <Alert tone="warning">
                      Đang tắt: {removed.map((k) => PERM_META[k].label).join(', ')}. Menu tương ứng sẽ bị ẩn; nếu họ đang online máy khác, phiên của họ hết hiệu lực ở thao tác tiếp theo và quyền mới áp dụng.
                    </Alert>
                  </div>
                );
              })()}
              {permError && <span className="field-error" role="alert">{permError}</span>}
            </div>
          )}
          {editing.role_name === 'admin' && (
            <Alert tone="warning">Admin luôn full quyền — không gán flags riêng.</Alert>
          )}
          <div className="field">
            <span id="edit-pw-heading" style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>Đặt lại mật khẩu</span>
            <span className="field-hint" style={{ display: 'block', marginBottom: 8 }}>Bỏ trống nếu không đổi — không thể xem lại mật khẩu cũ.</span>
            <label htmlFor="edit-user-pw">Mật khẩu mới</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                id="edit-user-pw"
                className="input"
                type={showEditPw ? 'text' : 'password'}
                value={editForm.newPw}
                autoComplete="new-password"
                aria-invalid={editPwShort}
                onChange={(e) => setEditForm((f) => ({ ...f, newPw: e.target.value }))}
              />
              <button type="button" className="btn btn-neutral" aria-pressed={showEditPw} onClick={() => setShowEditPw((v) => !v)} aria-label={showEditPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                {showEditPw ? <EyeOff size={16} strokeWidth={2} aria-hidden="true" /> : <Eye size={16} strokeWidth={2} aria-hidden="true" />}
              </button>
            </div>
            {editPwShort
              ? <span className="field-error">Mật khẩu tối thiểu 6 ký tự.</span>
              : editForm.newPw.length > 0 && editForm.newPw.length < 8
                ? <span className="field-hint">Mật khẩu yếu (dưới 8 ký tự) — vẫn lưu được.</span>
                : null}
          </div>
          <div className="field">
            <label htmlFor="edit-user-pw2">Xác nhận mật khẩu mới</label>
            <input
              id="edit-user-pw2"
              className="input"
              type={showEditPw ? 'text' : 'password'}
              value={editForm.confirm}
              autoComplete="new-password"
              aria-invalid={editConfirmMismatch || editPwIncomplete}
              onChange={(e) => setEditForm((f) => ({ ...f, confirm: e.target.value }))}
            />
            {editConfirmMismatch && <span className="field-error">Mật khẩu xác nhận chưa khớp.</span>}
          </div>
          {!editDirty && !editSaving && (
            <Alert tone="warning">Chưa có thay đổi nào — sửa tên, họ tên, SĐT, địa chỉ, ngày vào làm, ghi chú hoặc nhập mật khẩu mới để lưu.</Alert>
          )}
          <div className="dialog-foot">
            <button className="btn btn-neutral" disabled={editSaving} onClick={() => setEditing(null)}>Hủy</button>
            <Button onClick={() => void handleEditSave()} disabled={!canEditSave} aria-busy={editSaving}>
              {editSaving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
          </div>
        </Dialog>
      )}

      {confirm && (
        <Dialog
          title={confirm.next === 0 ? `Khóa tài khoản ${confirm.user.username}?` : `Mở khóa tài khoản ${confirm.user.username}?`}
          onClose={() => { if (!toggling) setConfirm(null); }}
          label={confirm.next === 0 ? 'Xác nhận khóa tài khoản' : 'Xác nhận mở khóa tài khoản'}
        >
          {confirm.next === 0 ? (
            <div>
              <p style={{ fontSize: 14, marginTop: 0 }}>
                Tài khoản bị khóa sẽ không đăng nhập được nữa. Lịch sử check-in/thu phí của tài khoản được giữ nguyên.
              </p>
              <Alert tone="warning">Nếu tài khoản đang đăng nhập trên máy khác, phiên của họ sẽ hết hiệu lực ở thao tác tiếp theo.</Alert>
              {confirmIsSelf && <div style={{ marginTop: 8 }}><Alert tone="danger">Không thể tự khóa chính mình.</Alert></div>}
              {confirmLastAdmin && (
                <div style={{ marginTop: 8 }}>
                  <Alert tone="danger" role="alert">Không thể khóa — đây là tài khoản Admin hoạt động cuối cùng.</Alert>
                </div>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 14, marginTop: 0 }}>Tài khoản sẽ đăng nhập lại bình thường sau khi mở khóa.</p>
          )}
          <div className="dialog-foot" aria-describedby={confirmLastAdmin ? 'last-admin-guard' : undefined}>
            {confirmLastAdmin && <span id="last-admin-guard" className="sr-only">Không thể khóa — đây là tài khoản Admin hoạt động cuối cùng</span>}
            <button className="btn btn-neutral" disabled={toggling} onClick={() => setConfirm(null)}>Hủy</button>
            {confirm.next === 0 ? (
              <button className="btn btn-danger" disabled={toggling || confirmIsSelf || confirmLastAdmin} aria-busy={toggling} onClick={() => void handleToggle()}>
                {toggling ? 'Đang khóa…' : 'Khóa tài khoản'}
              </button>
            ) : (
              <Button disabled={toggling} aria-busy={toggling} onClick={() => void handleToggle()}>
                {toggling ? 'Đang mở…' : 'Mở khóa'}
              </Button>
            )}
          </div>
        </Dialog>
      )}

      {detail && (
        <StaffDrawer
          user={detail}
          isSelf={detail.id === userId}
          showNotes
          onClose={() => setDetail(null)}
          onEdit={() => { const u = detail; setDetail(null); openEdit(u); }}
          toggleLabel={detail.is_active === 1 ? 'Khóa' : 'Mở khóa'}
          onToggle={() => { const u = detail; setDetail(null); setConfirm({ user: u, next: u.is_active === 1 ? 0 : 1 }); }}
        />
      )}

      {undo && (
        <div className="toasts" aria-live="polite">
          <div className="toast" role="status" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>Đã khóa {undo.username}.</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void handleUndo()}>Hoàn tác</button>
          </div>
        </div>
      )}

      <Toasts items={toasts} />
    </div>
  );
}
