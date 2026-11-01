# API Contract — Parking Management (SQLite + Electron)

> Nguồn sự thật cho schema: `./specs/schema.sql` + seed `./specs/seed.sql`.
> File này để **@node-developer** (IPC handlers / better-sqlite3 queries) và **@frontend-react**
> (UI types) dùng chung — tránh schema drift. Mọi đổi cột/bảng PHẢI sửa cả 3 file.
>
> Quy ước: datetime = `string` ISO8601 UTC (`YYYY-MM-DD HH:MM:SS`),
> tiền = `number` nguyên **VND**, boolean SQLite = `0 | 1`.

---

## 1. Enums dùng chung

```ts
export type RoleName = 'admin' | 'staff' | 'guest' | 'customer';
export type VehicleType = 'car' | 'motorbike';
export type ZoneVehicleAllowed = 'car' | 'motorbike' | 'both';
export type SpotStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';
export type SessionStatus = 'parked' | 'completed' | 'cancelled';
export type PassStatus = 'pending' | 'active' | 'expired' | 'cancelled' | 'suspended';
export type ReservationStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'expired';
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'e_wallet';
export type ShiftCode = 'MORNING' | 'AFTERNOON' | 'NIGHT';
export type AttendanceStatus = 'present' | 'late' | 'missing';
```

---

## 2. `roles` — vai trò (seed cố định id 1/2/3 + 4 customer từ migration-002)

```ts
export interface Role {
  id: number;                       // 1 admin / 2 staff / 3 guest / 4 customer (DB chuẩn)
  name: RoleName;
  description: string;
  created_at: string;
}
```

- Quan hệ: `roles 1—N users`.
- Ghi chú: `guest` read-only, **không có row trong `users`**, không login.
  `customer` resolve `role_id` **bằng name** (`SELECT id FROM roles WHERE name='customer'`),
  không hardcode 4 (DB cũ migrate vẫn ra đúng row, id có thể lệch nếu DB từng có id 4 lạ).

---

## 3. `users` — Admin / Nhân viên / Khách tự đăng ký

```ts
export interface User {
  id: number;
  username: string;          // UNIQUE, >= 3 ký tự. Customer: username = SĐT
  password_hash: string;     // bcrypt hash — KHÔNG BAO GIỜ trả về frontend
  full_name: string;         // Customer: họ tên lúc đăng ký
  phone: string | null;      // v002: UNIQUE qua idx_users_phone (NULL distinct);
                             // staff/admin cũ NULL được, customer bắt buộc (validate ở app)
  address: string | null;    // v005 S1: địa chỉ, optional, max 255 (app trim + validate)
  start_date: string | null; // v005 S1: ngày vào làm 'YYYY-MM-DD', optional, <= today (app)
  notes: string | null;      // v005 S1: ghi chú nội bộ, optional, max 500 (app),
                             // ADMIN-ONLY — SELECT loại khỏi DTO khi role='staff'
                             // (kể cả xem chính mình); users:profile:update không nhận
  permissions: string | null; // v007 S4: JSON 5 flags per-user, NULL = full staff cũ
                             // (resolve = STAFF_DEFAULTS, không backfill).
                             // Canonical keys 0|1 (app chấp nhận true/false lúc parse):
                             // {"checkin":1,"pass_sale":1,"report_self":1,
                             //  "profile_self":1,"reservation":1}
                             // Partial JSON thiếu key = default 1; key lạ → bỏ qua;
                             // admin → bỏ qua (luôn full). Xem §11 + staff-area.md S4.
  role_id: number;           // FK → roles.id (RESTRICT khi xóa role còn user)
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

// DTO trả về UI (đã lược bỏ password_hash; staff KHÔNG bao giờ thấy notes)
export interface UserDTO extends Omit<User, 'password_hash'> {
  role_name: RoleName;
}

// Hồ sơ staff tự xem (users:profile GET — KHÔNG có notes, staff-area.md S1.3)
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
// users:profile:update — staff chỉ được tự sửa { phone?, address? } (S1.4);
// full_name/username/start_date đổi qua "Đề xuất sửa đổi" V1 = note liên hệ quản lý.
// Admin sửa full hồ sơ (gồm notes) qua users:update patch mở rộng.
// Migration: ./specs/migration-005-staff-profile.sql (backup .bak-005).

// Phân quyền chi tiết S4 (staff-area.md S4, migration-007, backup .bak-007)
// Giữ role làm mặc định + fallback; permissions chỉ thu hẹp/nới trong biên staff.
export interface StaffPermissions {
  checkin: 0 | 1;      // check-in/out + thu phí (mặc định 1)
  pass_sale: 0 | 1;    // bán/gia hạn vé tháng (mặc định 1)
  report_self: 0 | 1;  // báo cáo + hiệu suất ca mình (mặc định 1)
  profile_self: 0 | 1; // tự sửa SĐT/địa chỉ của mình (mặc định 1, khóa S1.4)
  reservation: 0 | 1;  // xác nhận/hủy đặt chỗ §13 (mặc định 1)
}
export const STAFF_DEFAULTS: StaffPermissions =
  { checkin: 1, pass_sale: 1, report_self: 1, profile_self: 1, reservation: 1 };
// Rule resolve (backend, lúc login + mọi guard liên quan):
// resolvePerm(user, key) = user.role === 'admin' ? 1 : (parse(user.permissions)?.[key] ?? 1)
// (parse chấp nhận true/false → normalize 0/1; JSON hỏng → defaults + warn log).
// users:list SELECT thêm permissions; users:update patch thêm permissions?
// (whitelist 5 keys, giá trị 0/1; set cho admin → bỏ qua; không tự hạ quyền mình).
// Error mới: FORBIDDEN('NO_PERMISSION:<key>') → toast "không có quyền {label}".
// Tương thích ngược: NULL = full staff cũ (guard role cũ giữ nguyên mọi IPC hiện có).
// Migration: ./specs/migration-007-permissions.sql (backup .bak-007).
```

