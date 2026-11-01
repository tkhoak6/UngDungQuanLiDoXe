# Backend Summary — Electron Main + SQLite IPC (BE-001)

> Owner: @node-developer. Frontend (@frontend-react) đọc file này + `src/shared/types.ts`
> (`ApiMap`) để gọi IPC — không cần hỏi lại contract.

## Cách chạy

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm install            # NOTE: better-sqlite3 cần VS Build Tools (node-gyp); nếu lỗi native build,
                       # chạy `npm install --ignore-scripts` để vẫn typecheck/test được
npm run dev            # tsc + electron .  (DB dev: ./data/parking.db)
npm run typecheck      # npx tsc --noEmit
npm run verify:fee     # vitest fee-calculator (10 case)
```

Lần đầu mở DB: chạy `specs/schema.sql` + `specs/seed.sql`, bật `PRAGMA foreign_keys=ON`,
`journal_mode=WAL`, và thay placeholder hash bằng bcrypt thật
(`admin` / `Admin@123`, `staff01` / `Staff@123` — **đổi password sau khi bàn giao**).
Mỗi lần mở DB còn chạy **startup sweep**: `UPDATE monthly_passes SET status='expired'
WHERE status='active' AND end_date < date('now')` (BE-002, theo RV-001 note 5) để
`passes:list {status:'active'}` không hiện vé hết hạn. Billing date-check
(`findValidPass` + `sessions:preview-fee`) giữ nguyên — sweep chỉ dọn status hiển thị.
DB packaged app nằm ở `<userData>/parking.db`.

## Migration 002 — customer (BE-007)

- `src/main/db.ts` → `runMigration002()`: chỉ chạy khi DB **đã tồn tại**
  (DB mới bootstrap `schema.sql` đã gộp v002). Detect thiếu qua 3 điều kiện
  (cột `users.phone` / CHECK `roles` có `'customer'` / row `roles('customer')`);
  đủ cả 3 → skip, không backup. Thiếu bất kỳ → checkpoint WAL + copy
  `parking.db` → `parking.db.bak-002`, đọc `specs/migration-002-customer.sql`,
  strip block STEP 3 khi `phone` đã tồn tại (SQLite không có
  `ADD COLUMN IF NOT EXISTS`), `exec`, rồi `foreign_key_check` phải sạch.
  Idempotent — DB mới hay cũ đều mở OK, chạy N lần không lỗi.

## Files

| File | Nội dung |
|---|---|
| `package.json` | electron + better-sqlite3 + bcryptjs (pure-JS, không cần build) |
| `src/main/main.ts` | `BrowserWindow` 1280×800, min 1280×720 (DESIGN.md §10.3) |
| `src/main/db.ts` | Mở `parking.db`, FK+WAL, bootstrap schema/seed lần đầu; DB cũ → migration-002 idempotent (backup `.bak-002` + `foreign_key_check`) |
| `src/main/fee-calculator.ts` | Hàm pure `calculateFee` + `calculatePassPrice` (gói 12 tháng −10%) |
| `src/main/fee-calculator.spec.ts` | 10 test (30p→1h, 2h, ceil 2h05→3h, qua đêm→giá ngày, 13h→giá ngày, vé tháng=0, discount floor 0, checkout invalid, pass −10%) |
| `src/main/auth.ts` | Login bcrypt compare (timing-safe khi user không tồn tại), session memory, guard `admin`/`staff` theo matrix §11 |
| `src/main/ipc-handlers.ts` | Toàn bộ IPC (xem bảng dưới) |
| `src/preload/index.ts` | `window.api.invoke(channel, input)` typed qua `ApiMap` |
| `src/shared/types.ts` | `ApiMap` channel→input/output — frontend import type từ đây |

## Công thức phí (backend chốt, UI chỉ preview qua `sessions:preview-fee`)

`≤30p → 1h`; ngược lại `ceil(phút/60)`; qua đêm **hoặc** `≥12h` → giá ngày
(`day_count = ceil(giờ/24)`); vé tháng còn hiệu lực → `0`; `total = max(0, fee − discount)`.

## IPC channels (envelope `{ success, data?, message?, errors? }`)

| Channel | Quyền | Ghi chú |
|---|---|---|
| `auth:login/logout/me` | none | `password_hash` không bao giờ rời main |
| `auth:register` | none (public) | **BE-007** khách tự đăng ký (`{phone, password, full_name}` → `UserDTO` role `customer`, `username = phone`); validate SĐT `/^0\d{9}$/` + họ tên trim non-empty + bcrypt.hash(10); `role_id` resolve **bằng name** (không hardcode id); trùng SĐT → message chung "đã được đăng ký — vui lòng đăng nhập" (409 Việt); **KHÔNG cho client chọn role, KHÔNG auto-login** (frontend gọi `auth:login` sau); login hiện có giữ nguyên (customer đăng nhập bằng SĐT luôn được) |
| `zones:list/get` | guest (no login) | |
| `zones:create/update/delete` | admin | delete bị chặn khi còn xe đỗ; còn lịch sử → lỗi FK RESTRICT thân thiện (khóa thay vì xóa) |
| `availability:list` | guest | đọc `v_zone_availability` |
| `spots:list` | guest | đọc `v_spot_map` (grid + biển số đang đỗ) |
| `spots:set-status` | admin | không đổi khi chỗ đang có xe |
| `sessions:check-in` | staff+ | upsert vehicle (UPPERCASE plate), guard trùng vé, auto-pick spot, snapshot giá, gắn pass hợp lệ |
| `sessions:preview-fee` | staff+ | **bắt buộc gọi trước thu phí** (spec §d) |
| `sessions:check-out` | staff+ | **1 better-sqlite3 transaction**: UPDATE session + UPDATE spot available + INSERT payment; `payment_method` whitelist (`cash`/`transfer`/`card`/`e_wallet`) **trước khi chạm DB** → sai enum trả lỗi tiếng Việt thân thiện thay vì rớt xuống DB CHECK |
| `sessions:active/history` | staff+ | history có filter ngày/zone + phân trang |
| `vehicles:find` | staff+ | lookup theo biển số |
| `passes:list/create/renew/cancel` | staff+ | guard trùng vé, gia hạn nối tiếp `max(today, expiry+1d)`; **cancel: `reason` KHÔNG persist** (schema `monthly_passes` không có cột — muốn lưu cần @database thêm cột + migration) → handler echo reason vào response `message`, **không chèn payment giả** (tránh bẩn `v_revenue_daily.tx_count`); cancel chạy trong transaction |
| `reports:revenue/sessions-daily` | admin | đọc views theo khoảng ngày |
| `reports:dashboard` | staff+ | availability + xe đang đỗ + doanh thu hôm nay + vé sắp hết hạn 7 ngày |
| `users:list/create/toggle-active/update` | admin | bcrypt.hash(10), xóa user → sessions/payments SET NULL (giữ lịch sử); **update: sửa username/full_name + reset mật khẩu — mật khẩu bcrypt chỉ đặt lại, KHÔNG đọc lại**; không đụng role/is_active nên không gây mất admin cuối |
| `payments:list` | staff+ | read-only (+`mine_only` cho ca staff); **không có update/delete** — append-only |
| `activity:list` | staff+ | **BE-006** màn Nhật ký: `UNION ALL` check-in (`parking_sessions.created_by`→`check_in_at`) + check-out (`status='completed'`, actor `closed_by`→`check_out_at`, `amount=total_fee`) + bán vé (`monthly_passes.created_by`, `amount=price`); sort `at` DESC server-side, search LIKE mã vé/biển số/username, phân trang (default 20/max 100) + `total`; staff bị force `staff_id=me.id`; user bị xóa → row giữ, `username/full_name` NULL (UI render "(đã xóa)"); `payment_method` = 1 payment mới nhất per session/pass (check-in → NULL); **không tách row thu phí riêng** (tránh double-count); chỉ JOIN username/full_name, không lộ `password_hash` |

## Verification

- `npx tsc --noEmit` → **pass** (scope `src/main|preload|shared`; `src/renderer` của frontend song song, không đụng).
- `vitest run --config vitest.backend.config.ts` → **10/10 pass**.
- Không `console.log`; password chỉ bcrypt compare; checkout đúng 1 transaction.
- Chưa chạy được end-to-end (better-sqlite3 native build thiếu VS Build Tools trên máy này)
  → cần `npm rebuild better-sqlite3` (hoặc prebuilt có sẵn trên máy dev) rồi `npm run dev` test check-in/out thật.

**Status: partially_verified** (logic + types + unit test pass; IPC runtime chưa chạy do thiếu native binding).

## BE-008 — Customer P1+P2 (profile check + vehicles/sessions)

- `users:update` mở cho customer tự sửa mình (guard `none` + authz trong handler):
  `customer` chỉ khi `id = me.id`, chỉ `full_name` + `new_password`; đổi `username`
  (SĐT) → chặn `"Số điện thoại đăng nhập không thể đổi — vui lòng ra quầy"`.
  `staff`/`guest` vẫn bị chặn; admin giữ full quyền + reset pass người khác không cần
  pass hiện tại. Đổi pass khi TỰ đổi (mọi role): bắt buộc `current_password`,
  verify bcrypt với hash hiện tại TRƯỚC khi hash mới; thiếu → `errors.current_password`
  `"Vui lòng nhập mật khẩu hiện tại."`, sai → `"Mật khẩu hiện tại chưa đúng."`,
  trùng pass cũ → `errors.new_password` `"Mật khẩu mới phải khác mật khẩu hiện tại."`
  (ValidationError → envelope `fail(message, errors)` để frontend render inline).
  Tự đổi xong → `refreshCurrentUser` để `auth:me` trả DTO mới ngay.
- `customer:vehicles → { vehicles: CustomerVehicle[], total_spent }` (guard `requireCustomer`):
  link `vehicles.owner_phone = me.phone` — backend ép `me.phone`, KHÔNG nhận phone
  từ client. Chuẩn hóa 2 đầu: JS `trim + strip [space . - ( )]` mirror SQL nested
  `REPLACE(TRIM(owner_phone)…)` nên quầy nhập SĐT có dấu cách vẫn khớp.
  Per-xe: `session_count` (COUNT mọi session), `total_spent` (SUM completed),
  `is_parked` (0|1, EXISTS parked); sort `license_plate`; `total_spent` tổng mọi xe.
- `customer:sessions {from?,to?,search?,limit?=20/max100,offset?=0} → {rows,total,total_spent}`:
  JOIN vehicles+zones, filter cùng phone ép sẵn + ngày/search (LIKE ticket/biển số
  uppercase), `ORDER BY check_in_at DESC`. Row: ticket/biển/khu/vào-ra/tiền/
  `monthly_pass_id` + `is_monthly` + `payment_method` mới nhất (tooltip).
  `total_spent` = SUM completed cùng filter (footer "Tổng cộng").
  Không lộ xe người khác: mọi query đều có điều kiện phone mine-only.
- Types mới trong `src/shared/types.ts`: `CustomerVehicle`, `CustomerVehiclesOutput`,
  `CustomerSessionsInput/Row/Output` + 2 entry `ApiMap` (+ `current_password?` vào
  `users:update` input). Preload generic `invoke<K>` nên không cần sửa preload.
- Không migration, không cột mới, không đụng login/register/renderer/schema.

### Verification (BE-008)

- `npx tsc --noEmit` → **pass**. `vitest fee-calculator` → **10/10 pass**.
- IPC runtime chưa chạy (better-sqlite3 thiếu native binding — như BE-001) → logic
  mine-only review bằng tay: phone chỉ lấy từ `requireCustomer()` (session server),
  client không có tham số phone nào; SQL normalize mirror JS (đã đối chiếu tay).
- **Status: partially_verified**.

## BE-009 — Customer P3 mua vé (request + confirm)

- `src/main/db.ts` → `runMigration003()`: chỉ chạy khi DB **đã tồn tại**
  (DB mới bootstrap `schema.sql` đã gộp v003 — CHECK đã có `'pending'`).
  Detect thiếu qua DDL `sqlite_master` của `monthly_passes` (không chứa
  `'pending'` → migrate; đã có → skip, không backup). Thiếu → checkpoint WAL +
  copy `parking.db` → `parking.db.bak-003`, `exec` toàn bộ
  `specs/migration-003-pass-pending.sql` (1 transaction rebuild + tạo lại 3 index
  `idx_pass_vehicle/status/dates` + trigger `trg_passes_updated`), rồi
  `foreign_key_check` phải sạch. Gọi sau `runMigration002()` trong
  `openDatabase()` (thứ tự 002 → 003). Idempotent — chạy N lần không lỗi.
- `customer:pass-request {vehicle_id, zone_id?, package_months 1|3|6|12, start_date?} → MonthlyPass`
  (guard `requireCustomer`, kênh `none` + authz trong handler như P2):
  verify xe tồn tại + `normalizePhone(owner_phone) = normalizePhone(me.phone)`
  (sai → `"Xe không thuộc tài khoản của bạn — vui lòng ra quầy"`); zone (nếu chọn)
  phải tồn tại + `is_active=1` + `vehicle_type_allowed` khớp loại xe
  (sai → `"Khu {code} không nhận loại xe này."`); chống trùng vé
  `pending`/`active` overlap cùng xe + scope zone
  (sai → `"Xe này đã có vé {code} còn hiệu lực/chờ xác nhận"`); giá = công thức
  staff (`price_per_day×30`, fallback 300k all-zone, tái dùng
  `calculatePassPrice` — gói 12T −10%); `pass_code` sinh như cũ (`passCode`);
  `INSERT status='pending'`, `customer_name/phone = me`, `created_by = me.id`
  (1 transaction check + insert, KHÔNG tạo payment — trả tiền tại quầy sau).
- `passes:confirm {pass_code, action: 'approve'|'reject', payment_method?, reason?} → {pass, payment|null}`
  (guard `staff`, IPC **mới** — không sửa `passes:create/renew/cancel` hiện tại):
  `pending` mới được duyệt/từ chối (khác → `"Vé {code} không ở trạng thái chờ xác nhận"`);
  approve = 1 transaction `UPDATE active + INSERT payments`
  (`amount = pass.price`, `received_by = me.id`, `payment_method` whitelist
  `cash/transfer/card/e_wallet` trước khi chạm DB, default `cash`);
  reject = `UPDATE cancelled`, reason echo vào `message` (KHÔNG persist —
  cùng quy ước `passes:cancel`, KHÔNG chèn payment giả).
- Vé pending KHÔNG miễn phí check-in (đã verify, không sửa):
  `findValidPass` chỉ `WHERE status='active'` + `sessions:preview-fee` chỉ nhận
  `p.status === 'active'` nên check-in vé pending vẫn tính phí thường.
- Types mới trong `src/shared/types.ts`: `PassStatus` thêm `'pending'`
  (đồng bộ `api-contract.md` §1 — trước đó thiếu), `CustomerPassRequestInput`,
  `PassConfirmInput/Output` + 2 entry `ApiMap`
  (`customer:pass-request`, `passes:confirm`). Preload generic `invoke<K>`
  nên không cần sửa preload.

### Verification (BE-009)

- `npx tsc --noEmit` → **pass**. `vitest fee-calculator` → không đụng, giữ 10/10 (BE-001).
- IPC runtime chưa chạy (better-sqlite3 thiếu native binding — như BE-001/BE-008)
  → logic mine-only + transaction review bằng tay; pending-free-check-in verify
  bằng đọc code (`findValidPass` + preview đều lọc `active`).
- **Status: partially_verified**.

## BE-010 — Customer P3 follow-up (customer:passes + passes:cancel mine-only)

- `customer:passes {status?, limit?=20/max100, offset?=0} → {rows: MonthlyPass[], total}`
  (guard `requireCustomer`, kênh `none` + authz trong handler như P2):
  JOIN `monthly_passes mp` + `vehicles v` (`v.id = mp.vehicle_id`), filter
  mine-only `${PHONE_NORM_SQL} = normalizePhone(me.phone)` (mirror JS/SQL như
  BE-008 — quầy nhập SĐT có dấu cách vẫn khớp); `status` optional (whitelist
  `pending/active/expired/cancelled/suspended` trước khi chạm DB);
  `ORDER BY mp.created_at DESC, mp.id DESC` (mới nhất trước);
  `{rows, total}` cùng filter cho pagination — frontend bỏ workaround localStorage.
- `passes:cancel` mở guard staff-only → `none` + authz trong handler
  (cùng pattern `users:update` P1):
  `customer` CHỈ được hủy pass `pending` của chính mình
  (`JOIN vehicles` verify `normalizePhone(owner_phone) = me.phone` trong JS);
  sai xe / sai trạng thái (kể cả vé `active` của chính mình) → 403 Việt
  `"Chỉ được hủy đăng ký đang chờ của bạn"`; `staff`/`admin` giữ nguyên full
  (`requireRole('staff')` + transaction UPDATE + reason echo vào `message`,
  KHÔNG persist reason, KHÔNG chèn payment giả); `guest`/chưa login → chặn.
- Types mới trong `src/shared/types.ts`: `CustomerPassesInput/Output` +
  entry `ApiMap['customer:passes']`; `passes:cancel` giữ nguyên signature.
  Preload generic `invoke<K>` nên không cần sửa preload. Không migration,
  không đụng renderer/schema/luồng staff.

### Verification (BE-010)

- `npx tsc --noEmit` → **pass**.
- IPC runtime chưa chạy (better-sqlite3 thiếu native binding — như BE-001/008/009)
  → mine-only review bằng tay: phone chỉ từ session server; customer không
  cancel được vé người khác / vé non-pending (cùng message 403).
- **Status: partially_verified**.

## Lưu ý rate-limit hiện tại (BE-007)

- `auth:register` là IPC public nhưng chạy **local-only** (Electron main, không
  qua mạng) trên app desktop single-operator → không có attack surface Internet.
- Chống spam tối thiểu đã làm: `trim` input, validate SĐT strict ở app,
  `UNIQUE(username)` + `UNIQUE(phone)` ở DB (chạy trong transaction), message
  lỗi chung không lộ dữ liệu.
- **Chưa có**: rate-limit/cooldown theo IPC (in-memory counter), CAPTCHA, xác
  thực OTP SĐT. Nếu sau này mở đăng ký qua mạng hoặc kiosk công cộng, bổ sung
  cooldown (vd tối đa 5 lần/phút) + khóa nút Register ở renderer trong lúc chờ.

## BE-011 — Customer P4 đặt chỗ (runner + 3 IPC + check-in consume + sweep)

- `src/main/db.ts` → `runMigration004()`: chỉ chạy khi DB **đã tồn tại**
  mà thiếu bảng `reservations` (DB mới bootstrap `schema.sql` đã gộp v004).
  Thiếu → checkpoint WAL + copy `parking.db` → `parking.db.bak-004`,
  `exec` toàn bộ `specs/migration-004-reservations.sql` (DDL `IF NOT EXISTS`,
  1 transaction), rồi `foreign_key_check` phải sạch. Gọi sau 003 trong
  `openDatabase()` (thứ tự 002 → 003 → 004). Idempotent — chạy N lần không lỗi.
  `openDatabase()` còn gọi `sweepExpiredReservations()` mỗi lần mở app.
- `sweepExpiredReservations(db)` (export từ `db.ts`, dùng chung startup +
  pre-check-in): 1 transaction — `pending` quá `expires_at` → `expired` +
  spot giữ → `available` (guard `status='reserved'` để không đụng ô đã
  consume `reserved → occupied`). Idempotent, trả về số row đã sweep.
- `customer:reserve {zone_id, license_plate, vehicle_type?, date?, start_time/end_time
  (alias time_from/time_to)} → Reservation` (guard `requireCustomer`):
  date backend ép = today (bỏ qua client, V1 chỉ giữ trong ngày); biển số
  UPPERCASE (ngắn <4 ký tự → `"Biển số chưa đúng — VD: 51H-12345."`); loại xe
  lấy từ xe đã tồn tại, thiếu thì dùng `vehicle_type?` (cả hai thiếu → bỏ qua
  check tương thích); khung `06:00–22:00`, duration 1–4h, start không quá khứ
  >15p; quota `COUNT pending|active` của mình trong ngày ≥ 2 → `"Bạn đã có
  2 chỗ đang giữ."`; auto-pick ô `available` (hết → `"Khu {code} vừa hết chỗ
  giữ — chọn khu khác."`); 1 transaction `INSERT pending (code R-YYYYMMDD-####,
  expires_at = start + 20p)` + `UPDATE spot → reserved`. Alias
  `time_from/time_to` để tương thích `api-contract.md` §13
  (`CustomerReserveInput` ở đó thiếu `license_plate` — type thật trong
  `src/shared/types.ts` là chuẩn; @leader đồng bộ contract khi rảnh).
- `customer:reservations {status?, limit?=20/max100, offset?=0} →
  {rows: CustomerReservationRow[] (kèm zone_code/zone_name/spot_number),
  total}` (guard `requireCustomer`, mine-only `user_id = me.id`,
  `ORDER BY date, start_time`).
- `customer:reserve-cancel {code} → Reservation` (guard `requireCustomer`):
  lookup `code + user_id` (không lộ mã người khác); chỉ `pending` mới hủy
  (`"Chỉ được hủy chỗ đang giữ"`); 1 transaction `→ cancelled` + spot
  (`reserved`) → `available`.
- `sessions:check-in` + `reservation_code?` (guard `staff` giữ nguyên, không
  sửa IPC cũ ngoài thêm field): sweep trước mọi check-in; resolve mã —
  không tồn tại / `expired` (`"đã hết hiệu lực (quá 20 phút sau giờ bắt đầu)"`)
  / non-pending / biển số khác (`"giữ cho biển số {plate} — không áp dụng cho
  xe này"`) / SĐT snapshot khác chủ xe (`"không thuộc xe này — đối soát tại
  quầy"`, bỏ qua khi xe chưa tồn tại) / khác ngày / quá `end_time` (đánh
  expired ngay) / khác khu → lỗi Việt; đến sớm trước `start_time` vẫn cho
  vào. Ô giữ (`spot_id` của reservation) được dùng đúng ô đó (client gửi
  `spot_id` khác → chặn, nêu đúng số ô); `NULL` → pick thường. Consume trong
  cùng transaction check-in: `pending → completed` (≡ used) + link
  `vehicle_id` vừa upsert + spot `reserved → occupied`.
