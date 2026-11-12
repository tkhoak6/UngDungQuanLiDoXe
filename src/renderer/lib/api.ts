// Renderer API adapter — UI talks method-style; this module routes to the
// REAL Electron bridge (window.api.invoke, see src/preload/index.ts +
// src/shared/types.ts ApiMap) when present, else falls back to the mock
// (browser `vite` dev or backend not yet wired).
//
// IMPORTANT: this file must NOT `declare global Window.api` — preload already
// declares it as ParkingApi. We access it structurally to avoid conflicts.

import type { ApiMap, IpcChannel, VehicleType } from '../../shared/types';
import type {
  ActivityListInput,
  ActivityRow,
  AppConfigSetInput,
  Attendance,
  AttendanceCheckInInput,
  AttendanceCheckOutInput,
  AttendanceCheckOutOutput,
  AttendanceListInput,
  AttendanceListOutput,
  AttendanceRow,
  AttendanceStatus,
  AttendanceTodayOutput,
  BackupNowInput,
  BackupNowOutput,
  CheckInInput,
  CheckOutInput,
  CustomerPassRequestInput,
  CustomerReservationsInput,
  CustomerReservationsOutput,
  CustomerReserveInput,
  CustomerSessionsInput,
  CustomerSessionsOutput,
  CustomerVehiclesOutput,
  DashboardSummary,
  FeePreview,
  MonthlyPass,
  NotifyEvent,
  NotifyTestOutput,
  ParkingSession,
  ParkingSettings,
  ParkingZone,
  PassConfirmInput,
  PaymentMethod,
  PbStatus,
  PbTestResult,
  Reservation,
  RestoreFromFileInput,
  RestoreFromFileOutput,
  Shift,
  ShiftCode,
  ShiftUpdateInput,
  StaffPermissions,
  StaffPermissionsInput,
  StaffProfileUpdateInput,
  StaffSelfProfile,
  TxListInput,
  TxListOutput,
  UserDTO,
} from '../types';
import { STAFF_DEFAULTS } from '../types';
import { friendlyPermError } from './perms';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  // Field-level server errors (first message per field) — mapped from
  // IpcResult.errors (ValidationError). Pages render these inline under the
  // matching field instead of a generic banner (spec customer-area.md P1.4).
  fields?: Record<string, string>;
}

export interface CreatePassInput {
  customer_name: string;
  customer_phone: string;
  license_plate: string;
  vehicle_type: VehicleType;
  zone_id: number | null;
  months: 1 | 3 | 6 | 12;
  start_date: string;
}

export interface AuthUser {
  userId: number;
  fullName: string;
  role: 'admin' | 'staff' | 'customer';
  // FE-020 S4: resolved perms (login/me trả kèm — nav ẩn theo perms, KHÔNG parse lại).
  perms: StaffPermissions;
}

export interface RegisterInput {
  full_name: string;
  phone: string;
  password: string;
}