- Quan hệ: `users N—1 roles`; `users 1—N parking_sessions` (qua `created_by`/`closed_by`);
  `users 1—N payments` (qua `received_by`).
- Ghi chú: xóa user → FK `SET NULL` ở sessions/payments (giữ lịch sử).
  Customer đăng nhập bằng **login-by-username hiện có** (`username = SĐT`) — không sửa login.
  UNIQUE DB cho nhiều NULL cùng tồn tại nên staff cũ `phone NULL` không vi phạm;
  app bắt buộc `phone` non-null + duy nhất riêng cho customer (xem §12).

---

## 4. `parking_zones` — khu vực đỗ xe

```ts
export interface ParkingZone {
  id: number;
  code: string;                       // UNIQUE, vd 'A'
  name: string;                       // vd 'Khu A - Ô tô'
  vehicle_type_allowed: ZoneVehicleAllowed;
  capacity: number;                   // > 0
  price_per_hour: number;             // VND
  price_per_day: number;              // VND
  is_active: 0 | 1;                   // tắt = không nhận xe mới, xe đang đỗ giữ nguyên
  created_at: string;
  updated_at: string;
}
```

- Quan hệ: `parking_zones 1—N parking_spots` (CASCADE: xóa zone xóa spots);
  `parking_zones 1—N parking_sessions` (RESTRICT: còn lịch sử thì không xóa zone).
- Seed: `A` ô-tô 20k/h, `B` xe-máy 5k/h, `C` hỗn hợp 10k/h.

---

## 5. `parking_spots` — chỗ đỗ vật lý

```ts
export interface ParkingSpot {
  id: number;
  zone_id: number;                    // FK → parking_zones.id (CASCADE)
  spot_number: string;                // vd 'A-01', UNIQUE theo (zone_id, spot_number)
  status: SpotStatus;
  created_at: string;
  updated_at: string;
}
```

- Quan hệ: `parking_spots N—1 parking_zones`; `parking_spots 1—N parking_sessions`
  (qua `spot_id`, `SET NULL` khi xóa spot để giữ lịch sử vé).
- Luồng: check-in `available → occupied`; check-out `occupied → available`.
  App tự update — không có trigger DB ẩn.

---

## 6. `vehicles` — xe (định danh bằng biển số)

```ts
export interface Vehicle {
  id: number;
  license_plate: string;              // UNIQUE, app chuẩn hóa UPPERCASE
  vehicle_type: VehicleType;
  owner_name: string;
  owner_phone: string;
  created_at: string;
  updated_at: string;
}
```