- Types mới trong `src/shared/types.ts`: `ReservationStatus`, `Reservation`,
  `CustomerReserveInput (+ alias time_from/time_to)`, `CustomerReservationsInput`,
  `CustomerReservationRow/Output`, `CustomerReserveCancelInput`,
  `CheckInInput.reservation_code?` + 3 entry `ApiMap`. Preload generic
  `invoke<K>` nên không cần sửa preload. Không migration mới ngoài runner,
  không đụng renderer/schema.
- GHI CHÚ cho @frontend (không sửa renderer theo scope): `GuestPage.tsx:167,287`
  render mọi spot không phải `available/occupied` thành "bảo trì" — ô
  `reserved` (đang được giữ) hiện hiển thị như bảo trì. Muốn đúng spec P4
  ("Staff nhìn thấy chỗ reserved") cần thêm style/label "Đang giữ" cho
  `status === 'reserved'` ở grid + legend.

### Verification (BE-011)

- `npx tsc --noEmit` → **pass**. `npm run build` → **pass**.
- Smoke test runtime 33/33 **pass** (script ngoài repo, stub electron +
  `ELECTRON_RUN_AS_NODE`, handler thật trên DB tạm): reserve ok + mã
  `R-YYYYMMDD-####` + spot `reserved` + `expires_at = start+20p`; quota cái
  thứ 3 → `"Bạn đã có 2 chỗ đang giữ."`; list mine + filter; hủy mã người
  khác → `"Không tìm thấy mã đặt chỗ của bạn"`; hủy của mình → `cancelled` +
  spot `available`; check-in mã sai → `"Mã đặt chỗ không tồn tại"`; check-in
  mã đúng → session `parked` + reservation `completed` + spot `occupied`;
  biển số lệch → lỗi Việt; sweep pre-check-in (`pending` quá hạn → `expired`
  + spot → `available`, ô vừa sweep auto-pick được ngay); check-in bằng mã
  expired → `"đã hết hiệu lực"`; migration-004 trên DB cũ (drop bảng) → tạo
  lại bảng + giữ nguyên data + ghi `.bak-004` + reopen idempotent.