export interface RendererApi {
  // FE-026 (nối BE-023 remember-me): login thêm `remember?` → server trả
  // `remember_token` 1 lần duy nhất (kèm trong data). Caller cất kho và
  // dùng `resume` ở lần mở app sau. Không remember = flow cũ, không đổi.
  login(username: string, password: string, remember?: boolean): Promise<ApiResult<AuthUser & { rememberToken?: string }>>;
  // FE-026: mở app → token cũ → session mới + token đã xoay (cất đè token mới).
  resume(token: string): Promise<ApiResult<AuthUser & { rememberToken: string }>>;
  // FE-012 (BE-007): public customer self-registration. No auto-login —
  // caller must call login(phone, password) after success.
  register(input: RegisterInput): Promise<ApiResult<{ userId: number; fullName: string }>>;
  listZones(): Promise<ApiResult<ParkingZone[]>>;
  createZone(input: Omit<ParkingZone, 'id' | 'created_at' | 'updated_at'>): Promise<ApiResult<ParkingZone>>;
  updateZone(id: number, patch: Partial<ParkingZone>): Promise<ApiResult<ParkingZone>>;
  deleteZone(id: number): Promise<ApiResult<void>>;
  zoneAvailability(): Promise<ApiResult<import('../types').ZoneAvailability[]>>;
  spotMap(zoneId: number): Promise<ApiResult<import('../types').SpotMapCell[]>>;
  checkIn(input: CheckInInput): Promise<ApiResult<ParkingSession>>;
  findParked(ticketOrPlate: string): Promise<ApiResult<ParkingSession[]>>;
  checkOut(input: CheckOutInput): Promise<ApiResult<{ session: ParkingSession; amount: number }>>;
  listPasses(): Promise<ApiResult<MonthlyPass[]>>;
  createPass(input: CreatePassInput): Promise<ApiResult<MonthlyPass>>;
  renewPass(passCode: string, months: 1 | 3 | 6 | 12): Promise<ApiResult<MonthlyPass>>;
  cancelPass(passCode: string, reason: string): Promise<ApiResult<void>>;
  revenue(from: string, to: string): Promise<ApiResult<{ daily: import('../types').RevenueDaily[]; sessions: import('../types').SessionsDaily[] }>>;
  dashboard(): Promise<ApiResult<DashboardSummary>>;
  previewFee(ticketCode: string, discountAmount?: number): Promise<ApiResult<FeePreview>>;
  // FE-026: logout kèm token remember-me đang giữ để main thu hồi
  // (không gửi = chỉ xóa session memory như cũ). Fire-and-forget ở store.
  logout(token?: string): Promise<ApiResult<void>>;
  currentUser(): Promise<ApiResult<AuthUser | null>>;
  listUsers(): Promise<ApiResult<UserDTO[]>>;
  createUser(input: { username: string; password: string; full_name: string; role: 'admin' | 'staff' }): Promise<ApiResult<UserDTO>>;
  toggleUserActive(id: number, isActive: 0 | 1): Promise<ApiResult<UserDTO>>;
  // FE-017 S1 (nối BE-012 users:update mở rộng + users:profile*) + FE-020 S4
  // (patch `permissions`: object 5 flags | null = reset full; backend whitelist).
  updateUser(id: number, patch: { username?: string; full_name?: string; new_password?: string; phone?: string | null; address?: string | null; start_date?: string | null; notes?: string | null; permissions?: StaffPermissionsInput | string | null }): Promise<ApiResult<UserDTO>>;
  // FE-020 S4: đọc lại session hiện tại (auth:me raw → UserDTO kèm perms) —
  // dùng sau khi admin sửa quyền (edge: sửa đúng phiên đang login).
  meFull(): Promise<ApiResult<UserDTO>>;
  // FE-017 S1: hồ sơ chính mình cho staff (users:profile — KHÔNG có notes).
  staffProfile(): Promise<ApiResult<import('../types').StaffSelfProfile>>;
  updateStaffProfile(patch: import('../types').StaffProfileUpdateInput): Promise<ApiResult<import('../types').StaffSelfProfile>>;
  recentActivity(limit: number): Promise<ApiResult<Array<{ id: number; text: string; at: string }>>>;
  parkedSessions(): Promise<ApiResult<ParkingSession[]>>;
  listActivity(input: ActivityListInput): Promise<ApiResult<{ rows: ActivityRow[]; total: number }>>;
  // Customer area P1/P2 (spec ./specs/customer-area.md, nối BE-008).
  // myProfile = auth:me raw (kèm SĐT read-only cho card Hồ sơ).
  // updateProfile = IPC users:update với {id = me.id, full_name?, new_password? +
  // current_password?} — backend verify pass hiện tại, SĐT cấm đổi server-side.
  myProfile(): Promise<ApiResult<UserDTO>>;
  updateProfile(id: number, patch: { full_name?: string; new_password?: string; current_password?: string }): Promise<ApiResult<UserDTO>>;
  customerVehicles(): Promise<ApiResult<CustomerVehiclesOutput>>;
  customerSessions(input: CustomerSessionsInput): Promise<ApiResult<CustomerSessionsOutput>>;
  // Customer area P3 (spec customer-area.md §P3, nối BE-009): đăng ký vé trước,
  // trả tiền tại quầy. Vé mới luôn 'pending' — KHÔNG miễn phí check-in.
  requestPass(input: CustomerPassRequestInput): Promise<ApiResult<MonthlyPass>>;
  // Staff duyệt pending trong màn Vé tháng (passes:confirm: pending → active +
  // INSERT payments, hoặc pending → cancelled). payment_method default 'cash'.
  confirmPass(input: PassConfirmInput): Promise<ApiResult<MonthlyPass>>;
  // Vé pending của chính mình (badge "Chờ xác nhận" ở Xe của tôi / Hồ sơ).
  // Backend thật: IPC `customer:passes` mine-only (BE-010) — không còn
  // workaround localStorage. Mock (browser dev) lọc thẳng passes[] mine-only.
  myPendingPasses(): Promise<ApiResult<MonthlyPass[]>>;
  // Customer area P4 (spec customer-area.md §P4, nối BE-011): giữ chỗ trong
  // ngày, quota ≤ 2 pending/ngày (backend COUNT + client chặn mềm ở form).
  reserve(input: CustomerReserveInput): Promise<ApiResult<Reservation>>;
  myReservations(input?: CustomerReservationsInput): Promise<ApiResult<CustomerReservationsOutput>>;
  cancelReservation(code: string): Promise<ApiResult<Reservation>>;
  // Staff area S3 (spec staff-area.md §S3, nối BE-013): ca + chấm công.
  // staff KHÔNG bao giờ gửi staff_id (chấm hộ là admin-only, UI này không
  // có luồng đó — backend ép me.id).
  listShifts(): Promise<ApiResult<Shift[]>>;
  updateShift(id: number, patch: Omit<ShiftUpdateInput, 'id'>): Promise<ApiResult<Shift>>;
  attendanceToday(): Promise<ApiResult<AttendanceTodayOutput>>;
  checkInShift(input: AttendanceCheckInInput): Promise<ApiResult<Attendance>>;
  checkOutShift(input: AttendanceCheckOutInput): Promise<ApiResult<AttendanceCheckOutOutput>>;
  listAttendance(input: AttendanceListInput): Promise<ApiResult<AttendanceListOutput>>;
  // Management area M1 (nối BE-015 `reports:transactions`, admin-only):
  // detail từng giao dịch thu phí theo paid_at (tab Chi tiết + Excel).
  // Tab Tổng hợp tái dùng revenue() (2 views §10, gọi 2 lần cho kỳ A/B).
  listTransactions(input: TxListInput): Promise<ApiResult<TxListOutput>>;
  // Management area M2 (nối BE-015 `app-config:get/set`, admin-only):
  // settings bãi + quy tắc phí (file JSON cạnh DB, cache localStorage).
  // Logo KHÔNG nhận binary từ renderer — dataURL PNG/JPG ≤512KB.
  getAppConfig(): Promise<ApiResult<ParkingSettings>>;
  setAppConfig(patch: AppConfigSetInput['patch']): Promise<ApiResult<ParkingSettings>>;
  // PocketBase online (nối BE-016 `pb:test` + BE-017 `pb:status`): test tạm
  // (KHÔNG lưu URL — lưu qua setAppConfig {pb_url}) + badge trạng thái.
  // `pb:status` guard none để render badge offline; `pb:test` admin-only.
  pbStatus(): Promise<ApiResult<PbStatus>>;
  testPbConnection(url?: string): Promise<ApiResult<PbTestResult>>;
  // Management area M3 (nối BE-015 backup/restore, admin-only):
  // backup: save-dialog ở main khi thiếu dest_path. restore: open-dialog ở
  // main khi thiếu source_path (KHÔNG gửi binary từ renderer) → needRestart.
  backupNow(input?: BackupNowInput): Promise<ApiResult<BackupNowOutput>>;
  restoreFromFile(input?: RestoreFromFileInput): Promise<ApiResult<RestoreFromFileOutput>>;
  // FE-025 (nối BE-021 `notify:test`): dry-run quét thật / bắn Toast mẫu để
  // QA click thử deep-link. Guard none + yêu cầu login (backend).
  testNotify(sample?: NotifyEvent): Promise<ApiResult<NotifyTestOutput>>;
}

