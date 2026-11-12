// Shared contract between Electron main <-> preload <-> renderer.
// Mirrors ./api-contract.md + specs/schema.sql. Single source of truth for IPC types.

export type RoleName = 'admin' | 'staff' | 'guest' | 'customer';
export type VehicleType = 'car' | 'motorbike';
export type ZoneVehicleAllowed = 'car' | 'motorbike' | 'both';
export type SpotStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';
export type SessionStatus = 'parked' | 'completed' | 'cancelled';
export type PassStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'suspended';
export type ReservationStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'expired';
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'e_wallet';

/** Standard IPC envelope (same shape as HTTP ApiResponse). */
export interface IpcResult<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
}

export function ok<T>(data: T, message?: string): IpcResult<T> {
  return { success: true, data, message };
}

export function fail(message: string, errors?: Record<string, string[]>): IpcResult<never> {
  return { success: false, message, errors };
}

export interface UserDTO {
  id: number;
  username: string;
  full_name: string;
  phone: string | null; // v002: customer bắt buộc (= username = SĐT); staff/admin cũ NULL được
  address: string | null; // v005 S1: địa chỉ, optional, max 255 ở app
  start_date: string | null; // v005 S1: ngày vào làm 'YYYY-MM-DD', optional, <= today ở app
  notes?: string | null; // v005 S1: ghi chú nội bộ, optional, max 500 — ADMIN-ONLY
  // (users:list strip khi role !== 'admin'; users:profile* không bao giờ trả)
  permissions: string | null; // v007 S4: raw JSON 5 flags, NULL = full staff cũ (DB truth)
  perms: StaffPermissions; // v007 S4: resolved map (admin → full; NULL/lỗi → defaults)
  // Frontend ẩn menu/hành động theo `perms`, KHÔNG parse `permissions` lại.
  role_id: number;
  role_name: RoleName;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

// ---- Staff area S4 phân quyền (staff-area.md S4.1, migration-007) ----
// Canonical 5 keys, giá trị 0|1. App parse CHẤP NHẬN boolean true/false
// (normalize về 0/1 lúc resolve); partial JSON thiếu key = default 1;
// key lạ → bỏ qua; admin → luôn full (bỏ qua cột).

export type StaffPermissionKey = 'checkin' | 'pass_sale' | 'report_self' | 'profile_self' | 'reservation';

export interface StaffPermissions {
  checkin: 0 | 1; // check-in/out + thu phí (mặc định 1)
  pass_sale: 0 | 1; // bán/gia hạn vé tháng (mặc định 1)
  report_self: 0 | 1; // báo cáo + hiệu suất ca mình (mặc định 1)
  profile_self: 0 | 1; // tự sửa SĐT/địa chỉ của mình (mặc định 1)
  reservation: 0 | 1; // xác nhận/hủy đặt chỗ (mặc định 1)
}

export const STAFF_DEFAULTS: StaffPermissions = {
  checkin: 1,
  pass_sale: 1,
  report_self: 1,
  profile_self: 1,
  reservation: 1,
};

// Input gán quyền (users:update, admin-only): từng key nhận 0|1|boolean;
// string JSON cũng được (backend parse + whitelist như object).
export type StaffPermissionsInput = Partial<Record<StaffPermissionKey, 0 | 1 | boolean>>;

// Hồ sơ staff tự xem (users:profile GET — KHÔNG có notes, staff-area.md S1.3/S1.4).
export interface StaffSelfProfile {
  id: number;
  username: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  start_date: string | null;
  role_name: RoleName;
  is_active: 0 | 1;
  created_at: string;
}

// users:profile:update — staff chỉ được tự sửa { phone?, address? } (S1.4).
export interface StaffProfileUpdateInput {
  phone?: string | null;
  address?: string | null;
}

export interface ParkingZone {
  id: number;
  code: string;
  name: string;
  vehicle_type_allowed: ZoneVehicleAllowed;
  capacity: number;
  price_per_hour: number;
  price_per_day: number;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ParkingSpot {
  id: number;
  zone_id: number;
  spot_number: string;
  status: SpotStatus;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: number;
  license_plate: string;
  vehicle_type: VehicleType;
  owner_name: string;
  owner_phone: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlyPass {
  id: number;
  pass_code: string;
  vehicle_id: number;
  zone_id: number | null;
  customer_name: string;
  customer_phone: string;
  start_date: string;
  end_date: string;
  price: number;
  status: PassStatus;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ParkingSession {
  id: number;
  ticket_code: string;
  vehicle_id: number;
  spot_id: number | null;
  zone_id: number;
  monthly_pass_id: number | null;
  check_in_at: string;
  check_out_at: string | null;
  status: SessionStatus;
  hourly_rate_applied: number;
  daily_rate_applied: number;
  total_fee: number | null;
  discount_amount: number;
  created_by: number | null;
  closed_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  session_id: number | null;
  monthly_pass_id: number | null;
  amount: number;
  payment_method: PaymentMethod;
  paid_at: string;
  received_by: number | null;
  note: string;
  created_at: string;
}

export interface ZoneAvailability {
  zone_id: number;
  zone_code: string;
  zone_name: string;
  vehicle_type_allowed: ZoneVehicleAllowed;
  capacity: number;
  is_active: 0 | 1;
  free_spots: number;
  occupied_spots: number;
  maintenance_spots: number;
}

export interface RevenueDaily {
  day: string;
  payment_method: PaymentMethod;
  tx_count: number;
  revenue: number;
}

export interface SessionsDaily {
  day: string;
  zone_id: number;
  entries: number;
  exits: number;
  still_parked: number;
}

export interface SpotMapCell {
  spot_id: number;
  zone_id: number;
  zone_code: string;
  spot_number: string;
  status: SpotStatus;
  occupying_plate: string | null;
}

// ---- Inputs (mirror api-contract.md §8) ----

export interface CheckInInput {
  license_plate: string;
  vehicle_type: VehicleType;
  zone_id: number;
  spot_id?: number;
  owner_name?: string;
  owner_phone?: string;
  reservation_code?: string; // P4 (BE-011): mã giữ chỗ R-… — consume pending → completed + dùng đúng spot đã giữ
}

export interface CheckOutInput {
  ticket_code: string;
  discount_amount?: number;
  payment_method: PaymentMethod;
  // BE-018 (qr-anpr.md §1.1B): quét QR thay gõ tay — verify SIG → resolve
  // ticket_code rồi chạy luồng check-out cũ. Gửi kèm hay thay ticket_code
  // đều được (trống + không có qr_payload → lỗi như cũ).
  qr_payload?: string;
}

export interface FeePreview {
  ticket_code: string;
  check_in_at: string;
  check_out_at: string;
  minutes: number;
  billed_hours: number;
  applied_daily_rate: boolean;
  day_count: number;
  hourly_rate: number;
  daily_rate: number;
  gross_fee: number;
  discount_amount: number;
  total_fee: number;
  uses_monthly_pass: boolean;
  pass_code: string | null;
}

// ---- Customer self-registration (migration-002, api-contract.md §12) ----

export interface CustomerRegisterInput {
  phone: string; // SĐT VN 10 số, bắt đầu bằng 0 — đồng thời làm username
  password: string; // >= 6 ký tự — app bcrypt.hash(10)
  full_name: string; // họ tên, >= 1 ký tự (trim)
}

// ---- Activity log (màn "Nhật ký", spec ./specs/activity-log.md) ----

export type ActivityAction = 'check_in' | 'check_out' | 'pass_sale';

export interface ActivityListInput {
  staff_id?: number; // admin lọc 1 NV; staff gọi: backend force = me.id
  from?: string; // YYYY-MM-DD (inclusive, theo `at`)
  to?: string; // YYYY-MM-DD (inclusive)
  action?: ActivityAction; // undefined = tất cả
  search?: string; // match ticket_code / pass_code / license_plate / username (LIKE, uppercase)
  limit?: number; // default 20, max 100
  offset?: number; // default 0
}

export interface ActivityRow {
  at: string; // ISO8601 UTC — check_in_at / check_out_at / passes.created_at
  user_id: number | null; // created_by / closed_by / passes.created_by (NULL khi FK SET NULL)
  username: string | null;
  full_name: string | null;
  action: ActivityAction;
  ticket_code: string | null; // sessions.ticket_code | passes.pass_code
  license_plate: string | null;
  zone_code: string | null;
  zone_name: string | null;
  amount: number | null; // check_out → total_fee; pass_sale → price; check_in → null
  is_monthly_session?: 0 | 1; // check_in có monthly_pass_id → UI render "Vé tháng (0₫)"
  payment_method?: PaymentMethod | null; // 1 payment mới nhất per session/pass (check_in → null)
  note?: string | null; // "ZONE_CODE — Zone name" (+ " · <method>" khi có thu tiền)
}

export interface ActivityListOutput {
  rows: ActivityRow[];
  total: number; // COUNT cùng filter (cho pagination)
}

// ---- Customer area P2 (spec ./specs/customer-area.md §P2.2) ----
// Xe + lịch sử của chính customer, link qua vehicles.owner_phone = users.phone.
// Backend ép me.phone từ session — KHÔNG nhận phone từ client.

export interface CustomerVehicle extends Vehicle {
  session_count: number; // tổng lượt gửi (parked + completed)
  total_spent: number; // SUM(total_fee) các session completed (VND)
  is_parked: 0 | 1; // 1 = đang có session 'parked'
}

export interface CustomerVehiclesOutput {
  vehicles: CustomerVehicle[];
  total_spent: number; // tổng VND mọi xe của mình (cho chip tổng tiền)
}

export interface CustomerSessionsInput {
  from?: string; // YYYY-MM-DD (inclusive, theo check_in_at)
  to?: string; // YYYY-MM-DD (inclusive)
  search?: string; // match ticket_code / license_plate (LIKE, uppercase)
  limit?: number; // default 20, max 100
  offset?: number; // default 0
}

export interface CustomerSessionRow {
  ticket_code: string;
  license_plate: string;
  zone_code: string | null;
  zone_name: string | null;
  check_in_at: string;
  check_out_at: string | null;
  total_fee: number | null;
  monthly_pass_id: number | null;
  is_monthly: 0 | 1; // có vé tháng lúc check-in → UI render "Vé tháng (0₫)"
  payment_method: PaymentMethod | null; // payment mới nhất của session (tooltip)
}

export interface CustomerSessionsOutput {
  rows: CustomerSessionRow[];
  total: number; // COUNT cùng filter (cho pagination)
  total_spent: number; // SUM(total_fee completed) cùng filter (footer "Tổng cộng")
}

// ---- Customer area P3 (spec ./specs/customer-area.md §P3.2 — BE-009) ----
// Đăng ký trước — trả tiền tại quầy. Vé mới luôn `status='pending'`; staff thu
// tiền qua `passes:confirm` (pending → active + INSERT payments) hoặc từ chối
// (pending → cancelled). Vé pending KHÔNG miễn phí check-in (findValidPass
// chỉ nhận 'active' — đã verify, không sửa).

export interface CustomerPassRequestInput {
  vehicle_id: number; // xe của chính mình (verify owner_phone = me.phone)
  zone_id?: number | null; // null/undefined = mọi zone
  package_months: 1 | 3 | 6 | 12; // gói 1/3/6/12 tháng (giá = công thức staff, 12T −10%)
  start_date?: string; // YYYY-MM-DD, default hôm nay
}

export interface PassConfirmInput {
  pass_code: string;
  action: 'approve' | 'reject'; // approve: pending → active + thu tiền; reject: pending → cancelled
  payment_method?: PaymentMethod; // approve: default 'cash'
  reason?: string; // reject: lý do (echo vào message như passes:cancel, KHÔNG persist)
}

export interface PassConfirmOutput {
  pass: MonthlyPass;
  payment: Payment | null; // approve → payment thu tại quầy; reject → null
}

// ---- Customer area P3 follow-up (BE-010, FE-014 đề xuất) ----
// List vé tháng của chính mình để frontend bỏ workaround localStorage.
// Mine-only: backend ép me.phone (JOIN vehicles.owner_phone), KHÔNG nhận
// phone từ client (cùng pattern P2). Sort mới nhất server-side.

export interface CustomerPassesInput {
  status?: PassStatus; // optional — undefined = tất cả
  limit?: number; // default 20, max 100
  offset?: number; // default 0
}

export interface CustomerPassesOutput {
  rows: MonthlyPass[]; // ORDER BY created_at DESC, id DESC
  total: number; // COUNT cùng filter (cho pagination)
}

// ---- Customer area P4 (spec ./specs/customer-area.md §P4 — BE-011, BE-019 24/24) ----
// Đặt chỗ mọi giờ + qua đêm được (end <= start = sang hôm sau, datetime đầy đủ).
// Luồng status:
// pending (giữ chỗ ≡ spec 'held') ──check-in bằng mã──▶ completed (≡ used);
// quá expires_at (giờ kết thúc + 20p) ──sweep──▶ expired (+ spot → 'available');
// khách hủy ──▶ cancelled. Quota ≤ 2 pending|active/customer/ngày bắt đầu (backend COUNT).
// Sweep chạy khi mở app + trước mỗi check-in (cùng transaction với trả spot).

export interface Reservation {
  id: number;
  code: string; // UNIQUE, vd 'R-20261024-0001' (app sinh)
  user_id: number;
  vehicle_id: number | null; // NULL khi đặt trước khi xe tồn tại (link lúc check-in)
  license_plate: string; // biển số gõ tay (UPPERCASE), đối soát khi chưa có vehicle
  customer_phone: string; // snapshot SĐT lúc đặt (pattern monthly_passes)
  zone_id: number;
  spot_id: number | null; // ô auto-pick đã giữ (NULL = chỉ giữ theo khu)
  date: string; // YYYY-MM-DD (= ngày bắt đầu, backend ép = today; end có thể sang hôm sau)
  start_time: string; // HH:mm, mọi giờ trong ngày (24/24, không giới hạn khung)
  end_time: string; // HH:mm, end <= start = qua đêm (sang hôm sau), duration 15p–4h
  status: ReservationStatus; // pending ≡ đang giữ
  expires_at: string; // ISO8601 = giờ kết thúc + 20p (datetime đầy đủ, sweep job dùng)
  created_at: string;
  updated_at: string;
}

export interface CustomerReserveInput {
  zone_id: number;
  license_plate: string; // biển số gõ tay (app UPPERCASE)
  vehicle_type?: VehicleType; // optional: kiểm tra tương thích khu khi xe chưa tồn tại
  date?: string; // V1: client gửi hay không backend cũng ép = today (bỏ qua)
  start_time?: string; // HH:mm (alias time_from để tương thích api-contract §13)
  end_time?: string; // HH:mm (alias time_to)
  time_from?: string; // alias của start_time
  time_to?: string; // alias của end_time
}

export interface CustomerReservationsInput {
  status?: ReservationStatus; // optional — undefined = tất cả
  limit?: number; // default 20, max 100
  offset?: number; // default 0
}

export interface CustomerReservationRow extends Reservation {
  zone_code: string | null;
  zone_name: string | null;
  spot_number: string | null;
}

export interface CustomerReservationsOutput {
  rows: CustomerReservationRow[]; // ORDER BY date, start_time
  total: number; // COUNT cùng filter (cho pagination)
}

export interface CustomerReserveCancelInput {
  code: string; // mã R-… của chính mình, chỉ khi status 'pending'
}

// ---- Staff area S3 (spec ./specs/staff-area.md §S3 — BE-013) ----
// Ca làm việc + chấm công/bàn giao (migration-006). Quy ước ca đêm:
// work_date = NGÀY BẮT ĐẦU CA (trực NIGHT 22:00 24/10 → 06:00 25/10 thì
// work_date = '2026-10-24'); check_out_at ĐƯỢC sang ngày sau. Mọi báo cáo
// GROUP BY work_date. Đối soát lệch chỉ Warning, không chặn chốt ca.

export type ShiftCode = 'MORNING' | 'AFTERNOON' | 'NIGHT';
export type AttendanceStatus = 'present' | 'late' | 'missing';

export interface Shift {
  id: number;
  code: ShiftCode;
  name: string; // 'Ca sáng' | 'Ca chiều' | 'Ca đêm'
  start_time: string; // 'HH:MM' — ca đêm end < start (= qua ngày)
  end_time: string; // 'HH:MM'
  is_active: 0 | 1; // tắt = không xếp ca mới, lịch sử giữ nguyên
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: number;
  user_id: number; // FK → users.id (RESTRICT)
  shift_id: number; // FK → shifts.id (RESTRICT)
  work_date: string; // YYYY-MM-DD = NGÀY BẮT ĐẦU CA
  check_in_at: string | null; // ISO8601 thực tế bấm vào (NULL = chưa vào)
  check_out_at: string | null; // ISO8601 thực tế bấm ra (NULL = đang trực)
  opening_cash: number; // VND đầu ca, default 0
  closing_cash: number | null; // VND cuối ca (NULL = chưa chốt)
  handover_note: string | null; // bàn giao, max 500 ở app
  status: AttendanceStatus; // 'present' (đúng giờ) | 'late' (trễ) | 'missing' (vắng)
  created_at: string;
  updated_at: string;
}

// Row chấm công kèm thông tin ca + NV (cho table "Ca của tôi" / admin filter).
export interface AttendanceRow extends Attendance {
  shift_code: ShiftCode;
  shift_name: string;
  shift_start: string; // 'HH:MM' snapshot từ shifts lúc query (hiển thị khung giờ)
  shift_end: string; // 'HH:MM'
  username: string | null; // NULL khi user đã xóa (FK RESTRICT nên hiếm, giữ để an toàn)
  full_name: string | null;
}

// attendance:check-in — staff ép user_id = me (admin chấm hộ qua staff_id).
export interface AttendanceCheckInInput {
  shift_code?: ShiftCode; // thiếu cả 2 → auto theo giờ tường (quy ước §14)
  shift_id?: number; // ưu tiên shift_id khi gửi cả 2
  opening_cash?: number; // VND >= 0, default 0 (= két rỗng)
  staff_id?: number; // admin-only: chấm hộ NV khác; staff gửi bị bỏ qua (ép me)
}

// attendance:check-out — chốt ca đang mở gần nhất của mình (kể cả "chốt bù"
// ca hôm qua còn check_out_at IS NULL). closing_cash optional ở type nhưng UI
// luôn nhập; thiếu → chốt giờ ra, tiền để NULL (admin đối soát sau).
export interface AttendanceCheckOutInput {
  closing_cash?: number | null; // VND >= 0
  handover_note?: string | null; // max 500, trim, rỗng → NULL
  staff_id?: number; // admin-only: chốt hộ NV khác; staff gửi bị bỏ qua (ép me)
}

export interface AttendanceListInput {
  from?: string; // YYYY-MM-DD (inclusive, theo work_date)
  to?: string; // YYYY-MM-DD (inclusive)
  staff_id?: number; // admin lọc 1 NV; staff gọi: backend force = me.id
  limit?: number; // default 50, max 200
  offset?: number; // default 0
}

export interface AttendanceListOutput {
  rows: AttendanceRow[];
  total: number; // COUNT cùng filter (cho pagination)
}

export interface AttendanceCheckOutOutput {
  attendance: Attendance;
  revenue_in_shift: number; // SUM(payments.amount) của mình trong khung ca (VND)
  variance: number | null; // closing - opening - revenue; NULL khi chưa nhập closing
}

export interface AttendanceTodayOutput {
  shift: Shift; // ca hiện tại theo giờ tường
  work_date: string; // work_date của ca hiện tại (quy ước ca đêm)
  attendance: Attendance | null; // row ca hiện tại của mình (NULL = chưa vào ca)
  pending_close: Attendance | null; // row cũ nhất còn check_out_at IS NULL (banner "chốt bù")
}

// shifts:update — admin-only config giờ ca. overlap Warning không chặn (S3.3).
export interface ShiftUpdateInput {
  id: number;
  name?: string;
  start_time?: string; // 'HH:mm'
  end_time?: string; // 'HH:mm' (end < start = ca qua ngày, ghi chú rõ)
  is_active?: 0 | 1;
}

// ---- Management area M1 (spec ./specs/management-area.md §M1.2 — BE-015) ----
// Read-only detail of every payment transaction (for "Chi tiết" tab + Excel
// export). Aggregate tab reuses v_revenue_daily / v_sessions_daily (§10) —
// no separate compare IPC by design (frontend calls the 2 views twice).

export type TxKind = 'casual' | 'monthly' | 'adjust';

export interface TxListInput {
  from: string; // YYYY-MM-DD (inclusive, theo payments.paid_at)
  to: string; // YYYY-MM-DD (inclusive)
  zone_ids?: number[]; // multi-select mới (undefined/rỗng = tất cả)
  kind?: TxKind; // vé lượt / vé tháng / điều chỉnh (note LIKE 'điều chỉnh%')
  payment_method?: PaymentMethod;
  search?: string; // match ticket_code / pass_code / license_plate (LIKE, uppercase)
  granularity?: 'day' | 'week' | 'month' | 'year'; // accepted + validated; detail rows
  // luôn trả chi tiết (tab Tổng hợp dùng views §10, không gom ở IPC này)
  limit?: number; // default 50, max 200
  offset?: number; // default 0
}

export interface TxRow {
  paid_at: string; // ISO8601 UTC (payments.paid_at)
  payment_id: number; // payments.id (hiển thị GD-XXXXXX)
  kind: TxKind; // suy từ session_id/monthly_pass_id + note
  ticket_code: string | null; // sessions.ticket_code | passes.pass_code
  license_plate: string | null;
  zone_code: string | null;
  zone_name: string | null;
  received_by_name: string | null; // JOIN users (xóa → NULL + UI fallback "(đã xóa)")
  received_by_username: string | null;
  payment_method: PaymentMethod | null;
  amount: number; // VND thực thu (payments.amount)
  note: string | null;
}

export interface TxListOutput {
  rows: TxRow[]; // ORDER BY paid_at DESC, payment_id DESC
  total: number; // COUNT cùng filter (cho pagination)
  summary: { revenue: number; tx_count: number; avg: number }; // SUM/COUNT cùng filter (không LIMIT)
}

// ---- PocketBase online (BE-016, auth trước — data sync để P2) ----
// Local-first giữ nguyên: `mode` luôn 'local-first' ở V1; `online` chỉ
// phản ánh ping /api/health gần nhất. Frontend dùng `pb:status` để render
// badge offline + quyết định có hiện nút "thử lại online" không.
// Schema thật: xem specs/pb-server-map.json (BE-017 — thay mọi giả định cũ
// từ specs/pocketbase-collections.json).

export type PbMode = 'local-first' | 'online';

/** Role trên server (users.role) — app local KHÔNG có `parking_manager`/`guest`
 * (merge-plan §3.1: admin↔system_admin, staff↔staff, customer↔customer;
 * parking_manager đọc như admin; guest không có row). */
export type PbServerRole = 'system_admin' | 'parking_manager' | 'staff' | 'customer';

// Enum server cho P2 data-sync (tên/giá trị KHÁC local — KHÔNG dùng lẫn):
export type PbSpotStatus = 'empty' | 'occupied' | 'reserved' | 'maintenance'; // local 'available'→'empty'
export type PbSessionStatus = 'parking' | 'completed' | 'cancelled'; // local 'parked'→'parking'
export type PbReservationStatus = 'pending' | 'confirmed' | 'checked_in' | 'cancelled' | 'no_show';
export type PbPaymentMethod = 'cash' | 'vietqr' | 'bank_transfer' | 'momo'; // local card→bank_transfer+note, transfer→bank_transfer, e_wallet→momo
export type PbPaymentStatus = 'paid' | 'refunded' | 'cancelled';
export type PbVehicleType = 'motorbike' | 'car' | 'bicycle' | 'e_bike' | 'truck'; // app chỉ dùng car/motorbike

export interface PbStatus {
  online: boolean; // ping /api/health OK trong timeout
  mode: PbMode; // V1 luôn 'local-first' (giữ chế độ local mặc định)
  pb_url: string; // '' khi chưa cấu hình (local-only)
  latency_ms: number | null;
  parking_lot: string | null; // BE-017: id bãi server đang dùng; null = chưa cấu hình (local-only)
}

export interface PbTestInput {
  url?: string; // override tạm để test (không lưu); undefined → dùng URL đã cấu hình
}

export interface PbTestResult {
  reachable: boolean;
  pb_url: string;
  latency_ms: number | null;
}

// ---- Management area M2 (spec ./specs/management-area.md §M2.2 — BE-015) ----
// Parking settings persisted as JSON beside the DB file (userData/app-config.json),
// NOT a DB table (P2 mới có bảng app_settings khi sync nhiều máy).
// Frontend caches under localStorage key 'parking.settings.v1' (offline fallback).

export interface ParkingSettings {
  lot_name: string; // required, 1–100 ký tự
  address: string | null; // optional, max 255
  phone: string | null; // optional, SĐT VN 10 số bắt đầu bằng 0
  logo_data_url: string | null; // PNG/JPG dataURL ≤ 512KB
  fee_grace_minutes: number; // default 30, int 0–120
  fee_day_threshold_hours: number; // default 12, int 1–24
  pb_url: string | null; // BE-016: URL máy chủ PocketBase; null = local-only
  // (không thử online). File cũ thiếu → mặc định DEFAULT_PB_URL (app-config.ts).
  pb_parking_lot: string | null; // BE-017: id bãi server (parking_lots) — MỌI
  // create/filter PB PHẢI gắn kèm (server bắt buộc). null = chưa cấu hình =
  // local-only (không thử online). Xin id từ system_admin.
  qr_hmac_key_b64: string | null; // BE-018 (qr-anpr.md §1.2): key HMAC-SHA256
  // 256-bit ký vé QR, base64 — lưu cùng app-config.json, KHÔNG hardcode,
  // KHÔNG log, KHÔNG trả cho client ngoài `auth:qr-key`. null = chưa sinh
  // (sinh lười ở ensureQrHmacKey). Backup/restore .db + app-config.json đi cùng nhau.
  qr_key_id: number; // BE-018: V1 luôn 1 (rotation sang P2 — payload `P2.<key_id>…`)
  updated_at: string; // ISO8601 (IPC set)
}

export interface AppConfigSetInput {
  patch: Partial<
    Pick<
      ParkingSettings,
      'lot_name' | 'address' | 'phone' | 'logo_data_url' | 'fee_grace_minutes' | 'fee_day_threshold_hours' | 'pb_url' | 'pb_parking_lot'
    >
  >;
}

// ---- Management area M3 (spec ./specs/management-area.md §M3.2 — BE-015) ----
// File-level backup/restore of the SQLite DB. No audit_log table in V1 (P2).

export interface BackupNowInput {
  dest_path?: string; // undefined → mở save-dialog ở main, default parking-YYYYMMDD-HHmm.db
}

export interface BackupNowOutput {
  path: string;
  size_bytes: number;
  backed_up_at: string; // sqlite datetime('now')
}

export interface RestoreFromFileInput {
  source_path?: string; // undefined → mở open-dialog ở main (filter .db)
}

export interface RestoreFromFileOutput {
  backup_path: string; // auto-backup DB hiện tại (pre-restore-TIMESTAMP.db)
  restored_at: string; // sqlite datetime('now') lúc validate xong
  needRestart: true; // app PHẢI restart để mở lại DB mới
}

// ---- Vé QR ký HMAC (spec ./specs/qr-anpr.md §1.2 — BE-018 V1a) ----
// Format: P1.<ticket_code>.<PLATE_NORM>.<IN_TS>.<SIG> (SIG = base64url
// HMAC-SHA256 của 3 field đầu). Key 256-bit ở app-config.json; device lấy
// qua `auth:qr-key` (staff đã login) vào secure storage, verify offline được.
// Chống dùng lại bằng DB status (completed quét lại → USED), không bằng QR.

export interface QrKeyOutput {
  key_b64: string; // base64 key 256-bit (device lưu secure storage, KHÔNG plain prefs)
  key_id: number; // V1 luôn 1
}

export interface QrPayloadOutput {
  qr_text: string; // chuỗi QR text ký xong (render bằng qr_flutter, ECC M)
  ticket_code: string;
  license_plate: string; // biển số chuẩn hóa trong QR (UPPERCASE, không -/./space)
  check_in_at: string;
}

export type QrVerifyReason =
  | 'INVALID_FORMAT' // sai format/version/ticket/plate/ts
  | 'UNSUPPORTED_VERSION' // version lạ → "cập nhật app"
  | 'INVALID_SIGNATURE' // SIG sai → "có thể vé giả"
  | 'NOT_FOUND' // SIG đúng nhưng vé không tồn tại
  | 'PLATE_MISMATCH' // SIG đúng nhưng biển trong QR khác DB (vé bị sửa tay)
  | 'ALREADY_USED' // vé đã check-out/hủy → "đã sử dụng lúc HH:mm"
  | 'NO_KEY'; // server chưa có key (lỗi nội bộ)

export interface QrVerifyOutput {
  valid: boolean;
  reason?: QrVerifyReason;
  message?: string; // câu tiếng Việt render trực tiếp (inline banner)
  session?: ParkingSession;
  fee_preview?: FeePreview | null; // valid + parked → kèm preview phí lúc quét
}

// ---- Phiên bền vững remember-me (BE-023) ----
// Login thêm `remember?`: true → kèm `remember_token` (raw, trả 1 lần duy
// nhất) để renderer cất secure storage; restart app gọi `auth:resume`.
// `LoginOutput` là UserDTO + field optional → tương thích ngược frontend cũ.
export interface LoginInput {
  username: string;
  password: string;
  remember?: boolean;
}
export type LoginOutput = UserDTO & { remember_token?: string };
export interface ResumeInput {
  token: string;
}
export type ResumeOutput = UserDTO & { remember_token: string };
// Logout nhận optional token remember-me để thu hồi (không gửi = chỉ xóa memory).
export type LogoutInput = { token?: string } | void;

/** Channel -> { input, output } map. Preload + renderer use this for typing. */
export interface ApiMap {
  'auth:login': { input: LoginInput; output: IpcResult<LoginOutput> };
  'auth:register': { input: CustomerRegisterInput; output: IpcResult<UserDTO> };
  'auth:resume': { input: ResumeInput; output: IpcResult<ResumeOutput> };
  'auth:logout': { input: LogoutInput; output: IpcResult<null> };
  'auth:me': { input: void; output: IpcResult<UserDTO | null> };
  'zones:list': { input: void; output: IpcResult<ParkingZone[]> };
  'zones:get': { input: { id: number }; output: IpcResult<ParkingZone> };
  'zones:create': {
    input: Pick<ParkingZone, 'code' | 'name' | 'vehicle_type_allowed' | 'capacity' | 'price_per_hour' | 'price_per_day'>;
    output: IpcResult<ParkingZone>;
  };
  'zones:update': {
    input: { id: number } & Partial<Pick<ParkingZone, 'name' | 'vehicle_type_allowed' | 'capacity' | 'price_per_hour' | 'price_per_day' | 'is_active'>>;
    output: IpcResult<ParkingZone>;
  };
  'zones:delete': { input: { id: number }; output: IpcResult<null> };
  'availability:list': { input: { only_active?: boolean }; output: IpcResult<ZoneAvailability[]> };
  'spots:list': { input: { zone_id: number }; output: IpcResult<SpotMapCell[]> };
  'spots:set-status': { input: { spot_id: number; status: SpotStatus }; output: IpcResult<ParkingSpot> };
  'sessions:check-in': { input: CheckInInput; output: IpcResult<ParkingSession> };
  'sessions:check-out': { input: CheckOutInput; output: IpcResult<{ session: ParkingSession; payment: Payment }> };
  'sessions:preview-fee': { input: { ticket_code: string; discount_amount?: number }; output: IpcResult<FeePreview> };
  'sessions:active': { input: { zone_id?: number }; output: IpcResult<ParkingSession[]> };
  'sessions:history': {
    input: { from?: string; to?: string; zone_id?: number; limit?: number; offset?: number };
    output: IpcResult<{ rows: ParkingSession[]; total: number }>;
  };
  'vehicles:find': { input: { license_plate: string }; output: IpcResult<Vehicle | null> };
  'passes:list': {
    input: { status?: PassStatus; search?: string; expiring_within_days?: number };
    output: IpcResult<MonthlyPass[]>;
  };
  'passes:create': {
    input: {
      license_plate: string;
      vehicle_type: VehicleType;
      customer_name: string;
      customer_phone?: string;
      zone_id?: number | null;
      months: 1 | 3 | 6 | 12;
      start_date?: string;
      payment_method?: PaymentMethod;
    };
    output: IpcResult<{ pass: MonthlyPass; payment: Payment }>;
  };
  'passes:renew': {
    input: { pass_code: string; months: 1 | 3 | 6 | 12; payment_method?: PaymentMethod };
    output: IpcResult<{ pass: MonthlyPass; payment: Payment }>;
  };
  'passes:cancel': { input: { pass_code: string; reason?: string }; output: IpcResult<MonthlyPass> };
  'reports:revenue': { input: { from: string; to: string }; output: IpcResult<RevenueDaily[]> };
  'reports:sessions-daily': { input: { from: string; to: string }; output: IpcResult<SessionsDaily[]> };
  'reports:dashboard': {
    input: void;
    output: IpcResult<{
      availability: ZoneAvailability[];
      active_sessions: number;
      revenue_today: number;
      passes_expiring_soon: MonthlyPass[];
    }>;
  };
  'users:list': { input: void; output: IpcResult<UserDTO[]> };
  'users:create': {
    input: { username: string; password: string; full_name: string; role: 'admin' | 'staff' };
    output: IpcResult<UserDTO>;
  };
  'users:toggle-active': { input: { id: number; is_active: 0 | 1 }; output: IpcResult<UserDTO> };
  'users:update': {
    input: {
      id: number;
      username?: string;
      full_name?: string;
      new_password?: string;
      current_password?: string;
      phone?: string | null; // v005 S1: admin-only patch (staff/customer chặn trong handler)
      address?: string | null; // v005 S1: admin-only patch, trim, max 255, rỗng → NULL
      start_date?: string | null; // v005 S1: admin-only patch, 'YYYY-MM-DD', <= today, rỗng → NULL
      notes?: string | null; // v005 S1: admin-only patch, trim, max 500, rỗng → NULL
      permissions?: StaffPermissionsInput | string | null; // v007 S4: admin-only patch,
      // whitelist 5 keys 0|1|boolean (key lạ bỏ qua); target admin → bỏ qua (không lưu);
      // null → reset NULL (= full); string JSON cũng parse như object.
    };
    output: IpcResult<UserDTO>;
  };
  'users:profile': { input: void; output: IpcResult<StaffSelfProfile> };
  'users:profile:update': { input: StaffProfileUpdateInput; output: IpcResult<StaffSelfProfile> };
  'payments:list': {
    input: { from?: string; to?: string; mine_only?: boolean };
    output: IpcResult<Payment[]>;
  };
  'activity:list': { input: ActivityListInput; output: IpcResult<ActivityListOutput> };
  'customer:vehicles': { input: void; output: IpcResult<CustomerVehiclesOutput> };
  'customer:sessions': { input: CustomerSessionsInput; output: IpcResult<CustomerSessionsOutput> };
  'customer:pass-request': { input: CustomerPassRequestInput; output: IpcResult<MonthlyPass> };
  'customer:passes': { input: CustomerPassesInput; output: IpcResult<CustomerPassesOutput> };
  'passes:confirm': { input: PassConfirmInput; output: IpcResult<PassConfirmOutput> };
  'customer:reserve': { input: CustomerReserveInput; output: IpcResult<Reservation> };
  'customer:reservations': { input: CustomerReservationsInput; output: IpcResult<CustomerReservationsOutput> };
  'customer:reserve-cancel': { input: CustomerReserveCancelInput; output: IpcResult<Reservation> };
  'shifts:list': { input: void; output: IpcResult<Shift[]> };
  'shifts:update': { input: ShiftUpdateInput; output: IpcResult<Shift> };
  'attendance:check-in': { input: AttendanceCheckInInput; output: IpcResult<Attendance> };
  'attendance:check-out': { input: AttendanceCheckOutInput; output: IpcResult<AttendanceCheckOutOutput> };
  'attendance:today': { input: void; output: IpcResult<AttendanceTodayOutput> };
  'attendance:list': { input: AttendanceListInput; output: IpcResult<AttendanceListOutput> };
  'reports:transactions': { input: TxListInput; output: IpcResult<TxListOutput> };
  'app-config:get': { input: void; output: IpcResult<ParkingSettings> };
  'app-config:set': { input: AppConfigSetInput; output: IpcResult<ParkingSettings> };
  'pb:test': { input: PbTestInput; output: IpcResult<PbTestResult> };
  'pb:status': { input: void; output: IpcResult<PbStatus> };
  'backup:now': { input: BackupNowInput; output: IpcResult<BackupNowOutput> };
  'restore:from-file': { input: RestoreFromFileInput; output: IpcResult<RestoreFromFileOutput> };
  'auth:qr-key': { input: void; output: IpcResult<QrKeyOutput> };
  'tickets:qr-payload': { input: { ticket_code: string }; output: IpcResult<QrPayloadOutput> };
  'tickets:verify-qr': { input: { qr_text: string }; output: IpcResult<QrVerifyOutput> };
  // BE-021 (notifications.md DS-014 V1): local scheduler desktop (Windows Toast).
  'notify:test': { input: NotifyTestInput; output: IpcResult<NotifyTestOutput> };
}

// ---- Thông báo desktop V1 (spec ./specs/notifications.md — BE-021) ----
// Local scheduler trong Electron main (KHÔNG FCM desktop). Toast click →
// renderer nghe event `notify:deep-link` (preload KHÔNG đụng scope này —
// frontend tự `ipcRenderer.on`) rồi mở đúng tab + highlight row.
// Payload local chung với mobile để P2 thay trigger bằng FCM không đổi UI.

/** 4 sự kiện V1: E1 vé sắp hết · E2 giữ chỗ sắp tới giờ · E3 bãi đầy · E4 ca chưa chốt. */
export type NotifyEvent = 'E1' | 'E2' | 'E3' | 'E4';

/** Tab desktop đích của deep-link (frontend map sang route thật). */
export type NotifyTab = 'passes' | 'reservations' | 'map' | 'attendance';

/** Deep-link gửi kèm Toast click qua event `notify:deep-link`. */
export interface NotifyDeepLink {
  event: NotifyEvent;
  tab: NotifyTab;
  pass_code?: string; // E1: highlight row vé
  code?: string; // E2: focus card mã R-…
  zone_code?: string; // E3: preselect zone còn chỗ
  attendance_id?: number; // E4: focus card ca + badge "Chốt bù"
}

/** Kênh event main → renderer khi user click Toast (renderer tự đăng ký). */
export const NOTIFY_DEEP_LINK_CHANNEL = 'notify:deep-link';

/** Cách 1 Toast được phát (báo cáo trong `notify:test`). */
export type NotifyFireMode =
  | 'toast' // hiện Toast bình thường
  | 'silent' // E2 trong quiet-hours: hiện tray, không âm thanh (priority low)
  | 'deferred' // E1/E4 rơi vào quiet-hours: hoãn tới 06:05, chưa bắn
  | 'skipped-quiet'; // mở app trong giờ im lặng: chỉ badge in-app, không Toast

export interface NotifyFireItem {
  event: NotifyEvent;
  title: string;
  entity: string; // pass_code / R-code / zone_code / attendance id
  mode: NotifyFireMode;
}

export interface NotifyTestInput {
  /** Bắn 1 Toast mẫu của sự kiện (để QA click thử deep-link). Không gửi = dry-run. */
  sample?: NotifyEvent;
}

export interface NotifyTestOutput {
  quiet: boolean; // đang trong quiet-hours lúc test?
  fired: NotifyFireItem[]; // Toast đã bắn (hoặc sẽ bắn ngay khi dry-run ngoài giờ im lặng)
  deferred: NotifyFireItem[]; // bị hoãn tới 06:05 (E1/E4 trong quiet-hours)
}

export type IpcChannel = keyof ApiMap;
