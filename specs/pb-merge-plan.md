# PB Merge Plan — Gộp an toàn với server mqaue7 (DB-009)

> Nguyên tắc: **GIỮ NGUYÊN 100% server, chỉ CỘNG THÊM.**
> File import cũ `./specs/pocketbase-collections.json` ĐỊNH NGHĨA LẠI `users`/collections hệ thống
> với ID khác → PB đòi xóa `_mfas` → **BỎ, không dùng nữa.**
> Thay bằng: 1 file import nhỏ (`pocketbase-attendance.json`) + 2 thao tác tay trên UI (2 phút).
> Nguồn đối chiếu duy nhất: `./specs/pb-server-map.json` (12 collections) + `./api-contract.md` (app ta).

---

## 1. Import collection mới (1 file, không động tới collection khác)

- File: `./specs/pocketbase-attendance.json` — CHỈ chứa 1 collection `attendance`, id fresh
  `pbc_9142083765` (không trùng bất kỳ id nào trong `pb-server-map.json`).
- Cách import: Admin UI → **Settings → Import collections** (hoặc nút Import ở trang Collections)
  → chọn file → **chỉ hiện 1 collection `attendance`** → Confirm.
  Nếu dialog hiện thêm collection nào khác → CANCEL, báo lại cho @database.
- Vì sao `shift_code` là text thay vì relation → `shifts` server?
  `shifts` server (`pbc_705563745`) là **instance ca trực** (staff/start_at/end_at/open/closed/opening_cash…),
  KHÁC semantics với bảng `shifts` app ta (định nghĩa ca MORNING/AFTERNOON/NIGHT).
  Dùng text `shift_code` để tránh FK sai nghĩa; đối soát ca trực qua query `shifts` server riêng (§4.9).

## 2. Thao tác tay trên UI (user tự làm, ~2 phút) — EXACT clicks

### 2A. `users` — thêm field `username` + bật login bằng username

1. Mở `https://mqaue7.bot-keep.xyz/_/` → login tài khoản `system_admin`.
2. Sidebar trái → **Collections** → click collection **`users`**.
3. Tab **Fields** → nút **+ New field** → chọn **Text**.
   - Name = `username`, Required = **OFF**, Unique = **ON**, Min = `3`, Max = `150` → **Create**.
4. Vẫn trong collection `users` → tab/biểu tượng **Settings** (bánh răng, "Edit collection")
   → mục **Password auth** → **Identity fields** → tick **thêm `username`** (GIỮ `email` đã tick)
   → **Save**.
5. Kiểm tra: tạo/sửa 1 user test, điền `username`, logout, login lại bằng `username` + password → OK.

> Không đổi gì khác trong `users`. `email` vẫn required ở server — khi BE tạo user qua SDK,
> nếu không có email thật thì dùng email placeholder `username@lot.local` (ghi rõ trong code).

### 2B. `monthly_passes` — thêm giá trị `pending` cho `status`

1. Sidebar trái → **Collections** → click **`monthly_passes`**.
2. Tab **Fields** → click field **`status`** (type Select).
3. Mục **Values** → **+ Add** → nhập `pending` (giữ nguyên 4 giá trị cũ
   `active/expired/suspended/cancelled`) → **Save**.
4. Kiểm tra: tạo 1 pass test với `status = pending` → OK rồi xóa row test.

> Xong 2 bước này là server đủ cho app chạy. Không sửa gì khác.

---

## 3. Bảng mapping entity app ta → collection/field server

Ký hiệu: ✅ map 1-1 · 🔀 đổi tên/giá trị · ➕ server bắt buộc thêm · ❌ server KHÔNG có (xử lý ở cột cuối).
Mọi field server dưới đây đều có trong `pb-server-map.json` — không bịa.

### 3.1 `users` (app) → `users` (`_pb_users_auth_`)