/** Minimal structural view of the preload bridge (assignable from ParkingApi). */
interface InvokeBridge {
  invoke<K extends IpcChannel>(channel: K, input: ApiMap[K]['input']): Promise<ApiMap[K]['output']>;
}

function getBridge(): InvokeBridge | null {
  const w = window as unknown as { api?: InvokeBridge };
  return w.api && typeof w.api.invoke === 'function' ? w.api : null;
}

// ---- plate caches (backend rows carry vehicle_id, not plates) ----
// Persisted so plates learned in one session survive reloads.
const LS_SESSION_PLATES = 'parking:session-plates-v1';
const LS_PASS_PLATES = 'parking:pass-plates-v1';

function loadCache(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveCache(key: string, value: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / blocked — non-fatal
  }
}

export function rememberSessionPlate(vehicleId: number, plate: string): void {
  const cache = loadCache(LS_SESSION_PLATES);
  cache[String(vehicleId)] = plate.toUpperCase();
  saveCache(LS_SESSION_PLATES, cache);
}

export function lookupSessionPlate(vehicleId: number): string | undefined {
  return loadCache(LS_SESSION_PLATES)[String(vehicleId)];
}

export function rememberPassPlate(passCode: string, plate: string): void {
  const cache = loadCache(LS_PASS_PLATES);
  cache[passCode] = plate.toUpperCase();
  saveCache(LS_PASS_PLATES, cache);
}