- Quan hệ: `vehicles 1—N parking_sessions`, `vehicles 1—N monthly_passes`
  (RESTRICT: còn vé/pass thì không xóa xe — dùng lịch sử).

---

## 7. `monthly_passes` — vé tháng

```ts
export interface MonthlyPass {
  id: number;
  pass_code: string;                  // UNIQUE, vd 'MT-2026-0001'
  vehicle_id: number;                 // FK → vehicles.id
  zone_id: number | null;             // NULL = áp dụng mọi zone
  customer_name: string;
  customer_phone: string;
  start_date: string;                 // YYYY-MM-DD
  end_date: string;                   // YYYY-MM-DD, CHECK end > start
  price: number;                      // VND
  status: PassStatus;
  created_by: number | null;          // FK → users.id
  created_at: string;
  updated_at: string;
}
```

- Quan hệ: `monthly_passes N—1 vehicles`; `monthly_passes N—1 parking_zones` (nullable);
  `monthly_passes 1—N parking_sessions` (xe vé tháng check-in vẫn tạo session, `total_fee = 0`).
- Logic hết hạn: app cron/job đánh `active → expired` khi `date('now') > end_date`
  (không trigger DB để dễ test).
- Luồng P3 (`customer-area.md`): khách tự đăng ký → `pending`; staff xác nhận khi
  thu tiền tại quầy → `active` (+ `INSERT payments` cùng transaction), hoặc từ
  chối/khách hủy → `cancelled`. Migration: `./specs/migration-003-pass-pending.sql`.

---

## 8. `parking_sessions` — vé / lượt gửi (check-in/out)

```ts
export interface ParkingSession {
  id: number;
  ticket_code: string;                // UNIQUE, vd 'T-20261016-0001'
  vehicle_id: number;                 // FK → vehicles.id
  spot_id: number | null;             // FK → parking_spots.id (nullable giữ lịch sử)
  zone_id: number;                    // FK → parking_zones.id
  monthly_pass_id: number | null;     // FK → monthly_passes.id (vé tháng còn hiệu lực)
  check_in_at: string;
  check_out_at: string | null;        // CHECK > check_in_at
  status: SessionStatus;              // 'parked' => check_out_at IS NULL
  hourly_rate_applied: number;        // snapshot giá zone lúc check-in (VND)
  daily_rate_applied: number;         // snapshot giá zone lúc check-in (VND)
  total_fee: number | null;           // chốt lúc check-out; vé tháng = 0
  discount_amount: number;            // VND, default 0
  created_by: number | null;
  closed_by: number | null;
  created_at: string;
  updated_at: string;
}

// Payload check-in (staff)
export interface CheckInInput {
  license_plate: string;
  vehicle_type: VehicleType;
  zone_id: number;
  spot_id?: number;                   // nếu không chỉ định, app auto-pick spot trống
}

// Payload check-out (staff) — phí do backend tính, frontend chỉ hiển thị
export interface CheckOutInput {
  ticket_code: string;
  discount_amount?: number;
  payment_method: PaymentMethod;
}
```

- Công thức phí (khớp spec `./specs/parking-app.md` §d — backend chốt, frontend preview):
  `phút = (out - in)`; `phút <= 30 → tính 1 giờ` (làm tròn tối thiểu);
  ngược lại `giờ = ceil(phút / 60)`; nếu qua đêm / `giờ >= 12` → áp `daily_rate_applied`,
  ngược lại `giờ × hourly_rate_applied`; `total = max(0, fee - discount)`;
  vé tháng còn hiệu lực → `total = 0`.
- Gói vé tháng (spec §e): 1 / 3 / 6 / 12 tháng, gói 12 tháng giảm 10% —
  app tính `price` lúc bán, DB chỉ lưu kết quả.
- Transaction check-out (1 better-sqlite3 transaction):
  `UPDATE sessions SET ... + UPDATE spots SET available + INSERT payments`.

---

## 9. `payments` — giao dịch thu phí (append-only)

```ts
export interface Payment {
  id: number;
  session_id: number | null;          // FK → parking_sessions.id
  monthly_pass_id: number | null;     // FK → monthly_passes.id
  amount: number;                     // VND thực thu
  payment_method: PaymentMethod;
  paid_at: string;
  received_by: number | null;         // FK → users.id
  note: string;
  created_at: string;
}
// Ràng buộc: session_id và monthly_pass_id ít nhất 1 cái NOT NULL.
```

