# PocketBase Online — Import Collections + Vận hành (DB-008)

> Scope: ánh xạ SQLite (`specs/schema.sql` + `api-contract.md` §1–§14) sang
> PocketBase collections. Chỉ file spec — KHÔNG đụng app code, KHÔNG sửa SQLite.

## 0. Quyết định đã chốt (theo hợp đồng Leader)

| # | Quyết định |
|---|---|
| 1 | **1 auth collection `users`**. Login bằng **`username`** (staff username / customer SĐT). `email` để trống optional, `emailVisibility:false`. Không dùng email giả `phone@…`. |
| 2 | Bỏ bảng `roles` → field `role` select trên `users` (`admin/staff/customer`). `guest` không có row, không login. Rule PB dùng `@request.auth.role`. |
| 3 | `zones/spots` **public read** (`listRule/viewRule = ""`) cho guest xem availability; write admin (spots update cho staff để check-in/out đổi status). |
| 4 | `reservations` mine-only **server-side**: `user = @request.auth.id` trong list/view/update + staff/admin full. |
| 5 | `passes` (vé tháng) customer mine-only **client-filter** (link bằng `customer_phone`, không có field `user`) — app filter `customer_phone = me.phone`. Ghi rõ dưới. |
| 6 | `payments.updateRule/deleteRule = null` (append-only, khóa hẳn ở server). |
| 7 | **Bcrypt SQLite KHÔNG mang sang được** — PB tự hash password. Import users KHÔNG kèm password → bắt buộc reset/đặt lại sau import. |

## 1. Chuẩn bị server

1. Chạy PocketBase online (VPS / fly.io / Railway…), ví dụ `https://pb.example.com`.
2. Mở `https://pb.example.com/_/` → tạo **superuser** đầu tiên (nếu chưa có).
3. Settings → Auth: bật **username/password auth** cho collection `users` sau import
   (`allowUsernameAuth:true`, `requireEmail:false`, min password 6 — đã set trong JSON options).
4. Settings → CORS / Allowed origins: thêm origin app (`http://localhost:*`, domain prod).
   Ghi `POCKETBASE_URL` vào `.env` phía app (việc của BE, không làm ở task này).

## 2. Import collections (Admin UI)

1. Vào `/_/` → Collections → **Import** (góc phải) → chọn file
   `./specs/pocketbase-collections.json` (mảng 10 collections).
2. Kiểm tra preview: 1 auth (`users`) + 9 base
   (`zones, spots, vehicles, passes, sessions, payments, shifts, attendance, reservations`).
3. **Relation check**: mọi relation trỏ đúng collection đích
   (`spots.zone→zones`, `sessions.vehicle/spot/zone/monthly_pass→…`,
   `reservations.user→users`, …). Nếu field báo đỏ `collectionId`:
   sửa tay trỏ lại đúng tên collection rồi Save.
4. Confirm import. Thứ tự tạo row dữ liệu sau này (theo FK):
   `users → zones → spots → vehicles → shifts → passes → sessions → payments → attendance → reservations`.

## 3. Seed tối thiểu sau import

1. Tạo admin đầu tiên: Auth → `users` → New → `username: admin`, `role: admin`,
   `full_name`, `is_active:true`, đặt password mạnh.
2. `shifts` (nếu chưa có data): thêm 3 row
   `MORNING/Ca sáng/06:00/14:00`, `AFTERNOON/Ca chiều/14:00/22:00`,
   `NIGHT/Ca đêm/22:00/06:00`, `is_active:true`.
3. `zones`: `A/Khu A - Ô tô/both…`, `B/Khu B - Xe máy…`, `C…` + giá VND.
4. `spots`: sinh `A-01…`, `B-01…` theo capacity.

## 4. Import dữ liệu từ SQLite (CSV)

Xuất từng bảng SQLite ra CSV rồi import qua Admin UI (collection → Import data)
hoặc API batch. Lưu ý ánh xạ:

| SQLite | PB | Lưu ý |
|---|---|---|
| `users` | `users` | **BỎ cột `password_hash`**; `role_id→role` name; `is_active 0/1→bool`; `permissions TEXT→JSON` (parse, hỏng → null) |
| `parking_zones` | `zones` | `is_active→bool` |
| `parking_spots` | `spots` | `zone_id→zone` (map id cũ→id mới); status giữ nguyên |
| `vehicles` | `vehicles` | `license_plate` UPPERCASE trước khi import |
| `monthly_passes` | `passes` | `vehicle_id/zone_id/created_by` map id; date giữ `YYYY-MM-DD` |
| `parking_sessions` | `sessions` | `total_fee NULL` giữ khi `parked`; datetime `YYYY-MM-DD HH:MM:SS` → ISO (`T`, `Z` nếu UTC) |
| `payments` | `payments` | append-only; `paid_at` → ISO |
| `shifts` | `shifts` | như seed |
| `attendance` | `attendance` | `user_id→user`, `shift_id→shift`; `opening_cash` bắt buộc (NULL cũ → 0) |
| `reservations` | `reservations` | `user_id→user`, `spot_id→spot` nullable |