- **Status: verified** (logic + types + IPC runtime đều chạy thật; chỉ chưa
  test GUI click-through).

## BE-012 — Staff S1 hồ sơ (runner 005 + users:list/update + users:profile*)

- `src/main/db.ts` → `runMigration005()`: chỉ chạy khi DB **đã tồn tại**
  mà thiếu ≥1 trong 3 cột (`address`/`start_date`/`notes` — detect qua
  `pragma_table_info('users')`, đủ cả 3 → skip, không backup; DB mới
  bootstrap `schema.sql` đã gộp v005 nên skip luôn). Thiếu → checkpoint WAL +
  copy `parking.db` → `parking.db.bak-005`, đọc
  `specs/migration-005-staff-profile.sql`, **strip block của cột đã tồn tại**
  (SQLite không có `ADD COLUMN IF NOT EXISTS` — DB migrate dở vẫn chạy tiếp
  đúng phần còn thiếu), `exec`, rồi `foreign_key_check` phải sạch. Gọi sau
  004 trong `openDatabase()` (thứ tự 002 → 003 → 004 → 005). Idempotent.
- `users:list` (guard `admin` → nới thành `staff` + strip trong handler):
  SELECT thêm `address/start_date/notes` (`USER_DTO_SELECT` dùng chung cho
  list/create/update/toggle-active); `role !== 'admin'` → loại `notes` khỏi
  mọi row (kể cả của chính mình). Frontend staff không gọi list (S1.4) —
  đây là lớp phòng thủ backend.