export function lookupPassPlate(passCode: string): string | undefined {
  return loadCache(LS_PASS_PLATES)[passCode];
}

export function allSessionPlates(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(loadCache(LS_SESSION_PLATES))) out[Number(k)] = v;
  return out;
}

export function allPassPlates(): Record<string, string> {
  return { ...loadCache(LS_PASS_PLATES) };
}

// ---- my pass-request store (FE-014, customer P3) — DEPRECATED từ FE-015 ----
// FE-015: backend đã có `customer:passes` mine-only (BE-010) nên
// `myPendingPasses` đọc server thật, không còn đọc store này. Giữ lại các
// helper (export) vì `mockApi` vẫn import + `cancelPass`/`confirmPass` dùng để
// dọn entry localStorage cũ còn sót từ bản trước — không ghi/đọc gì mới ở đây.
const LS_MY_PASSES = 'parking:my-pass-requests-v1';

export function readMyPassRequests(): MonthlyPass[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_MY_PASSES) ?? '[]') as MonthlyPass[];
    return Array.isArray(raw) ? raw.filter((p) => p.status === 'pending') : [];
  } catch {
    return [];
  }
}

export function saveMyPassRequest(pass: MonthlyPass): void {
  try {
    const rest = readMyPassRequestsRaw().filter((p) => p.pass_code !== pass.pass_code);
    localStorage.setItem(LS_MY_PASSES, JSON.stringify([...rest, pass]));
  } catch {
    // storage full / blocked — non-fatal
  }
}

function readMyPassRequestsRaw(): MonthlyPass[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_MY_PASSES) ?? '[]') as MonthlyPass[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function removeMyPassRequest(passCode: string): void {
  try {
    localStorage.setItem(
      LS_MY_PASSES,
      JSON.stringify(readMyPassRequestsRaw().filter((p) => p.pass_code !== passCode)),
    );
  } catch {
    // non-fatal
  }
}

function toResult<T>(res: { success: boolean; data?: T; message?: string; errors?: Record<string, string[]> }): ApiResult<T> {
  if (res.success) return { ok: true, data: res.data };
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.errors ?? {})) {
    if (v.length > 0) fields[k] = v[0];
  }
  // FE-020 S4: strip đuôi kỹ thuật `(NO_PERMISSION:<key>)` của backend
  // (BE-014) → toast tiếng Việt thân thiện (spec S4.3).
  const rawMsg = res.message ?? 'Thao tác thất bại';
  const msg = friendlyPermError(rawMsg);
  const friendlyFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) friendlyFields[k] = friendlyPermError(v);
  return {
    ok: false,
    error: msg,
    ...(Object.keys(friendlyFields).length > 0 ? { fields: friendlyFields } : {}),
  };
}

