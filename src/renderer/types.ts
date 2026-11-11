// Shared domain types — copied verbatim from ./api-contract.md §1–10.
// Frontend MUST NOT invent new field names; backend owns the schema.

export type RoleName = 'admin' | 'staff' | 'guest' | 'customer';
export type VehicleType = 'car' | 'motorbike';
export type ZoneVehicleAllowed = 'car' | 'motorbike' | 'both';
export type SpotStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';
export type SessionStatus = 'parked' | 'completed' | 'cancelled';
export type PassStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'suspended';
export type ReservationStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'expired';
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'e_wallet';

export interface Role {
  id: number;
  name: RoleName;
  description: string;
  created_at: string;
}

export interface UserDTO {
  id: number;
  username: string;
  full_name: string;
  phone: string | null; // v002: customer bắt buộc (= username = SĐT); staff/admin cũ NULL được
  address: string | null; // v005 S1: địa chỉ, optional, max 255
  start_date: string | null; // v005 S1: ngày vào làm 'YYYY-MM-DD', optional, <= today
  notes?: string | null; // v005 S1: ghi chú nội bộ, optional, max 500 — ADMIN-ONLY
  permissions: string | null; // v007 S4: raw JSON 5 flags, NULL = full staff cũ (DB truth)
  perms: StaffPermissions; // v007 S4: resolved map (admin → full; NULL/lỗi → defaults)
  // Frontend ẩn menu/hành động theo `perms`, KHÔNG parse `permissions` lại.
  role_id: number;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
  role_name: RoleName;
}

// ---- Staff area S4 phân quyền (spec staff-area.md S4.1, migration-007) ----
// Canonical 5 keys, giá trị 0|1. Partial JSON thiếu key = default 1;
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

export interface CheckInInput {
  license_plate: string;
  vehicle_type: VehicleType;
  zone_id: number;
  spot_id?: number;
  owner_name?: string;
  owner_phone?: string;
  reservation_code?: string; // P4 (BE-011): mã giữ chỗ R-… — consume pending → completed
}