- `users:update` (guard `none` + authz cũ giữ nguyên — login/register/activity
  không đụng): **admin** patch thêm `phone?/address?/start_date?/notes?`
  (S1.5: SĐT `^0\d{9}$` + unique trừ mình, `start_date` `YYYY-MM-DD` ≤ today,
  `address` trim max 255, `notes` trim max 500; rỗng → NULL để clear;
  trùng SĐT race → `errors.phone` `"SĐT đã được dùng."`); **customer** gửi
  4 key này → 403 `"Bạn chỉ được cập nhật họ tên và mật khẩu"`; **staff**
  vẫn bị chặn như cũ (tự sửa đi qua `users:profile:update`).
- `users:profile → StaffSelfProfile` (guard `staff`, backend ép `id = me.id`):
  `{id, username, full_name, phone, address, start_date, role_name, is_active,
  created_at}` — **KHÔNG có `notes`** (admin-only tuyệt đối).
- `users:profile:update {phone?, address?} → StaffSelfProfile` (guard `staff`,
  ép `me.id`): chỉ 2 field này được tự sửa, validate như admin patch
  (phone unique trừ mình); `notes/start_date` dù gửi cũng bị bỏ qua; rỗng
  → `"Không có gì để cập nhật"`; xong `refreshCurrentUser` để `auth:me`
  đồng bộ ngay.