| App (`api-contract.md` §3) | Server | Xử lý |
|---|---|---|
| `username` UNIQUE | ❌ chưa có → **thêm tay §2A** (text, optional, unique) | Sau §2A: map 1-1 |
| `password_hash` (bcrypt) | ❌ → PB dùng `password` auth riêng | User đặt lại pass; BE tạo user = password tạm, không migrate hash |
| `role_id` → `admin/staff/customer/guest` | 🔀 `role` select `system_admin/parking_manager/staff/customer` | `admin`→`system_admin`, `staff`→`staff`, `customer`→`customer`; `guest` không có row; `parking_manager` app không dùng |
| `full_name` | 🔀 `name` | Đổi tên field |
| `phone` | ✅ `phone` | Giữ |
| `address` | ❌ (chỉ có `customers.address`) | Staff: local-only · Customer: ghi qua `customers` |
| `start_date` | ❌ | Local-only |
| `notes` (admin-only) | ❌ | **Local-only, KHÔNG đẩy lên server** (nhạy cảm) |
| `permissions` JSON 5 flags | ❌ | **Local-only** (server không có; guard BE giữ nguyên logic resolve local) |
| `is_active` | 🔀 `status` (`active/inactive`) | `1`→`active`, `0`→`inactive` |
| — | ➕ `organization`, `assigned_lots`, `employee_code`, `position`, `last_login_at`, `customer`, `avatar` | Server quản; **`assigned_lots` PHẢI chứa lot của bãi** (xem §4) |

### 3.2 `parking_zones` (§4) → `zones` (`pbc_1317801859`)

| App | Server | Xử lý |
|---|---|---|
| `code` UNIQUE (vd `A`) | ❌ | Nhét vào `name`: `"A — Khu A ô-tô"` (BE format thống nhất, parse khi hiển thị) |
| `name` | ✅ `name` (kèm code như trên) | — |
| `vehicle_type_allowed` `car/motorbike/both` | 🔀 `vehicle_type` `motorbike/car/bicycle/e_bike/truck` (không có `both`) | `car`→`car`, `motorbike`→`motorbike`; **`both` → tách 2 zones hoặc chọn dominant** (BE quyết, ghi chú trong code) |
| `capacity` | ✅ `capacity` | — |
| `price_per_hour/day` (VND) | ❌ | **Local-only** (server tính phí bằng `pricing_rule`/`fee_breakdown` ở sessions) |
| `is_active` | 🔀 `status` (`active/inactive`) | Map giá trị |
| — | ➕ `parking_lot*` + `floor_label/is_covered/has_ev_charging/is_managed_spots/sort_order` | `parking_lot` bắt buộc (§4); còn lại để default |

### 3.3 `parking_spots` (§5) → `parking_spots` (`pbc_4076557424`)

| App | Server | Xử lý |
|---|---|---|
| `spot_number` (UNIQUE theo zone) | 🔀 `code` (UNIQUE theo `(zone,code)` — khớp) | Đổi tên field |
| `zone_id` | 🔀 `zone` | Đổi tên field |
| `status` `available/occupied/reserved/maintenance` | 🔀 `status` `empty/occupied/reserved/maintenance` | **`available`→`empty`**, còn lại giữ |
| — | ➕ `parking_lot*`, `vehicle_type*` | Bắt buộc: copy từ zone (§4) |
| — | `current_session?`, `note` | Dùng `note` cho ghi chú nội bộ; `current_session` do server/app cập nhật khi check-in |

### 3.4 `vehicles` (§6) → `vehicles` (`pbc_1602236899`)

| App | Server | Xử lý |
|---|---|---|
| `license_plate` UNIQUE toàn cục | 🔀 UNIQUE theo `(parking_lot,license_plate)` | Tra cứu luôn kèm `parking_lot` (§4) |
| `vehicle_type` `car/motorbike` | ✅ (server thêm `bicycle/e_bike/truck` — app không dùng) | Giữ 2 giá trị app |
| `owner_name` / `owner_phone` | ❌ (nằm ở `customers`) | Ghi qua `customers` (ensure trước, link `customer?`) |
| — | ➕ `parking_lot*`, `customer?` + `brand/model/color/status/blacklist…` | `parking_lot` bắt buộc; blacklist để server quản |

### 3.5 `monthly_passes` (§7) → `monthly_passes` (`pbc_608334556`)