- Ghi chú: **không UPDATE/DELETE** từ app (sửa sai = tạo payment điều chỉnh mới + note).
  Báo cáo doanh thu query theo `paid_at`.

---

## 10. Views (đọc trực tiếp qua better-sqlite3 như table)

```ts
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
// SELECT * FROM v_zone_availability WHERE is_active = 1  → màn hình Khách + check-in

export interface RevenueDaily {
  day: string;                        // YYYY-MM-DD
  payment_method: PaymentMethod;
  tx_count: number;
  revenue: number;                    // VND
}
// SELECT * FROM v_revenue_daily WHERE day BETWEEN ? AND ? ORDER BY day

export interface SessionsDaily {
  day: string;                        // YYYY-MM-DD (theo check_in_at)
  zone_id: number;
  entries: number;                    // lượt vào
  exits: number;                      // lượt ra (đã check-out)
  still_parked: number;               // còn đang đỗ
}
// SELECT * FROM v_sessions_daily WHERE day BETWEEN ? AND ? ORDER BY day

export interface SpotMapCell {
  spot_id: number;
  zone_id: number;
  zone_code: string;
  spot_number: string;                // vd 'A-01'
  status: SpotStatus;
  occupying_plate: string | null;     // biển số xe đang đỗ (Guest view grid)
}
// SELECT * FROM v_spot_map WHERE zone_id = ? ORDER BY spot_number
// → render grid 1 cell/row; poll 30s (spec parking-app.md §g)
```

---

## 11. Ma trận quyền (để @node-developer gắn IPC guard + @frontend-react ẩn/hiện menu)

| Chức năng | admin | staff | guest | customer |
|---|---|---|---|---|
| Cấu hình zones/giá/spots | ✅ | ❌ | ❌ | ❌ |
| Quản lý users | ✅ | ❌ | ❌ | ❌ |
| Check-in / check-out / thu phí | ✅ | ✅ | ❌ | ❌ |
| Bán vé tháng | ✅ | ✅ | ❌ | ❌ (chỉ xem vé của mình — mở rộng sau) |
| Báo cáo doanh thu | ✅ | ❌ (chỉ xem ca mình*) | ❌ | ❌ |
| Xem chỗ trống | ✅ | ✅ | ✅ (read-only) | ✅ (read-only) |
| Tự đăng ký / đăng nhập bằng SĐT | — | — | — | ✅ (mới, §12) |
| Đặt chỗ trước (giữ chỗ trong ngày) | ✅ | ✅ (hủy/xác nhận) | ❌ | ✅ (chỉ chỗ của mình — §13) |

`*` quyết định mở rộng: nếu cần staff xem báo cáo ca mình thì filter `received_by = staff_id`.

**S4 flags per-user** (staff-area.md S4, `users.permissions` NULL = full cũ):
`checkin` ↔ Check-in/out dòng 3; `pass_sale` ↔ Bán vé tháng dòng 4;
`report_self` ↔ Báo cáo ca mình dòng 5 (`*`); `reservation` ↔ Đặt chỗ dòng 8;
`profile_self` ↔ tự sửa SĐT/địa chỉ (S1.4). Admin luôn full (bỏ qua cột).
Thiếu flag → `FORBIDDEN('NO_PERMISSION:<key>')`.
Migration: `./specs/migration-007-permissions.sql` (backup `.bak-007`).

---

## 12. Đăng ký khách hàng (mới từ migration-002, dành cho @node-developer)

```ts
export interface CustomerRegisterInput {
  phone: string;                // SĐT VN 10 số, bắt đầu bằng 0 — app validate, đồng thời làm username
  password: string;             // >= 6 ký tự — app bcrypt.hash(password, 10)
  full_name: string;            // họ tên, >= 1 ký tự
}

export interface CustomerRegisterOutput {
  success: boolean;
  data?: UserDTO;               // role_name = 'customer', phone = username = SĐT
  error?: string;               // 'PHONE_TAKEN' (409) | 'INVALID_PHONE' (400) | ...
}
```

- Luồng DB (1 better-sqlite3 transaction): resolve `role_id` bằng name → `INSERT INTO users
  (username, password_hash, full_name, phone, role_id) VALUES (phone, hash, full_name, phone, id)`.