**CSV mẫu import users (KHÔNG kèm password)** — `users-import.csv`:

```csv
username,full_name,phone,role,is_active,address,start_date,notes,permissions
0901234567,Nguyen Van A,0901234567,customer,true,,,,
staff01,Tran Thi B,0907654321,staff,true,12 Le Loi,2025-01-15,,{"checkin":1,"pass_sale":1,"report_self":1,"profile_self":1,"reservation":1}
```

Sau import users → từng người dùng **Forgot/Change password** (hoặc superuser
đặt lại trong Auth → user → Change password) vì hash cũ không tái sử dụng.

## 5. Test nhanh API

```bash
export PB=https://pb.example.com
# 1. Public availability (guest, không cần token)
curl "$PB/api/collections/zones/records?page=1&perPage=5"
curl "$PB/api/collections/spots/records?filter=(zone='ZONE_ID' && status='available')"
# 2. Login username (customer SĐT / staff username)
curl -X POST "$PB/api/collections/users/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"0901234567","password":"mat-khau-moi"}'
# -> lay token
export TK=AUTH_TOKEN
# 3. Mine-only reservations (server-side rule)
curl -H "Authorization: Bearer $TK" \
  "$PB/api/collections/reservations/records?filter=(user='$USER_ID')"
# 4. Staff-only ghi nhan (expect 403 neu role=customer)
curl -H "Authorization: Bearer $TK" "$PB/api/collections/sessions/records?perPage=1"
```

## 6. Server-side rule vs client-filter (bắt buộc đọc)

| Dữ liệu | Server-side (`@request.auth.*`) | Client-filter (app tự lọc) |
|---|---|---|
| zones/spots availability | public read cố ý | — |
| reservations của tôi | ✅ `user = @request.auth.id` | thêm filter `user=me` để đỡ tải |
| shifts/attendance | auth cơ bản; update/delete admin | staff `user=me`, admin lọc `staff_id` (pattern mine_only cũ) |
| sessions/payments | ✅ staff/admin only | staff `received_by=me` cho “ca của tôi” |
| passes của customer | ❌ (không có field user) | ✅ `filter customer_phone = me.phone` — customer KHÔNG thấy pass người khác do app lọc; muốn chặt server-side cần P2: thêm field `user` vào passes |
| users.notes | ❌ PB không có field-level rule | ✅ app strip `notes` khi `role=staff` (giữ DTO cũ); P2: hook `OnRecordEnrich` xóa notes |

## 7. Khác biệt SQLite → PB (để BE/FE không vỡ giả định)

1. **CHECK → select/required/min/max + validate app**: enum/status/code pattern
   (`R-YYYYMMDD-####`, `06:00–22:00`, `end>start`, `out>in`, quota ≤2, `session|pass
   NOT NULL` ở payments) PB không ép được → chuyển hết sang app validate + hook P2.
2. **Trigger `updated_at` → autodate**: PB tự set `updated/created`; bỏ 9 trigger.
3. **Views → query/API**: `v_zone_availability` = `GET spots?filter=…&fields…` +
   count client (hoặc hook aggregate P2); `v_revenue_daily` / `v_sessions_daily` /
   `v_spot_map` tương tự (realtime thay cho poll 30s — xem §8).
4. **FK delete behavior**: `CASCADE zones→spots` giữ (`cascadeDelete:true` ở
   `spots.zone`); còn lại RESTRICT/SET NULL cũ → để `cascadeDelete:false` + app giữ
   lịch sử (không xóa cứng vehicles/zones còn history).
5. **Tiền VND**: PB `number` (float) — app luôn làm tròn int VND trước khi ghi.
6. **Bool**: `is_active 0/1` → `bool`; query cũ `=1` → `=true`.
7. **Realtime**: PB realtime subscriptions thay poll 30s (`v_spot_map`);
   FE subscribe `spots`/`sessions` theo zone (chi tiết FE tự design, P2).
8. **Hook P2 (chưa làm ở task này)**: `pb_hooks/*.pb.js` — ép `role` khi public
   signup (chống tự nâng admin), ép `user=auth` khi tạo reservation/attendance,
   validate `end>start` / `out>in` / payments 1-trong-2, strip `notes` cho staff,
   expiry sweep passes/reservations.

## 8. Rollback

- Import sai → xóa collections vừa import (Collections → Delete) rồi import lại;
  dữ liệu prod đã ghi → restore từ backup PB (Settings → Backups) hoặc SQLite gốc
  (nguồn sự thật vẫn là `parking.db` cho đến khi BE chuyển hẳn).
- Không xóa SQLite/migration cũ ở task này.