/** Backend-first implementation over the preload invoke bridge. */
const backendApi: RendererApi = {
  async login(username, password, remember = false) {
    const res = await (getBridge() as InvokeBridge).invoke('auth:login', { username, password, remember });
    if (!res.success || !res.data) return { ok: false, error: friendlyPermError(res.message ?? 'Sai tài khoản hoặc mật khẩu') };
    if (res.data.role_name === 'guest') return { ok: false, error: 'Tài khoản không có quyền đăng nhập' };
    return {
      ok: true,
      data: {
        userId: res.data.id, fullName: res.data.full_name, role: res.data.role_name,
        perms: res.data.perms ?? { ...STAFF_DEFAULTS },
        ...(res.data.remember_token ? { rememberToken: res.data.remember_token } : {}),
      },
    };
  },

  // FE-026: token cũ (single-use) → session mới + token đã xoay. Sai/hết hạn
  // → fail, caller xóa token + về màn login (KHÔNG banner đỏ — boot im lặng).
  async resume(token) {
    const res = await (getBridge() as InvokeBridge).invoke('auth:resume', { token });
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Phiên đăng nhập đã hết hạn' };
    if (res.data.role_name === 'guest') return { ok: false, error: 'Tài khoản không có quyền đăng nhập' };
    return {
      ok: true,
      data: {
        userId: res.data.id, fullName: res.data.full_name, role: res.data.role_name,
        perms: res.data.perms ?? { ...STAFF_DEFAULTS },
        rememberToken: res.data.remember_token,
      },
    };
  },

  // FE-012 (BE-007 `auth:register`, public). Caller auto-logins via login().
  async register(input) {
    const res = await (getBridge() as InvokeBridge).invoke('auth:register', {
      phone: input.phone,
      password: input.password,
      full_name: input.full_name,
    });
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Đăng ký thất bại' };
    return { ok: true, data: { userId: res.data.id, fullName: res.data.full_name } };
  },

  async listZones() {
    const res = await (getBridge() as InvokeBridge).invoke('zones:list', undefined);
    return toResult(res);
  },

  async createZone(input) {
    const res = await (getBridge() as InvokeBridge).invoke('zones:create', {
      code: input.code,
      name: input.name,
      vehicle_type_allowed: input.vehicle_type_allowed,
      capacity: input.capacity,
      price_per_hour: input.price_per_hour,
      price_per_day: input.price_per_day,
    });
    return toResult(res);
  },

  async updateZone(id, patch) {
    const res = await (getBridge() as InvokeBridge).invoke('zones:update', { id, ...patch });
    return toResult(res);
  },

  async deleteZone(id) {
    const res = await (getBridge() as InvokeBridge).invoke('zones:delete', { id });
    if (!res.success) return { ok: false, error: res.message ?? 'Xóa thất bại' };
    return { ok: true, data: undefined };
  },

  async zoneAvailability() {
    const res = await (getBridge() as InvokeBridge).invoke('availability:list', {});
    return toResult(res);
  },

  async spotMap(zoneId) {
    const res = await (getBridge() as InvokeBridge).invoke('spots:list', { zone_id: zoneId });
    return toResult(res);
  },

  async checkIn(input) {
    const res = await (getBridge() as InvokeBridge).invoke('sessions:check-in', input);
    const out = toResult(res);
    if (out.ok && out.data) rememberSessionPlate(out.data.vehicle_id, input.license_plate);
    return out;
  },

  async findParked(ticketOrPlate) {
    const bridge = getBridge() as InvokeBridge;
    const q = ticketOrPlate.trim().toUpperCase();
    if (!q) return { ok: true, data: [] };
    const [activeRes, vehicleRes] = await Promise.all([
      bridge.invoke('sessions:active', {}),
      bridge.invoke('vehicles:find', { license_plate: q }),
    ]);
    if (!activeRes.success) return { ok: false, error: activeRes.message ?? 'Tra cứu thất bại' };
    const rows = activeRes.data ?? [];
    const vehicle = vehicleRes.success ? vehicleRes.data : null;
    if (vehicle) rememberSessionPlate(vehicle.id, vehicle.license_plate);
    const matched = rows.filter((s) => {
      if (s.ticket_code.toUpperCase().includes(q)) return true;
      if (vehicle && s.vehicle_id === vehicle.id) return true;
      const known = lookupSessionPlate(s.vehicle_id);
      if (known && known.includes(q)) return true;
      return false;
    });
    return { ok: true, data: matched };
  },

  async parkedSessions() {
    const res = await (getBridge() as InvokeBridge).invoke('sessions:active', {});
    return toResult(res);
  },

  // Activity log (màn "Nhật ký", IPC `activity:list`). Callers pass
  // staff_id explicitly: staff pages MUST force staff_id = me.id (backend
  // enforces mine_only regardless — see spec §1).
  async listActivity(input) {
    const res = await (getBridge() as InvokeBridge).invoke('activity:list', input);
    return toResult(res);
  },

  async checkOut(input) {
    const res = await (getBridge() as InvokeBridge).invoke('sessions:check-out', input);
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Check-out thất bại' };
    return { ok: true, data: { session: res.data.session, amount: res.data.payment.amount } };
  },

  async listPasses() {
    const res = await (getBridge() as InvokeBridge).invoke('passes:list', {});
    return toResult(res);
  },

  async createPass(input) {
    const res = await (getBridge() as InvokeBridge).invoke('passes:create', {
      license_plate: input.license_plate,
      vehicle_type: input.vehicle_type,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      zone_id: input.zone_id,
      months: input.months,
      start_date: input.start_date,
      payment_method: 'cash',
    });
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Bán vé thất bại' };
    rememberPassPlate(res.data.pass.pass_code, input.license_plate);
    return { ok: true, data: res.data.pass };
  },

  async renewPass(passCode, months) {
    const res = await (getBridge() as InvokeBridge).invoke('passes:renew', { pass_code: passCode, months, payment_method: 'cash' });
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Gia hạn thất bại' };
    return { ok: true, data: res.data.pass };
  },

  async cancelPass(passCode, reason) {
    const res = await (getBridge() as InvokeBridge).invoke('passes:cancel', { pass_code: passCode, reason });
    if (!res.success) return { ok: false, error: res.message ?? 'Hủy vé thất bại' };
    // Customer hủy đăng ký pending của mình → dọn store badge "Chờ xác nhận".
    removeMyPassRequest(passCode);
    return { ok: true, data: undefined };
  },

  async revenue(from, to) {
    const bridge = getBridge() as InvokeBridge;
    const [rev, sess] = await Promise.all([
      bridge.invoke('reports:revenue', { from, to }),
      bridge.invoke('reports:sessions-daily', { from, to }),
    ]);
    if (!rev.success) return { ok: false, error: rev.message ?? 'Lỗi tải báo cáo' };
    if (!sess.success) return { ok: false, error: sess.message ?? 'Lỗi tải báo cáo' };
    return { ok: true, data: { daily: rev.data ?? [], sessions: sess.data ?? [] } };
  },

  // Staff-safe dashboard bundle (reports:dashboard — no admin guard).
  // RevenuePage keeps revenue() (reports:revenue, admin-only, staff-blocked).
  async dashboard() {
    const res = await (getBridge() as InvokeBridge).invoke('reports:dashboard', undefined);
    return toResult(res);
  },

  // Server fee receipt — source of truth at checkout (A2).
  async previewFee(ticketCode, discountAmount) {
    const res = await (getBridge() as InvokeBridge).invoke('sessions:preview-fee', {
      ticket_code: ticketCode,
      discount_amount: discountAmount ?? 0,
    });
    return toResult(res);
  },

  async logout(token?: string) {
    try {
      // FE-026: kèm token remember-me để main thu hồi (best-effort).
      await (getBridge() as InvokeBridge).invoke('auth:logout', token ? { token } : undefined);
    } catch {
      // fire-and-forget — renderer state is cleared regardless
    }
    return { ok: true, data: undefined };
  },

  // Users screen (admin-only IPC `users:*` — backend enforces the admin guard).
  async listUsers() {
    const res = await (getBridge() as InvokeBridge).invoke('users:list', undefined);
    return toResult(res);
  },

  async createUser(input) {
    const res = await (getBridge() as InvokeBridge).invoke('users:create', input);
    return toResult(res);
  },

  async toggleUserActive(id, isActive) {
    const res = await (getBridge() as InvokeBridge).invoke('users:toggle-active', { id, is_active: isActive });
    return toResult(res);
  },

  async updateUser(id, patch) {
    const res = await (getBridge() as InvokeBridge).invoke('users:update', { id, ...patch });
    return toResult(res);
  },

  // FE-017 S1: staff xem/sửa hồ sơ chính mình (notes không bao giờ trả về).
  async staffProfile() {
    const res = await (getBridge() as InvokeBridge).invoke('users:profile', undefined);
    return toResult(res);
  },

  async updateStaffProfile(patch) {
    const res = await (getBridge() as InvokeBridge).invoke('users:profile:update', patch);
    return toResult(res);
  },

  async currentUser() {
    const res = await (getBridge() as InvokeBridge).invoke('auth:me', undefined);
    if (!res.success || !res.data) return { ok: true, data: null };
    if (res.data.role_name === 'guest') return { ok: true, data: null };
    return { ok: true, data: { userId: res.data.id, fullName: res.data.full_name, role: res.data.role_name, perms: res.data.perms ?? { ...STAFF_DEFAULTS } } };
  },

  // FE-020 S4: auth:me raw (kèm perms) để refresh sau khi admin sửa quyền.
  async meFull() {
    const res = await (getBridge() as InvokeBridge).invoke('auth:me', undefined);
    return toResult(res);
  },

  // Customer area P1: raw profile incl. phone (read-only SĐT card).
  async myProfile() {
    const res = await (getBridge() as InvokeBridge).invoke('auth:me', undefined);
    return toResult(res);
  },

  // Customer area P1: self-update via IPC users:update (BE-008 enforces
  // id = me.id, SĐT immutable, current_password verify). Field errors
  // (errors.current_password/new_password) flow through toResult → fields.
  async updateProfile(id, patch) {
    const res = await (getBridge() as InvokeBridge).invoke('users:update', { id, ...patch });
    return toResult(res);
  },

  // Customer area P2: mine-only vehicle + session lists (backend ép me.phone).
  async customerVehicles() {
    const res = await (getBridge() as InvokeBridge).invoke('customer:vehicles', undefined);
    return toResult(res);
  },

  async customerSessions(input) {
    const res = await (getBridge() as InvokeBridge).invoke('customer:sessions', input);
    return toResult(res);
  },

  // Customer area P3: gửi đăng ký vé tháng (pending, trả tiền tại quầy).
  // FE-015: không còn ghi store local — `myPendingPasses` đọc server thật
  // (`customer:passes`, BE-010) nên vé mới hiện sau refetch.
  async requestPass(input) {
    const res = await (getBridge() as InvokeBridge).invoke('customer:pass-request', input);
    return toResult(res);
  },

  // Staff duyệt/từ chối vé pending (passes:confirm). Giữ dọn store local như
  // legacy cleanup (entry cũ còn sót từ bản FE-014); badge customer hết
  // "Chờ xác nhận" nhờ refetch `customer:passes` server-side.
  async confirmPass(input: PassConfirmInput) {
    const res = await (getBridge() as InvokeBridge).invoke('passes:confirm', input);
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Xác nhận vé thất bại' };
    removeMyPassRequest(res.data.pass.pass_code);
    return { ok: true, data: res.data.pass };
  },

  // FE-015: `myPendingPasses` đọc server thật — `customer:passes`
  // mine-only (BE-010), không còn workaround localStorage. Mock (browser
  // dev) giữ nguyên: lọc thẳng passes[] mine-only.
  async myPendingPasses() {
    const res = await (getBridge() as InvokeBridge).invoke('customer:passes', { status: 'pending' });
    if (!res.success) return { ok: false, error: res.message ?? 'Không tải được vé đang chờ' };
    return { ok: true, data: res.data?.rows ?? [] };
  },

  // FE-016 P4 (nối BE-011): 3 IPC giữ chỗ trong ngày (mine-only server-side).
  async reserve(input: CustomerReserveInput) {
    const res = await (getBridge() as InvokeBridge).invoke('customer:reserve', input);
    return toResult(res);
  },

  async myReservations(input?: CustomerReservationsInput) {
    const res = await (getBridge() as InvokeBridge).invoke('customer:reservations', input ?? {});
    return toResult(res);
  },

  async cancelReservation(code: string) {
    const res = await (getBridge() as InvokeBridge).invoke('customer:reserve-cancel', { code });
    return toResult(res);
  },

  // FE-019 S3 (nối BE-013): 6 IPC ca + chấm công. Renderer KHÔNG gửi
  // staff_id (chấm hộ là admin-only, UI này không có luồng đó — backend
  // ép me.id, mock mirror bằng userId truyền qua input ngầm).
  async listShifts() {
    const res = await (getBridge() as InvokeBridge).invoke('shifts:list', undefined);
    return toResult(res);
  },

  async updateShift(id, patch) {
    const res = await (getBridge() as InvokeBridge).invoke('shifts:update', { id, ...patch });
    return toResult(res);
  },

  async attendanceToday() {
    const res = await (getBridge() as InvokeBridge).invoke('attendance:today', undefined);
    return toResult(res);
  },

  async checkInShift(input) {
    const res = await (getBridge() as InvokeBridge).invoke('attendance:check-in', input);
    return toResult(res);
  },

  async checkOutShift(input) {
    const res = await (getBridge() as InvokeBridge).invoke('attendance:check-out', input);
    return toResult(res);
  },

  async listAttendance(input) {
    const res = await (getBridge() as InvokeBridge).invoke('attendance:list', input);
    return toResult(res);
  },

  // FE-021 M1 (nối BE-015): detail giao dịch thu phí (tab Chi tiết + Excel).
  async listTransactions(input) {
    const res = await (getBridge() as InvokeBridge).invoke('reports:transactions', input);
    return toResult(res);
  },

  // FE-021 M2 (nối BE-015): settings bãi + quy tắc phí (file JSON cạnh DB).
  async getAppConfig() {
    const res = await (getBridge() as InvokeBridge).invoke('app-config:get', undefined);
    return toResult(res);
  },

  async setAppConfig(patch) {
    const res = await (getBridge() as InvokeBridge).invoke('app-config:set', { patch });
    return toResult(res);
  },

  // FE-021 M3 (nối BE-015): backup/restore file-level (dialog ở main).
  async backupNow(input) {
    const res = await (getBridge() as InvokeBridge).invoke('backup:now', input ?? {});
    return toResult(res);
  },

  async restoreFromFile(input) {
    const res = await (getBridge() as InvokeBridge).invoke('restore:from-file', input ?? {});
    return toResult(res);
  },

  // FE-025 (nối BE-021): dry-run không toast / sample bắn Toast mẫu thật.
  async testNotify(sample) {
    const res = await (getBridge() as InvokeBridge).invoke('notify:test', sample ? { sample } : {});
    return toResult(res);
  },

  // FE-022 (nối BE-016/BE-017): trạng thái + kiểm tra máy chủ PocketBase.
  async pbStatus() {
    const res = await (getBridge() as InvokeBridge).invoke('pb:status', undefined);
    return toResult<PbStatus>(res);
  },

  async testPbConnection(url?: string) {
    const res = await (getBridge() as InvokeBridge).invoke('pb:test', url ? { url } : {});
    return toResult<PbTestResult>(res);
  },

  async recentActivity(limit) {
    const res = await (getBridge() as InvokeBridge).invoke('sessions:history', { limit });
    if (!res.success || !res.data) return { ok: false, error: res.message ?? 'Lỗi tải hoạt động' };
    return {
      ok: true,
      data: res.data.rows.slice(0, limit).map((s) => ({
        id: s.id,
        text: s.status === 'parked'
          ? `Check-in ${s.ticket_code} tại khu ${s.zone_id}`
          : `Check-out ${s.ticket_code} — ${s.total_fee !== null ? `${s.total_fee.toLocaleString('vi-VN')} ₫` : ''}`,
        at: s.status === 'parked' ? s.check_in_at : (s.check_out_at ?? s.updated_at),
      })),
    };
  },
};

/**
 * Backend-first, mock fallback. Pass the mock call as `fallback` so the UI
 * works in browser dev (`vite`) before IPC is wired.
 */
export async function callApi<T>(fn: (api: RendererApi) => Promise<ApiResult<T>>, fallback: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  if (getBridge() !== null) {
    try {
      return await fn(backendApi);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'IPC call failed' };
    }
  }
  return fallback();
}