- Types trong `src/shared/types.ts`: `UserDTO` + `address/start_date`
  (required `| null`) + `notes?` (optional — session/login không bao giờ có);
  mới `StaffSelfProfile`, `StaffProfileUpdateInput` + 2 entry `ApiMap`
  (`users:profile`, `users:profile:update`) + 4 field optional vào
  `users:update` input. `auth.ts` (`USER_COLUMNS`/`UserRow`/`toUserDTO`,
  `findUserByUsername`) + `address/start_date`, **không map `notes` vào
  session**. Preload generic `invoke<K>` nên không cần sửa preload.
  Không đụng renderer/schema/index.
- GHI CHÚ cho @frontend: `UserDTO.notes` là optional — `undefined` khi lấy
  từ `auth:me`/session hoặc staff list; chỉ admin list/update mới có giá trị.

### Verification (BE-012)

- `npx tsc --noEmit` → **pass**. `vitest fee-calculator` → **10/10 pass**.
- Smoke test runtime 24/24 **pass** (script ngoài repo, stub electron +
  `ELECTRON_RUN_AS_NODE`, handler thật trên DB tạm): DB cũ migrate dở
  (đã có `address`, thiếu 2 cột) → strip đúng block + đủ 3 cột + ghi
  `.bak-005` + reopen idempotent; DB mới skip không backup; admin list đủ
  4 field; admin patch ok + 5 case validation (SĐT sai/trùng, address >255,
  start_date tương lai, notes >500) + clear rỗng → NULL; staff list strip
  notes; staff `users:update` vẫn chặn; `users:profile` không notes;
  `profile:update` ok + trùng SĐT + SĐT sai + bỏ qua notes/start_date lạ +
  rỗng → lỗi.
- **Status: verified** (logic + types + IPC runtime đều chạy thật; chỉ chưa
  test GUI click-through).

## BE-013 — Staff S3 chấm công (runner 006 + shifts/attendance IPC)

- `src/main/db.ts` → `runMigration006()`: chỉ chạy khi DB **đã tồn tại**
  mà thiếu bảng `shifts` hoặc `attendance` (detect qua `sqlite_master`, đủ
  cả 2 → skip, không backup; DB mới bootstrap `schema.sql` đã gộp v006 nên
  skip luôn). Thiếu → checkpoint WAL + copy `parking.db` →
  `parking.db.bak-006`, `exec` NGUYÊN file
  `specs/migration-006-shifts.sql` (toàn `IF NOT EXISTS` / `WHERE NOT
  EXISTS` — không cần strip như 002/005 vì không có `ALTER TABLE`),
  rồi `foreign_key_check` phải sạch + smoke `COUNT(*) FROM shifts >= 3`
  (thiếu seed → throw). Gọi sau 005 trong `openDatabase()` (thứ tự
  002 → 003 → 004 → 005 → 006). Idempotent — chạy N lần không lỗi.