| App | Server | Xử lý |
|---|---|---|
| `pass_code` UNIQUE (vd `MT-2026-0001`) | ❌ | Lưu vào `note` (`"pass_code: MT-…"`) + tra cứu bằng `license_plate` + dates |
| `customer_name` / `customer_phone` | 🔀 `customer*` (relation `customers`) | **Ensure `customers` row trước** (match `phone`), rồi link |
| `vehicle_id` | 🔀 `vehicle*` + denormalized `license_plate*`, `vehicle_type*` | Copy 3 field cùng lúc |
| `zone_id` (nullable) | ❌ | Bỏ (pass server là lot-level) |
| `price`, `start_date`, `end_date` | ✅ | Giữ |
| `status` `pending/active/expired/cancelled/suspended` | 🔀 thiếu `pending` → **thêm tay §2B** | Sau §2B: map 1-1 |
| `created_by` | ✅ `created_by` | Giữ |
| — | ➕ `parking_lot*`, `payment_status`, `payment_method`, `pass_type(monthly/quarterly/yearly)`, `access_card?`, `contract?`, `auto_renew` | Gói 1 th→`monthly`, 3 th→`quarterly`, 12 th→`yearly`; **gói 6 th không có → `quarterly` + ghi vào `note`** |

### 3.6 `parking_sessions` (§8) → `parking_sessions` (`pbc_3800560292`)

| App | Server | Xử lý |
|---|---|---|
| `ticket_code` | ✅ `ticket_code` | Giữ |
| `vehicle_id` | 🔀 `vehicle?` + bắt buộc denormalized `license_plate*`, `vehicle_type*` | Ghi cả 3 |
| `spot_id` | 🔀 `spot` | Đổi tên field |
| `zone_id` | 🔀 `zone?` | Đổi tên field |
| `monthly_pass_id` | 🔀 `monthly_pass?` | Đổi tên field |
| `check_in_at` / `check_out_at` | ✅ | Giữ |
| `status` `parked/completed/cancelled` | 🔀 `parking/completed/cancelled` | **`parked`→`parking`**, còn lại giữ |
| `hourly_rate_applied` / `daily_rate_applied` | ❌ | Local-only (công thức phí app giữ; server có `pricing_rule`/`fee_breakdown` do server tính) |
| `total_fee` | 🔀 `fee_amount` | Đổi tên field |
| `discount_amount` | ✅ `discount_amount` | Giữ |
| `created_by` / `closed_by` | 🔀 `check_in_by` / `check_out_by` | Đổi tên field |
| — | ➕ `parking_lot*`, `payment_status(unpaid/paid/free)*`, `payment_method` + `reservation?/entry/exit_photo/gate…` | Check-in set `payment_status=unpaid`; vé tháng → `free`; ảnh cổng dùng `entry/exit_photo` |

### 3.7 `payments` (§9, append-only) → `payments` (`pbc_631030571`)

| App | Server | Xử lý |
|---|---|---|
| `session_id` / `monthly_pass_id` | 🔀 `session?` / `monthly_pass?` | Đổi tên field |
| `amount` | ✅ `amount` | Giữ |
| `payment_method` `cash/transfer/card/e_wallet` | 🔀 `method` `cash/vietqr/bank_transfer/momo` | `cash`→`cash`, `transfer`→`bank_transfer`, `e_wallet`→`momo`, **`card` không có → `bank_transfer` + ghi `"card"` vào `note`** |
| — | ➕ `status(paid/refunded/cancelled)*`, `parking_lot*` | Tạo mới luôn `status=paid`; sửa sai = tạo payment điều chỉnh (khớp append-only 2 bên — server cũng cấm staff update/delete) |
| `paid_at`, `received_by`, `note` | ✅ | Giữ |

### 3.8 `reservations` (§13) → `reservations` (`pbc_1473635903`)