- Lỗi trùng SĐT: `username` và `phone` đều UNIQUE → bắt `SQLITE_CONSTRAINT_UNIQUE`, trả 409.
- Guard login hiện tại chỉ chặn `guest` → customer đăng nhập bình thường, không sửa login.

---

## 13. `reservations` — đặt chỗ trước (P4 `customer-area.md`, migration-004)

```ts
export interface Reservation {
  id: number;
  code: string;                   // UNIQUE, vd 'R-20261024-0001' (app sinh)
  user_id: number;                // FK → users.id (RESTRICT: giữ lịch sử đối soát)
  vehicle_id: number | null;      // FK → vehicles.id, NULLABLE — đặt trước khi có xe
  license_plate: string;          // biển số gõ tay (app UPPERCASE), đối soát khi chưa link xe
  customer_phone: string;         // snapshot SĐT lúc đặt (pattern monthly_passes)
  zone_id: number;                // FK → parking_zones.id
  spot_id: number | null;         // FK → parking_spots.id, ô auto-pick (NULL = chỉ giữ theo khu)
  date: string;                   // YYYY-MM-DD (= today ở V1, backend ép)
  start_time: string;             // HH:mm, CHECK >= '06:00', end > start, duration 1–4h
  end_time: string;               // HH:mm, CHECK <= '22:00'
  status: ReservationStatus;      // pending ≡ spec 'held' (đang giữ)
  expires_at: string;             // ISO8601 = start + ~20p (app tính, sweep job dùng)
  created_at: string;
  updated_at: string;
}

// IPC customer (mine-only: backend ép user_id = me.id, không nhận từ client)
export interface CustomerReserveInput {
  zone_id: number;
  date: string;                   // phải = today (V1), backend check
  time_from: string;              // HH:mm → start_time
  time_to: string;                // HH:mm → end_time
}
export interface CustomerReserveOutput {
  success: boolean;
  data?: Reservation;             // kèm spot giữ + expires_at
  error?: string;                 // 'ZONE_FULL' | 'QUOTA_EXCEEDED' (đã có 2 chỗ) |
                                  // 'INVALID_SLOT' (sai khung/ngoài giờ/quá khứ) | ...
}
// customer:reservations → {rows: Reservation[]} (chỉ của mình, ORDER BY date, start_time)
// customer:reserve-cancel {code} → chỉ của mình + status 'pending' (spot về 'available')
// Check-in bằng mã: CheckInInput + `reservation_code?` → consume pending → active
```

- Quan hệ: `reservations N—1 users`; `reservations N—1 vehicles` (nullable, `SET NULL`);
  `reservations N—1 parking_zones` (RESTRICT); `reservations N—1 parking_spots` (nullable, `SET NULL`).
- Luồng status: `pending` (giữ chỗ) ──check-in──▶ `active` ──dùng xong──▶ `completed`;
  quá `expires_at` ──sweep──▶ `expired` (+ spot → `available`); khách/staff hủy ──▶ `cancelled`.
- Quota (backend, 1 transaction): `SELECT COUNT(*) FROM reservations
  WHERE user_id = ? AND status IN ('pending','active') AND date = ?` ≥ 2 → từ chối
  `QUOTA_EXCEEDED` (dùng `idx_res_user_status_date`). SQLite cấm subquery trong CHECK
  nên không ép quota ở DB.
- Sweep tự hủy (backend — job khi mở app + check lúc check-in, poll 60s ở tab Đặt chỗ):
  `UPDATE reservations SET status = 'expired' WHERE status = 'pending'
  AND expires_at < datetime('now')` (+ trả spot giữ về `available`,
  dùng `idx_res_status_expires`).
- Quota/sweep/capacity dùng 4 index v004 (`idx_res_user_status_date`,
  `idx_res_zone_date_status`, `idx_res_status_expires`, `idx_res_vehicle`).
  Migration: `./specs/migration-004-reservations.sql` (backup `.bak-004`).

---

## 14. `shifts` + `attendance` — ca làm việc + chấm công/bàn giao (S3 `staff-area.md`, migration-006)