- `shifts:list → Shift[]` (guard `staff` — mọi staff xem giờ ca).
- `shifts:update {id, name?, start_time?, end_time?, is_active?} → Shift`
  (guard `admin`): validate `HH:mm` strict (`HHMM_RE`), `start ≠ end`,
  `end < start` cho phép = ca qua ngày (ghi chú "(ca qua ngày)" trong
  message); `is_active` chỉ 0/1. **Overlap Warning không chặn** (S3.3):
  so khoảng tròn 1440 phút với các ca đang mở khác, trùng → vẫn UPDATE
  + message `"— lưu ý: khung giờ trùng với {name} ({start}–{end}) — kiểm
  tra lại."`; khớp → `"Đã cập nhật {name} {start}–{end}."`.
- `attendance:check-in {shift_id? | shift_code?, opening_cash?, staff_id?} →
  Attendance` (guard `staff`, ép `user_id = me.id` — staff gửi `staff_id`
  cũng bị bỏ qua; chỉ admin được chấm hộ khi truyền `staff_id`, verify
  user tồn tại + `is_active = 1`): resolve ca ưu tiên `shift_id` →
  `shift_code` (whitelist 3 mã) → **auto theo giờ tường từ bảng shifts
  đang mở** (`resolveCurrentShift`: ca thường `start <= t < end`; ca qua
  ngày `t >= start || t < end`; fallback mapping cứng §14 khi không khớp);
  ca tắt → `"Ca {name} đã tắt — không xếp ca mới"`. `work_date` =
  ngày bắt đầu ca (ca đêm + `t < end` → hôm qua). `status` backend quyết:
  phút từ `start_time` đến giờ bấm (xuyên nửa đêm) `> 10p` → `'late'`,
  ngược lại `'present'`. `opening_cash` default 0, integer VND ≥ 0.
  `INSERT` 1 row; trùng `UNIQUE(user_id, shift_id, work_date)` →
  `"Bạn đã vào ca này."` (map `SQLITE_CONSTRAINT_UNIQUE`, không lộ SQL).
- `attendance:check-out {closing_cash?, handover_note?, staff_id?} →
  {attendance, revenue_in_shift, variance}` (guard `staff`, ép me như
  check-in): chốt ca đang mở gần nhất (`check_out_at IS NULL ORDER BY
  work_date DESC` — ca hôm nay, hoặc **"chốt bù"** ca hôm qua còn treo);
  chưa vào ca → `"Bạn chưa vào ca — bấm "Vào ca" trước"`; `now <=
  check_in_at` (cùng giây) → `"thử lại sau ít giây"` (giữ CHECK DB).
  `handover_note` trim max 500 (`undefined` → giữ cũ). Đối soát trong
  cùng transaction: `revenue = SUM(payments.amount) WHERE received_by =
  me AND paid_at trong [work_date+start, work_date(+1)+end)` (khung ca
  qua ngày tính sang hôm sau, khớp `paid_at` UTC); `variance = closing −
  opening − revenue` (NULL khi chưa nhập closing). **Lệch chỉ Warning,
  không chặn chốt ca**: message `"Đã chốt ca {name} ngày {date} —
  đối soát lệch ±X₫ (thực − đầu ca − thu trong ca), admin đối soát
  sau."`; khớp → `"(đối soát khớp)."`; chưa nhập closing → `"."`.
- `attendance:today → {shift, work_date, attendance, pending_close}`
  (guard `staff`, mine-only `me.id`): ca hiện tại theo giờ tường +
  `work_date` quy ước ca đêm; `attendance` = row ca hiện tại của mình
  (NULL = chưa vào → render nút "Vào ca"); `pending_close` = row treo
  cũ nhất **loại trừ row hiện tại** (banner "chốt bù" S3.5).
- `attendance:list {from?, to?, staff_id?, limit?=50/max200, offset?=0} →
  {rows: AttendanceRow[] (kèm shift_code/shift_name/shift_start/shift_end/
  username/full_name), total}` (guard `staff`): staff ép
  `staff_id = me.id` (pattern `mine_only`); admin lọc `staff_id` optional;
  validate `YYYY-MM-DD` + `from <= to`; `ORDER BY work_date DESC` (dùng
  `idx_att_user_date` / `idx_att_date`). GROUP BY báo cáo theo
  `work_date`, không theo `date(check_in_at)` (§14).
- Types mới trong `src/shared/types.ts`: `ShiftCode`, `AttendanceStatus`,
  `Shift`, `Attendance`, `AttendanceRow`, `AttendanceCheckInInput`
  (`shift_id?` + `shift_code?` + `opening_cash?` + `staff_id?`),
  `AttendanceCheckOutInput`, `AttendanceListInput/Output`,
  `AttendanceCheckOutOutput`, `AttendanceTodayOutput`, `ShiftUpdateInput`
  + 6 entry `ApiMap`. Preload generic `invoke<K>` nên không cần sửa
  preload. Không đụng IPC cũ / renderer / schema.
- GHI CHÚ cho @frontend: `attendance:check-out` nên luôn gửi đủ
  `closing_cash` (thiếu → `variance: null`, admin đối soát sau);
  phân biệt 3 trạng thái nút Vào/Ra từ `attendance:today`
  (`attendance == null` → "Vào ca"; có row + `check_out_at == null` →
  "Ra ca"; đã chốt → "Đã chốt ca"); `pending_close != null` → banner
  "Bạn chưa chốt ca {name} ngày {date}" + nút "Chốt bù" (gọi check-out
  như thường — backend tự chốt row treo gần nhất).

### Verification (BE-013)

- `npx tsc --noEmit` → **pass**. `vitest fee-calculator` → **10/10 pass**
  (không đụng).