| App | Server | Xử lý |
|---|---|---|
| `code` UNIQUE (`R-…`) | ❌ | Lưu vào `note` (`"code: R-…"`) |
| `user_id` | 🔀 `customer?` / `created_by?` (customer user link qua `users.customer`) | Staff tạo hộ → `created_by` = mình + `guest_name/guest_phone`; customer tự đặt → `customer` của mình |
| `vehicle_id` | ❌ (chỉ có `license_plate*`) | Link bằng biển số; `vehicle_type*` bắt buộc → hỏi lúc đặt hoặc default từ zone |
| `license_plate`, `customer_phone` | 🔀 `license_plate*`, `guest_phone?` | Đổi tên field (phone → guest_phone) |
| `zone_id` / `spot_id` | 🔀 `zone?` / `spot?` | Đổi tên field |
| `date` + `start_time` + `end_time` | 🔀 `reserved_from*` / `reserved_to*` (datetime) | Gộp: `reserved_from = date + start_time`, `reserved_to = date + end_time` |
| `status` `pending/active/completed/cancelled/expired` | 🔀 `pending/confirmed/checked_in/cancelled/no_show` | `pending`→`pending`, `active`→`confirmed`, `completed`→`checked_in`, `cancelled`→`cancelled`, **`expired`→`no_show`** |
| `expires_at` (~start+20p) | ❌ | App tự sweep local (giữ logic `api-contract.md` §13), không đẩy lên server |
| Quota ≤2 (app đếm) | ❌ | App tự đếm local trước khi tạo (không ép ở server) |
| — | ➕ `parking_lot*`, `deposit_amount/deposit_status`, `session?` | `parking_lot` bắt buộc; check-in consume → link `session` |

### 3.9 `shifts` + `attendance` (§14) → `shifts` (`pbc_705563745`) + `attendance` (MỚI `pbc_9142083765`)

| App | Server | Xử lý |
|---|---|---|
| `shifts` định nghĩa ca (`code` MORNING/AFTERNOON/NIGHT, `start_time/end_time`, `is_active`) | ⚠️ `shifts` server = **instance ca trực**, KHÁC SEMANTICS | **KHÔNG map.** Định nghĩa ca lưu local-only; vào ca → tạo 1 row server `shifts` (`parking_lot*`, `staff*` = mình, `start_at*` = now, `status` = `open`, `opening_cash`, `shift_name` = MORNING/…); ra ca → update (`end_at`, `closing_cash`, `status` = `closed`, `handover_note`, `handover_to?`) |
| `attendance` (`user_id/shift_id/work_date/check_in/out/opening/closing_cash/handover_note/status`) | ➕ `attendance` MỚI (import §1) | Map 1-1: `user_id`→`user`, `shift_id`→`shift_code` (resolve code local), còn lại giữ nguyên tên; UNIQUE `(user,shift_code,work_date)` ≈ UNIQUE app `(user_id,shift_id,work_date)` |

---

## 4. Quy tắc `parking_lot` — bắt buộc cho BE/MO (app ta single-bãi)

App ta chạy **1 bãi duy nhất**; server là **multi-lot** (`parking_lots` + `organization`).
Mọi collection nghiệp vụ server đều có `parking_lot*` bắt buộc:
`zones`, `parking_spots`, `parking_sessions`, `vehicles`, `customers`,
`monthly_passes`, `payments`, `reservations`, `shifts` (+ `attendance.user` gián tiếp qua user).

1. **Lưu lot id ở app-config**: thêm key `pb_parking_lot` (id `parking_lots`, vd `"pbc_…"` — xin từ
   system_admin) vào `ParkingSettings` (`api-contract.md` §15 M2, cùng chỗ `pb_url`).
2. **Mọi create qua SDK phải gắn `parking_lot = pb_parking_lot`** (zones/spots/sessions/vehicles/
   customers/passes/payments/reservations/shifts/attendance gián tiếp). Thiếu → server từ chối
   (required).
3. **Mọi list phải filter `parking_lot = pb_parking_lot`** (kẻo thấy dữ liệu bãi khác).
4. **User đăng nhập phải có `assigned_lots` chứa lot đó** — nhờ `system_admin` gán
   (vì `users.updateRule` chỉ `system_admin` được sửa user; staff/customer không tự gán).
   Nếu login OK mà list trống → 99% thiếu `assigned_lots` → liên hệ admin, không phải bug app.
5. `vehicles.license_plate` UNIQUE theo `(parking_lot, …)` → tra cứu trùng biển số ở bãi khác là
   bình thường; luôn query kèm `parking_lot`.

---

## 5. Danh sách code BE/MO PHẢI sửa theo mapping (cho @node-developer / mobile)

### BE (Electron + SDK online, `api-contract.md` §16 PB-auth-first giữ nguyên flow)

1. **Collection names**: `spots`→`parking_spots`, `sessions`→`parking_sessions`
   (các tên `users/vehicles/payments/reservations/shifts` trùng, `passes`→`monthly_passes`,
   `zones` trùng — rà soát mọi string literal).