```ts
export interface Shift {
  id: number;
  code: ShiftCode;                  // UNIQUE: 'MORNING' | 'AFTERNOON' | 'NIGHT'
  name: string;                     // 'Ca sáng' | 'Ca chiều' | 'Ca đêm'
  start_time: string;               // 'HH:MM' — ca đêm end < start (= qua ngày)
  end_time: string;                 // 'HH:MM'
  is_active: 0 | 1;                 // tắt = không xếp ca mới, lịch sử giữ nguyên
  created_at: string;
  updated_at: string;
}
// Seed mặc định: MORNING 06:00–14:00 / AFTERNOON 14:00–22:00 / NIGHT 22:00–06:00(+1).
// App resolve shift_id bằng code, không hardcode id (pattern roles/customer §2).

export interface Attendance {
  id: number;
  user_id: number;                  // FK → users.id (RESTRICT: còn chấm công không xóa user)
  shift_id: number;                 // FK → shifts.id (RESTRICT: còn lượt trực không xóa ca)
  work_date: string;                // YYYY-MM-DD = NGÀY BẮT ĐẦU CA (xem quy ước ca đêm)
  check_in_at: string | null;       // ISO8601 thực tế bấm vào (NULL = chưa vào / missing)
  check_out_at: string | null;      // ISO8601 thực tế bấm ra (NULL = đang trực)
  opening_cash: number;             // VND đầu ca, default 0 (prefill từ closing ca trước)
  closing_cash: number | null;      // VND cuối ca (NULL = chưa chốt)
  handover_note: string | null;     // bàn giao, max 500 (app)
  status: AttendanceStatus;         // 'present' (đúng giờ) | 'late' (trễ) | 'missing' (vắng)
  created_at: string;
  updated_at: string;
}
// UNIQUE(user_id, shift_id, work_date): 1 NV 1 ca 1 ngày 1 row.
// Trùng → SQLITE_CONSTRAINT_UNIQUE → app map 'ALREADY_CHECKED_IN'.

// Quy ước CA ĐÊM QUA NGÀY (chốt 1 cách — backend + frontend cùng tuân thủ):
// work_date = ngày chứa giờ BẮT ĐẦU ca. VD trực NIGHT 22:00 24/10 → 06:00 25/10
// thì work_date = '2026-10-24'. check_out_at ĐƯỢC sang ngày sau (chỉ ép
// check_out_at > check_in_at). App xác định "ca hiện tại" theo giờ tường:
// 00:00–06:00 → NIGHT của work_date = hôm qua; 06:00–14:00 → MORNING today;
// 14:00–22:00 → AFTERNOON today; 22:00–24:00 → NIGHT today.
// Mọi báo cáo GROUP BY work_date (không GROUP BY date(check_in_at)).

// Đối soát (app tính, DB không ép — lệch chỉ Warning, không chặn chốt ca):
// variance = closing_cash - opening_cash - revenue_trong_ca
// (revenue từ activity:list / payments cùng khoảng ca); hiển thị "khớp/lệch ±X₫".

// IPC staff (mine-only: backend ép user_id = me.id, không nhận từ client):
// shifts:list → {rows: Shift[]} (mọi staff xem giờ ca)
// shifts:update {id, name?, start_time?, end_time?, is_active?} — admin-only;
//   validate HH:MM, start ≠ end; end < start chỉ cho ca qua ngày (ghi chú rõ);
//   overlap Warning không chặn (S3.3)
// attendance:check-in {shift_id?, opening_cash?} → ép user_id = me,
//   work_date = ca hiện tại theo quy ước trên; trùng → 'ALREADY_CHECKED_IN';
//   status do backend quyết (present/late theo giờ vào vs start_time + grace app)
// attendance:check-out {closing_cash, handover_note?} → ép me, yêu cầu đã check-in
//   (chưa → 'NOT_CHECKED_IN'); lệch đối soát → Warning kèm data, vẫn chốt
// attendance:list {from, to, staff_id?} → staff ép me (pattern mine_only);
//   admin lọc staff_id; ORDER BY work_date (dùng idx_att_user_date / idx_att_date)
// attendance:today → row ca hiện tại của me (render nút Vào/Ra + banner "chốt bù"
//   khi work_date hôm qua còn check_out_at IS NULL)
// Chốt bù: cho check_out_at muộn + note, UI gắn badge "Chốt bù" (S3.5).
```

- Quan hệ: `shifts 1—N attendance`; `users 1—N attendance` (RESTRICT cả hai —
  xóa định nghĩa ca/user còn lịch sử bị chặn; tắt ca dùng `is_active = 0`).