- IPC runtime chưa chạy (better-sqlite3 build cho Electron
  `NODE_MODULE_VERSION 130`, system node là 137 — như BE-001/008/009/010/
  012) → SQL review bằng tay: mọi câu trong handler đều dùng cột/bảng
  có thật trong `schema.sql` v006 (`shifts`/`attendance` + 3 index +
  UNIQUE 3 cột); `ATTENDANCE_ROW_SELECT` JOIN `shifts` + `users`
  đúng alias `WHERE a.…`; `date(?, '+1 day')` cho khung ca qua ngày;
  UNIQUE chặn chấm 2 lần cùng ca/ngày; staff override `staff_id` chỉ
  khi `role_name === 'admin'`, ngược lại ép `me.id` (không chấm hộ được).
- Ca đêm verify bằng đọc code: `workDateForShift` (`end < start && t <
  end → yesterday`) dùng chung cho check-in/today; check-out chốt row
  treo gần nhất nên ca NIGHT ra lúc 06:00 hôm sau vẫn chốt đúng row
  `work_date` hôm trước.
- **Status: partially_verified** (types + logic + SQL review pass; IPC
  runtime cần `npm rebuild better-sqlite3` đúng toolchain Electron rồi
  chạy lại smoke như BE-011/012).

## BE-014 — Staff S4 phân quyền (runner 007 + resolvePerm + guards + login perms)

- `src/main/db.ts` → `runMigration007()`: chỉ chạy khi DB **đã tồn tại**
  mà thiếu cột `permissions` (detect qua `pragma_table_info('users')`,
  đủ → skip, không backup; DB mới bootstrap `schema.sql` đã gộp v007
  nên skip luôn). Thiếu → checkpoint WAL + copy `parking.db` →
  `parking.db.bak-007`, đọc `specs/migration-007-permissions.sql`,
  **strip block `STEP1-PERMISSIONS` của cột đã tồn tại** (SQLite không có
  `ADD COLUMN IF NOT EXISTS` — DB migrate dở vẫn chạy tiếp đúng phần
  còn thiếu, cùng pattern BE-012), `exec`, rồi `foreign_key_check`
  phải sạch. Gọi sau 006 trong `openDatabase()` (thứ tự
  002 → 003 → 004 → 005 → 006 → 007). Idempotent — chạy N lần không lỗi.
- `src/main/auth.ts` → `resolvePerms(role, raw)` +
  `resolvePerm(user, key)` (đúng contract S4.3:
  `admin ? 1 : (parse(permissions)?.[key] ?? 1)`; parse chấp nhận
  boolean/`'0'`/`'1'` → normalize 0/1; partial JSON thiếu key = 1;
  key lạ → bỏ qua; JSON hỏng/NULL = full `STAFF_DEFAULTS`, không throw)
  + `requirePerm(db, key)` (**đọc fresh từ DB**, không dùng session
  cache — flag admin vừa gán áp dụng ngay ở thao tác tiếp theo, S4.2):
  admin → pass luôn; staff thiếu flag → 403 Việt
  `"Tài khoản của bạn không có quyền {label} — liên hệ quản lý
  (NO_PERMISSION:<key>)"` để frontend map sang toast (S4.3).
  `toUserDTO` (login/me/refresh) đã trả `permissions` (raw) + `perms`
  (resolved map) — frontend ẩn menu theo `perms`, không parse lại.
- `src/main/ipc-handlers.ts`:
  `USER_DTO_SELECT` + `u.permissions`, mọi `users:*` map `withPerms`
  (list/create/update/toggle-active đều trả `perms`; staff list vẫn
  strip `notes` như cũ). Guards S4 theo mapping §11 (guard `role` cũ
  giữ nguyên, chỉ thêm check flag):
  `sessions:check-in|check-out|preview-fee → checkin`;
  `passes:list|create|renew|confirm` + nhánh staff của `passes:cancel → pass_sale`;
  `sessions:check-in` kèm `reservation_code?` → thêm `reservation`;
  `activity:list` + `payments:list` + `reports:dashboard → report_self`;
  `users:profile:update → profile_self`;
  (`users:profile` GET xem luôn được; `users:*` giữ admin-only;
  `sessions:active/history`, `vehicles:find`, `shifts:*`,
  `attendance:*` giữ guard cũ — không trong mapping S4.)
- `users:update` (admin) + patch `permissions?`: whitelist 5 keys
  canonical, giá trị 0/1/boolean/`'0'`/`'1'` (string JSON cũng parse);
  key lạ → bỏ qua; giá trị sai → `errors.permissions` Việt;
  `null`/rỗng → NULL (reset = full); **target admin → bỏ qua, không
  lưu** (admin luôn full); non-admin gửi → bỏ qua im lặng (staff vốn
  đã bị chặn toàn kênh, customer chỉ được full_name/pass).
- Types trong `src/shared/types.ts` đã đủ từ trước
  (`StaffPermissions`, `STAFF_DEFAULTS`, `StaffPermissionKey`,
  `UserDTO.permissions/perms`, `StaffPermissionsInput`,
  `users:update.permissions?`) — không đụng. Preload generic
  `invoke<K>` nên không cần sửa preload. Không migration mới ngoài
  runner, không đụng renderer/schema/api-contract (contract §3+§11
  đã mô tả đúng rule này).
- GHI CHÚ cho @frontend: `auth:me`/`users:list` đã có `perms`
  (resolved map) — render menu theo `perms`, KHÔNG parse
  `permissions`; thiếu flag ở deep-link → toast
  `"Tài khoản của bạn không có quyền {label} — liên hệ quản lý."`
  (strip đuôi `(NO_PERMISSION:…)`); sau khi admin sửa quyền → gọi lại
  `auth:me`/`users:list` để refresh (session active giữ flags cũ đến
  khi login lại, trừ tự sửa profile có `refreshCurrentUser`).

### Verification (BE-014)

- `npx tsc --noEmit` → **pass**. `vitest fee-calculator` → **10/10 pass**
  (không đụng).