2. **Field names** (§3.3/3.6/3.7/3.8): `spot_number`→`code`, `zone_id`→`zone`, `spot_id`→`spot`,
   `vehicle_id`→`vehicle` (+ denormalized `license_plate`/`vehicle_type`),
   `session_id`→`session`, `monthly_pass_id`→`monthly_pass`,
   `payment_method`→`method` (payments), `created_by/closed_by`→`check_in_by/check_out_by` (sessions).
3. **Role values**: mọi check `'admin'` → `'system_admin'` (rules + guard + SDK filter);
   thêm `'parking_manager'` coi như admin ở read (theo rules server).
4. **Status values**: session `parked`→`parking`; spot `available`→`empty`;
   reservation theo bảng §3.8 (đặc biệt `expired`→`no_show`); payment method theo bảng §3.7
   (đặc biệt `card`→`bank_transfer` + note).
5. **Auth**: sau §2A login được bằng `username` HOẶC `email` (identityFields cả 2);
   customer login `username` = SĐT (giữ flow `auth-flow.md`); email placeholder `…@lot.local` khi tạo user.
6. **Mine-only qua relations, không qua phone**: customer scope = filter `customer = <id customers của mình>`
   (resolve qua `users.customer`) thay vì `customer_phone = SĐT` ở sessions/passes/payments/reservations.
7. **Local-only, KHÔNG sync lên server**: `users.notes`, `users.permissions`, `start_date`,
   giá zones (`price_per_hour/day`), `pass_code` (→note), `hourly/daily_rate_applied`,
   định nghĩa ca `shifts`, `expires_at` (sweep local), quota reservations (đếm local).
8. **Tạoerson trước khi tạo pass/session**: flow ensure `customers` → `vehicles` → `monthly_passes`/
   `parking_sessions` (do `customer*`/`vehicle*`/`license_plate*` required).
9. **`parking_lot` mọi create + filter mọi list** (§4); `assigned_lots` là việc của admin server.

### MO (mobile-app.md — customer)

1. Cùng các đổi tên §§3.6–3.8 cho màn vé/lịch sử/đặt chỗ (ticket, pass, reservation).
2. Đặt chỗ: gộp `date/start_time/end_time` → `reserved_from/reserved_to`; `vehicle_type` bắt buộc;
   hiển thị status theo map mới (`confirmed/checked_in/no_show`).
3. Customer scope: mọi "của tôi" filter qua `customer` relation (resolve 1 lần sau login),
   không filter bằng SĐT raw.
4. Vé tháng: `pending` chỉ dùng được sau khi admin làm §2B — trước đó MO ẩn nút "đăng ký" hoặc
   báo "chưa khả dụng online"; `pass_code` hiển thị lấy từ `note` (parse) hoặc `license_plate` + ngày.

---

## 6. Rollback & an toàn

- Import `attendance` thất bại → không ảnh hưởng 12 collections cũ (file chỉ chứa 1 collection mới).
  Xóa `attendance` nếu cần làm lại (collection mới, chưa có data phụ thuộc).
- 2 thao tác tay đều **cộng thêm, không xóa**: thêm field optional, thêm select value —
  không mất data, không downtime. Hoàn tác = xóa field `username` / xóa value `pending`
  (chỉ khi chưa có data dùng chúng).
- Cấm: import lại `pocketbase-collections.json` cũ; sửa/xóa field, rule, collection đang chạy;
  seed trực tiếp lên server.

## 7. Verification

- [ ] `pocketbase-attendance.json`: 1 collection duy nhất, id `pbc_9142083765` không trùng map,
  format khớp export server (`schema/indexes/listRule…/passwordAuth`-less base), rules mine-only
  (`user = @request.auth.id`, delete chỉ `system_admin`).
- [ ] Mọi field server trong §3 đều có trong `pb-server-map.json` (không bịa field).
- [ ] `pending` monthly_passes + `username` users được đánh dấu THAO TÁC TAY (không có trong file import).
- [ ] Quy tắc lot (§4) + danh sách code BE/MO (§5) đủ để implement không cần hỏi lại server team.

**Overall: `verified`** (spec-only, chưa chạy import — import do user bấm UI).