export interface CheckOutInput {
  ticket_code: string;
  discount_amount?: number;
  payment_method: PaymentMethod;
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

// Server fee receipt (sessions:preview-fee) — source of truth at checkout.
// Renderer lib/fee.ts stays as instant fallback while this loads.
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

// Staff-safe dashboard bundle (reports:dashboard) — no admin guard.
export interface DashboardSummary {
  availability: ZoneAvailability[];
  active_sessions: number;
  revenue_today: number;
  passes_expiring_soon: MonthlyPass[];
}

// UI-joined view models (derived only — never sent to IPC)
export interface SessionRow extends ParkingSession {
  license_plate: string;
  zone_code: string;
  zone_name: string;
}

export interface PassRow extends MonthlyPass {
  license_plate: string;
  zone_code: string | null;
}

// Activity log (màn "Nhật ký") — mirrors src/shared/types.ts (single source
// of truth). Frontend MUST NOT invent new field names; backend owns the schema.
export type ActivityAction = 'check_in' | 'check_out' | 'pass_sale';

export interface ActivityListInput {
  staff_id?: number;
  from?: string;
  to?: string;
  action?: ActivityAction;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ActivityRow {
  at: string;
  user_id: number | null;
  username: string | null;
  full_name: string | null;
  action: ActivityAction;
  ticket_code: string | null;
  license_plate: string | null;
  zone_code: string | null;
  zone_name: string | null;
  amount: number | null;
  is_monthly_session?: 0 | 1;
  payment_method?: PaymentMethod | null;
  note?: string | null;
}

export interface ActivityListOutput {
  rows: ActivityRow[];
  total: number;
}

// Customer area P2 (spec ./specs/customer-area.md §P2.2) — mirrors
// src/shared/types.ts (single source of truth). Frontend MUST NOT invent
// new field names; backend owns the schema.
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

// Customer area P3 (spec ./specs/customer-area.md §P3.2, nối BE-009) — mirrors
// src/shared/types.ts. Đăng ký trước — trả tiền tại quầy. Vé mới luôn 'pending'.
export interface CustomerPassRequestInput {
  vehicle_id: number; // xe của chính mình (backend verify owner_phone = me.phone)
  zone_id?: number | null; // null/undefined = mọi zone
  package_months: 1 | 3 | 6 | 12; // gói 1/3/6/12 tháng (giá = công thức staff, 12T −10%)
  start_date?: string; // YYYY-MM-DD, default hôm nay
}

export interface PassConfirmInput {
  pass_code: string;
  action: 'approve' | 'reject'; // approve: pending → active + thu tiền; reject: pending → cancelled
  payment_method?: PaymentMethod; // approve: default 'cash'
  reason?: string; // reject: echo vào message, KHÔNG persist (quy ước passes:cancel)
}

export interface PassConfirmOutput {
  pass: MonthlyPass;
  payment: Payment | null; // approve → payment thu tại quầy; reject → null
}

// Staff area S3 (spec ./specs/staff-area.md §S3, nối BE-013) — mirrors
// src/shared/types.ts. Ca + chấm công/bàn giao. Quy ước ca đêm:
// work_date = NGÀY BẮT ĐẦU CA; đối soát lệch chỉ Warning, không chặn.
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
  user_id: number;
  shift_id: number;
  work_date: string; // YYYY-MM-DD = NGÀY BẮT ĐẦU CA
  check_in_at: string | null;
  check_out_at: string | null; // NULL = đang trực
  opening_cash: number; // VND đầu ca
  closing_cash: number | null; // NULL = chưa chốt
  handover_note: string | null;
  status: AttendanceStatus;
  created_at: string;
  updated_at: string;
}

// Row chấm công kèm thông tin ca + NV (table "Ca của tôi" / admin filter).
export interface AttendanceRow extends Attendance {
  shift_code: ShiftCode;
  shift_name: string;
  shift_start: string;
  shift_end: string;
  username: string | null;
  full_name: string | null;
}

// attendance:check-in — staff ép user_id = me (KHÔNG gửi staff_id từ UI;
// chỉ admin chấm hộ mới gửi, backend verify — UI này không có luồng chấm hộ).
export interface AttendanceCheckInInput {
  shift_code?: ShiftCode;
  shift_id?: number;
  opening_cash?: number; // VND >= 0, default 0 (= két rỗng)
  staff_id?: number; // admin-only — renderer KHÔNG gửi
}

// attendance:check-out — chốt ca đang mở gần nhất (kể cả "chốt bù" ca hôm
// qua còn treo). closing_cash optional ở type nhưng UI luôn nhập; thiếu →
// chốt giờ ra, tiền để NULL (admin đối soát sau).
export interface AttendanceCheckOutInput {
  closing_cash?: number | null;
  handover_note?: string | null; // max 500, trim, rỗng → NULL
  staff_id?: number; // admin-only — renderer KHÔNG gửi
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
  total: number;
}

export interface AttendanceCheckOutOutput {
  attendance: Attendance;
  revenue_in_shift: number;
  variance: number | null; // closing - opening - revenue; NULL khi chưa nhập closing
}

export interface AttendanceTodayOutput {
  shift: Shift; // ca hiện tại theo giờ tường
  work_date: string; // work_date của ca hiện tại (quy ước ca đêm)
  attendance: Attendance | null; // row ca hiện tại của mình (NULL = chưa vào ca)
  pending_close: Attendance | null; // row treo cũ nhất (banner "chốt bù")
}

// shifts:update — admin-only config giờ ca. overlap Warning không chặn (S3.3).
export interface ShiftUpdateInput {
  id: number;
  name?: string;
  start_time?: string; // 'HH:mm'
  end_time?: string; // 'HH:mm' (end < start = ca qua ngày)
  is_active?: 0 | 1;
}
// Customer area P4 (spec ./specs/customer-area.md §P4, nối BE-011) — mirrors
// src/shared/types.ts. Chỉ giữ chỗ trong ngày (backend ép date = today).
// pending (≡ spec 'held') ──check-in bằng mã──▶ completed (≡ used);
// quá expires_at ──sweep──▶ expired; khách hủy ──▶ cancelled.
export interface Reservation {
  id: number;
  code: string; // UNIQUE, vd 'R-20261024-0001'
  user_id: number;
  vehicle_id: number | null;
  license_plate: string;
  customer_phone: string;
  zone_id: number;
  spot_id: number | null;
  date: string; // YYYY-MM-DD (= today ở V1)
  start_time: string; // HH:mm, >= '06:00'
  end_time: string; // HH:mm, <= '22:00', duration 1–4h
  status: ReservationStatus; // pending ≡ đang giữ
  expires_at: string; // ISO8601 = start + ~20p
  created_at: string;
  updated_at: string;
}

export interface CustomerReserveInput {
  zone_id: number;
  license_plate: string;
  vehicle_type?: VehicleType;
  date?: string;
  start_time?: string; // HH:mm (alias time_from)
  end_time?: string; // HH:mm (alias time_to)
  time_from?: string;
  time_to?: string;
}

export interface CustomerReservationsInput {
  status?: ReservationStatus;
  limit?: number;
  offset?: number;
}

export interface CustomerReservationRow extends Reservation {
  zone_code: string | null;
  zone_name: string | null;
  spot_number: string | null;
}

export interface CustomerReservationsOutput {
  rows: CustomerReservationRow[];
  total: number;
}

// ---- Management area M1 (spec ./specs/management-area.md §M1.2, nối BE-015) ----
// Read-only detail of every payment transaction (tab "Chi tiết" + Excel export).
// Aggregate tab reuses v_revenue_daily / v_sessions_daily (2 calls per period).
export type TxKind = 'casual' | 'monthly' | 'adjust';

export interface TxListInput {
  from: string; // YYYY-MM-DD (inclusive, theo payments.paid_at)
  to: string; // YYYY-MM-DD (inclusive)
  zone_ids?: number[]; // multi-select mới (undefined/rỗng = tất cả)
  kind?: TxKind; // vé lượt / vé tháng / điều chỉnh (note LIKE 'điều chỉnh%')
  payment_method?: PaymentMethod;
  search?: string; // match ticket_code / pass_code / license_plate (LIKE, uppercase)
  granularity?: 'day' | 'week' | 'month' | 'year'; // accepted + validated; IPC luôn trả chi tiết
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

// ---- Management area M2 (spec ./specs/management-area.md §M2.2, nối BE-015) ----
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
  // (không thử online). File cũ thiếu → mặc định DEFAULT_PB_URL (lib/management).
  pb_parking_lot: string | null; // BE-017: id bãi server (parking_lots) — null
  // = chưa cấu hình = local-only (không thử online). Xin id từ system_admin.
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

// ---- PocketBase online (nối BE-016 auth + BE-017 schema thật, mirrors
// src/shared/types.ts). V1 local-first: `online` chỉ phản ánh ping gần nhất.
export type PbMode = 'local-first' | 'online';

export interface PbStatus {
  online: boolean; // ping /api/health OK trong timeout
  mode: PbMode; // V1 luôn 'local-first'
  pb_url: string; // '' khi chưa cấu hình (local-only)
  latency_ms: number | null;
  parking_lot: string | null; // BE-017: id bãi server đang dùng; null = chưa cấu hình
}

export interface PbTestInput {
  url?: string; // override tạm để test (không lưu); undefined → dùng URL đã cấu hình
}

export interface PbTestResult {
  reachable: boolean;
  pb_url: string;
  latency_ms: number | null;
}

// ---- Management area M3 (spec ./specs/management-area.md §M3.2, nối BE-015) ----
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

export interface CustomerReserveCancelInput {
  code: string; // mã R-… của chính mình, chỉ khi 'pending'
}