- Smoke test runtime 27/27 **pass** (script ngoài repo, chạy bằng
  Electron node `ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\
  electron.exe` vì better-sqlite3 build cho ABI Electron 130, system
  node là 137 — handler thật trên DB tạm): fresh DB có cột
  `permissions`; `resolvePerm` admin = 1, NULL = full, partial thiếu
  key = 1, boolean normalize, JSON hỏng = defaults, key lạ bỏ qua;
  login admin/staff trả `perms`; admin set partial
  `{checkin:1, pass_sale:0, report_self:0}` → resolve đúng + raw JSON
  lưu DB; giá trị `2` → reject; target admin → bỏ qua (NULL);
  `null` → reset full; staff 5 flags = 0 → check-in/passes:create/
  activity:list/profile:update đều 403 Việt chứa `NO_PERMISSION:<key>`;
  đủ flag → qua guard (check-in tạo session thật, profile:update ok);
  `users:list` đủ `perms`; DB cũ (DROP COLUMN) reopen → migrate lại
  cột + ghi `.bak-007` + `foreign_key_check` sạch + staff NULL +
  reopen lần 2 idempotent.
- **Status: verified** (logic + types + IPC runtime đều chạy thật; chỉ
  chưa test GUI click-through).

## BE-015 — Quản lý M1–M3 (reports:transactions + app-config + backup/restore)

- `src/shared/types.ts` → `TxKind`, `TxListInput/Row/Output`, `ParkingSettings`,
  `AppConfigSetInput`, `BackupNowInput/Output`, `RestoreFromFileInput/Output`
  + 5 entry `ApiMap` (`reports:transactions`, `app-config:get/set`,
  `backup:now`, `restore:from-file`). Preload generic `invoke<K>` nên
  không cần sửa preload.
- `src/main/app-config.ts` (mới): settings JSON cạnh DB
  (`userData/app-config.json`, atomic write tmp+rename); `load` mất/hỏng
  file → defaults (không throw để fee preview không vỡ); `save` whitelist
  keys + validate (`lot_name` 1–100, `address` ≤255, phone `^0\d{9}$`,
  logo PNG/JPG dataURL ≤512KB, grace 0–120, threshold 1–24) + cross-rule
  `threshold×60 > grace`; lỗi ném Error có `.errors` mang mã
  `INVALID_PHONE` | `LOGO_TOO_LARGE` | `INVALID_FEE_RULE`.
- `src/main/fee-calculator.ts`: `calculateFee(input, opts?)` thêm
  `{graceMinutes?, dayThresholdHours?}` (default 30/12 — 10 test cũ giữ
  nguyên pass); `preview` trong `ipc-handlers.ts` đọc hằng số từ
  app-config (fallback defaults khi file hỏng) — check-out dùng chung
  `preview` nên tự hưởng (refactor nội bộ, không đổi IPC cũ).
- `src/main/backup-restore.ts` (mới): `checkpointWithRetry` (DB_BUSY →
  đợi 2s × 3), `isSqliteFile` (magic header), `validateRestoreFile`
  (integrity + FK + 8 bảng bắt buộc + user_version → mã `NOT_SQLITE` |
  `INTEGRITY_FAIL` | `SCHEMA_MISMATCH`), `startDailyBackupJob` (tick 60s,
  chạy lúc 03:00, giữ 7 bản `parking-YYYYMMDD-HHmm.db`, log
  `backup-auto.log`, mọi lỗi nuốt không crash app).
- `src/main/ipc-handlers.ts`: 5 IPC admin-only + cờ `restartRequired`
  (sau restore mọi IPC trả "khởi động lại app"):
  `reports:transactions` (JOIN payments/sessions/passes/vehicles/zones/users,
  `kind` CASE adjust/monthly/casual, filter ngày/zone/kind/method/search,
  `ORDER BY paid_at DESC`, limit default 50/max 200 + `total` + `summary`
  SUM/COUNT cùng filter); `app-config:get/set` (set map `.errors` →
  `ValidationError` field-level); `backup:now` (`dest_path` hoặc
  save-dialog ở main, default `parking-YYYYMMDD-HHmm.db`);
  `restore:from-file` (`source_path` hoặc open-dialog ở main — không nhận
  binary từ renderer; chặn `HAS_PARKED_VEHICLES`; auto-backup
  `pre-restore-TIMESTAMP.db`; `close()` + chép đè + xóa `-wal/-shm` +
  `needRestart: true`).
- `src/main/main.ts`: gọi `startDailyBackupJob(db)` trong try/catch sau
  `registerIpcHandlers` (job lỗi không chặn mở app).
- `api-contract.md` §15: contract 5 IPC cho @frontend.
- GHI CHÚ cho @frontend: `received_by_*` NULL = NV đã xóa → render
  "(đã xóa)"; export Excel loop offset (cap 10.000/file), PDF phụ lục tối
  đa 500 dòng; `granularity` gửi lên được chấp nhận nhưng IPC luôn trả
  detail (Tổng hợp dùng views §10); sau restore hiện màn hình chặn +
  nút "Khởi động lại ngay" (chưa có IPC restart — user mở lại app).

### Verification (BE-015)

- `npx tsc --noEmit` → **pass**. `vitest fee-calculator` → **10/10 pass**
  (opts mới optional, test cũ không sửa).
- Smoke test runtime 19/19 **pass** (script ngoài repo, Electron node như
  BE-014, handler thật trên DB tạm): tx list + row shape (casual/ticket/
  biển số/zone) + summary; from>to chặn; search rỗng → total 0; kind
  filter; config defaults + set + file tồn tại; phone sai → INVALID_PHONE;
  cross-rule → INVALID_FEE_RULE; logo >512KB → LOGO_TOO_LARGE; logo GIF
  → từ chối; backup tay → file + size; restore file lạ → NOT_SQLITE;
  còn xe đỗ → HAS_PARKED_VEHICLES; restore thật → needRestart +
  pre-restore tồn tại + mọi IPC sau đó yêu cầu restart.
- **Status: verified** (logic + types + IPC runtime đều chạy thật; chỉ chưa
  test GUI click-through).