- Index v006: `idx_att_user_date(user_id, work_date)` ("Ca của tôi" + today),
  `idx_att_date(work_date)` (báo cáo ngày + banner quên chốt),
  `idx_att_shift_date(shift_id, work_date)` (đối soát theo ca).
  UNIQUE đã có autoindex (chặn trùng + lookup 3 cột).
  Migration: `./specs/migration-006-shifts.sql` (backup `.bak-006`).

---

## 15. Khu vực Quản lý M1–M3 (BE-015, `management-area.md` — admin-only, 0 bảng/cột DB mới)

```ts
// M1 — chi tiết giao dịch (read-only; aggregate dùng lại views §10)
export type TxKind = 'casual' | 'monthly' | 'adjust';
export interface TxListInput {
  from: string; to: string;             // YYYY-MM-DD theo payments.paid_at
  zone_ids?: number[];                  // undefined/rỗng = tất cả
  kind?: TxKind;                        // adjust = note LIKE 'điều chỉnh%'
  payment_method?: PaymentMethod;
  search?: string;                      // ticket/pass code / biển số (LIKE)
  granularity?: 'day' | 'week' | 'month' | 'year'; // accepted; detail luôn trả chi tiết
  limit?: number;                       // default 50, max 200
  offset?: number;
}
export interface TxRow {
  paid_at: string; payment_id: number; kind: TxKind;
  ticket_code: string | null; license_plate: string | null;
  zone_code: string | null; zone_name: string | null;
  received_by_name: string | null; received_by_username: string | null;
  payment_method: PaymentMethod | null; amount: number; note: string | null;
}
export interface TxListOutput {
  rows: TxRow[]; total: number;
  summary: { revenue: number; tx_count: number; avg: number };
}
// reports:transactions {TxListInput} → {rows (paid_at DESC), total, summary}
// Lỗi: 'Ngày bắt đầu phải ≤ ngày kết thúc' | whitelist kind/method/granularity.

// M2 — cấu hình (file userData/app-config.json, KHÔNG bảng DB)
export interface ParkingSettings {
  lot_name: string;                     // required 1–100
  address: string | null;               // max 255
  phone: string | null;                 // /^0\d{9}$/
  logo_data_url: string | null;         // PNG/JPG dataURL ≤ 512KB
  fee_grace_minutes: number;            // default 30, int 0–120
  fee_day_threshold_hours: number;      // default 12, int 1–24
  updated_at: string;
}
// app-config:get void → {ParkingSettings} (lần đầu → defaults)
// app-config:set {patch: Partial<…>} → validate + cross-rule
//   (threshold×60 > grace) + persist → {ParkingSettings}
// Lỗi mang mã: 'INVALID_PHONE' | 'LOGO_TOO_LARGE' | 'INVALID_FEE_RULE'
//   (trong message + errors field-level). Fee preview/check-out đọc hằng số
//   này thay vì hardcode 30p/12h (refactor nội bộ, không đổi IPC cũ).

// M3 — sao lưu / khôi phục file .db (KHÔNG bảng audit_log ở V1)
export interface BackupNowInput { dest_path?: string }  // undefined → save-dialog ở main
export interface BackupNowOutput { path: string; size_bytes: number; backed_up_at: string }
// backup:now → checkpoint WAL (retry DB_BUSY 2s × 3) + copy → {path,…}
// Auto-job main-process 03:00 hằng ngày, giữ 7 bản parking-YYYYMMDD-HHmm.db.
export interface RestoreFromFileInput { source_path?: string }  // undefined → open-dialog ở main
export interface RestoreFromFileOutput { backup_path: string; restored_at: string; needRestart: true }
// restore:from-file → validate header SQLite + integrity_check + foreign_key_check
//   + bảng bắt buộc + user_version; chặn khi còn xe đỗ (HAS_PARKED_VEHICLES);
//   auto-backup pre-restore-TIMESTAMP.db → chép đè → needRestart (mọi IPC sau
//   đó trả 'khởi động lại app' cho đến khi restart).
// Lỗi: 'NOT_SQLITE' | 'INTEGRITY_FAIL' | 'SCHEMA_MISMATCH' | 'HAS_PARKED_VEHICLES'.
```
