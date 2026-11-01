# Khu vực Khách hàng — Customer Area (DS-009) — Design Spec

> Tokens: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (biển số/mã/tiền/timestamp). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Shell/dialog/toast/keyboard/focus-visible (2px Primary, offset 2px)/motion 150–250ms + `prefers-reduced-motion` → instant: kế thừa `DESIGN.md` §10 + `./specs/parking-app.md` §Global shell + §Cross-screen rules. Pattern table/toolbar/filter: kế thừa §c (Zones) + §f (Báo cáo) + `./specs/activity-log.md` (mine-only, server-enforce). Auth: `./specs/auth-flow.md` §6 (customer landing `/guest`, header 56px tên + Đăng xuất, KHÔNG sidebar). Columns: `api-contract.md` §3 users (`phone`, `username=SĐT`), §6 vehicles (`owner_phone`), §7 passes, §8 sessions, §9 payments. Spec only — no code. Không sửa spec màn khác.

## 0. Quyết định nền (chốt trước 4 pha — @frontend/@node-developer đọc kỹ)

1. **Link vehicle ↔ customer: `vehicles.owner_phone = users.phone` (exact match, chuẩn hóa). KHÔNG thêm cột mới cho P1–P3.**
   - Chuẩn hóa 2 đầu: trim + giữ nguyên dạng `0\d{9}` (validate VN ở register đã chốt). So sánh case-sensitive sau trim (SĐT chỉ số, không uppercase issue như biển số).
   - Backend resolve `me.phone` từ session, **không nhận `phone` từ client** (chống xem ké xe người khác — cùng pattern `activity:list` ép `staff_id = me.id`).
   - Edge: user đổi SĐT → xe cũ mất link (hiển thị note "Xe đăng ký bằng SĐT cũ … liên hệ quầy để gộp" — xem P1). Staff tạo xe với `owner_phone` trùng SĐT customer → tự hiện trong "Xe của tôi" (đây là tính năng, không phải bug).
2. **Không cổng thanh toán online.** Mọi thu tiền vẫn `cash` tại quầy. P3 là "đăng ký trước → trả tiền khi nhận vé".
3. **Nav customer tiến hóa (giữ header 56px hiện tại, thêm tab row):** `Sơ đồ | Xe của tôi | Vé tháng | Đặt chỗ | Hồ sơ` — tab là `<nav aria-label="Khu vực khách hàng">` + `aria-current="page"`, keyboard ←/→, nội dung dưới là content max 1200px/24px gutters. Guest ẩn danh giữ nguyên (chỉ Sơ đồ, không tabs).
4. **Thứ tự triển khai: P1 → P2 → P3 → P4.** P1/P2 không DB mới (làm trước, value ngay). P3 cần 1 migration nhỏ (enum). P4 cần bảng mới (làm cuối, tách riêng cho @database).

---

## P1 — Hồ sơ cá nhân (làm đầu tiên)

### P1.1 Layout / nav
- Tab "Hồ sơ" trong customer tab row (§0.3). Content: 2 card dọc (max 640px, gap 24):
  - Card 1 "Thông tin cá nhân": row SĐT (read-only, mono 14 + badge "Dùng để đăng nhập") + field Họ tên (editable) + nút "Lưu thay đổi" (primary 40px).
  - Card 2 "Đổi mật khẩu": 3 fields (Mật khẩu hiện tại / Mật khẩu mới / Xác nhận) + nút "Đổi mật khẩu" (secondary).
- SĐT **không cho sửa tự do V1** (vì là username + khóa link xe §0.1). Muốn đổi SĐT → ra quầy (staff đổi qua màn Nhân viên/users). Hiển thị helper 12/Text-60: "Muốn đổi số điện thoại — vui lòng ra quầy (số này liên kết xe của bạn)."

### P1.2 Contract API — TÁI DÙNG 100%, không API mới
- `users:update {id, full_name}` — đã có (dùng cho sửa họ tên). Frontend chỉ gửi `full_name`; backend giữ guard: customer chỉ được update **chính mình** (`id = me.id`, bỏ qua/403 nếu khác — cùng pattern mine-only).
- Đổi mật khẩu: **tái dùng `users:update` với thêm field `password + current_password`** (không tạo IPC mới). Backend verify `current_password` bằng bcrypt trước khi hash pass mới; sai → trả `INVALID_CURRENT_PASSWORD` (frontend map sang inline lỗi dưới field Mật khẩu hiện tại, không banner chung).
- Không thêm cột DB. Không migration.

### P1.3 Validation
- Họ tên: trim ≥2, ≤50 ký tự (copy lỗi giống register: trống → "Vui lòng nhập họ và tên."; <2 → "Họ tên phải ≥2 ký tự."). onBlur + onSubmit; sửa → xóa lỗi field đó ngay.
- Mật khẩu mới: ≥6 ký tự (lỗi "Mật khẩu phải ≥6 ký tự."), phải khác mật khẩu hiện tại ("Mật khẩu mới phải khác mật khẩu hiện tại."); Xác nhận phải khớp ("Mật khẩu xác nhận chưa khớp."). Strength hint 12/Text-60 không chặn.
- Submit: không disable cứng khi invalid (để SR submit và nghe banner tổng hợp "Còn X mục cần sửa." `role="alert"`); disabled + `aria-busy` chỉ khi loading.

### P1.4 States
- Loading: nút → spinner + "Đang lưu…"/"Đang đổi…" + form `aria-busy`.
- Success: toast Success "Đã cập nhật họ tên." / "Đổi mật khẩu thành công — phiên khác đã đăng xuất." (gợi ý backend revoke session khác nếu có; không bắt buộc V1).
- Error: sai pass hiện tại → inline field; `FORBIDDEN` (cố update id khác) → Danger banner + "Đăng nhập lại"; mạng → banner + "Thử lại" (focus vào banner).
- Dirty-guard: rời tab khi form dirty → confirm dialog reuse §Cross-screen ("Thay đổi chưa lưu — Rời đi / Ở lại").

### P1.5 A11y
- Mỗi input `<label for>` + `aria-describedby` hint/lỗi; lỗi → `aria-invalid="true"`. Show/hide password `aria-pressed` + label động. Banner `role="alert"` + focus vào khi hiện. Full keyboard Tab → CTA. Contrast Danger 12 dùng 500+ weight (≥4.5:1). 200% zoom: card scroll dọc, không tràn.

---

## P2 — Xe của tôi + Lịch sử + Tổng tiền (làm thứ hai)

### P2.1 Layout / nav
- Tab "Xe của tôi": toolbar (search biển số 240px `role="search"` + filter loại xe car/motorbike + spacer + tổng tiền chip) + table full-width:
  - Columns: `Biển số (mono 14, uppercase) | Loại | Khu gần nhất | Lượt gửi (số) | Tổng tiền (mono, vi-VN ₫) | Trạng thái (badge: Đang đỗ Primary / Không có xe Success-neutral)`.
  - Row click → drawer 360px phải (reuse §e passes drawer): chi tiết xe + 5 lượt gửi gần nhất (mã vé mono, vào/ra `dd/mm/yyyy HH:mm`, tiền).
- Tab "Lịch sử của tôi" (gộp trong cùng pha, tab con hoặc section dưới — **quyết định: 2 tabs riêng** `Xe của tôi | Lịch sử` để table lịch sử có filter ngày riêng, không nhồi 2 table 1 màn):
  - Toolbar reuse activity-log §2: date-range (Hôm nay/7/30 ngày/Tùy chọn) + search mã vé/biển số + tổng tiền footer.
  - Columns reuse activity-log §2 trừ cột Nhân viên (customer chỉ thấy mình nên bỏ): `Thời gian | Mã vé | Biển số | Khu | Tiền`.
  - Footer: "Tổng cộng: X lượt · Y ₫" (mono) theo đúng filter hiện tại.

### P2.2 Contract API — MỚI (thin wrapper, không cột mới)
- Tái dùng logic query hiện có, bọc 2 IPC mới để enforce mine-only server-side:
  - `customer:vehicles → {vehicles: Vehicle[] + per-vehicle stats}` — backend: `SELECT * FROM vehicles WHERE owner_phone = me.phone ORDER BY license_plate`; stats JOIN sessions (`COUNT`, `SUM(total_fee)`), trạng thái đang đỗ (`EXISTS status='parked'`).
  - `customer:sessions {from?, to?, search?, limit?, offset?} → {rows, total}` — backend: `JOIN vehicles ON vehicle.owner_phone = me.phone`, `ORDER BY check_in_at DESC`. Row: `ticket_code, license_plate, zone_code/name, check_in_at, check_out_at, total_fee, monthly_pass_id` (+ `is_monthly` để render "Vé tháng (0₫)" như activity-log).
- Phân biệt rõ: **IPC mới nhưng SQL/cột cũ 100%** — không migration. `payment_method` lấy từ `payments` JOIN newest (reuse activity-log §4) cho tooltip, không bắt buộc V1.

### P2.3 Validation
- Search: trim, uppercase hóa biển số trước LIKE; SĐT không nhập lại (lấy từ session). Date-range: `from ≤ to`, max 90 ngày (Warning "Khoảng >90 ngày — thu hẹp để xem đủ" reuse §f).

### P2.4 States
- Loading: skeleton 6 rows + toolbar skeleton, `aria-busy`, không shift-layout.
- Empty xe: "Bạn chưa có xe nào — xe do quầy nhập với đúng SĐT {phone} sẽ tự hiện ở đây." + nút "Xem Sơ đồ" (onboard tone).
- Empty lịch sử: "Chưa có lượt gửi nào trong khoảng này" + "Mở rộng khoảng ngày". Empty-search: "Không tìm thấy" + "Xóa bộ lọc".
- Error/FORBIDDEN: banner + "Tải lại" (giống activity-log §6).

### P2.5 A11y
- Table `<th scope>` + `aria-sort` (Thời gian); tiền/mã/timestamp mono; badge có text (không màu-only); contrast badge text ≥4.5:1 (dùng bản darkened như DESIGN.md §10.1). Toasts `role="status"`/`alert`, max 3, 4s. Keyboard `/` focus search, `Esc` đóng drawer. 200% zoom: table scroll ngang trong content, sticky header.

---

## P3 — Tự mua vé tháng (làm thứ ba, luồng "đăng ký trước — trả tiền tại quầy")

### P3.1 Layout / nav
- Tab "Vé tháng": 2 section:
  - Section A "Vé của tôi": table reuse §e (vé tháng staff) nhưng bỏ cột thao tác staff: `Mã vé (mono) | Biển số | Khu | Gói | Hiệu lực (start→end) | Trạng thái (badge)`. Badge thêm 1 loại mới: **Chờ xác nhận** = Warning tint (`rgba(217,119,6,0.10)`, text `#92400E`, icon `Clock` 12).
  - Section B "Đăng ký vé mới": form 4 fields (Biển số — combobox từ Xe của tôi + cho nhập mới; Khu — select từ zones active; Gói — radio cards 1/3/6/12 tháng + giá preview mono; Ghi chú optional) + bảng giá preview (giá/tháng theo zone `price_per_day*30` hoặc bảng giá staff — **quyết định: giá = cùng công thức staff §e**, frontend preview, backend chốt) + CTA "Gửi đăng ký" (primary). Helper 12: "Không thanh toán online — bạn trả tiền mặt/chuyển khoản tại quầy khi nhận vé."
- Sau submit: row mới hiện ngay với badge Chờ xác nhận + banner info "Đã gửi đăng ký {pass_code} — mang {tiền} ra quầy để kích hoạt." + nút "Hủy đăng ký" (khi còn chờ).

### P3.2 Contract API — 1 IPC mới + 1 migration NHỎ (bắt buộc, ghi rõ cho @database)
- IPC mới `customer:pass-request {license_plate, vehicle_type?, zone_id?, months: 1|3|6|12, note?} → {pass}`:
  - Backend: upsert vehicle (nếu biển số mới → `INSERT vehicles {owner_phone = me.phone, owner_name = me.full_name}` — tái dùng logic check-in); tính `price` = công thức staff (gói 12 giảm 10%); `INSERT monthly_passes {status='pending', created_by = me.id, customer_name/phone = me}`.
  - IPC hủy: tái dùng `passes:cancel` (guard: chỉ pass của mình + status pending) — không IPC mới.
  - Staff xác nhận: tái dùng màn Vé tháng staff + IPC `passes:confirm` hiện có (set `pending → active` + `INSERT payments {cash tại quầy}` trong 1 transaction — mirror transaction check-out §8).
- **Migration bắt buộc (P3): mở rộng `monthly_passes.status` CHECK thêm `'pending'`.** Không thêm cột/bảng. Schema đề xuất cho @database (không tự tạo migration ở spec này):
  ```sql
  -- migration-00X_customer_pass_pending.sql
  -- SQLite: recreate CHECK via table rebuild hoặc trigger validate; giữ dữ liệu cũ.
  -- CHECK mới: status IN ('pending','active','expired','cancelled','suspended')
  ```
  Nếu DB engine từ chối CHECK-inline → dùng trigger `BEFORE INSERT/UPDATE` báo lỗi khi status ngoài tập trên.

### P3.3 Validation
- Biển số: trim, uppercase, pattern VN cơ bản (≥4 ký tự alnum + `-`/`.` cho phép; lỗi "Biển số chưa đúng — VD: 51H-12345."); xe của người khác (owner_phone khác mà đã tồn tại) → chặn "Biển số này đã thuộc SĐT khác — liên hệ quầy." (chống chiếm vé).
- Zone: phải `is_active=1` + `vehicle_type_allowed` khớp loại xe (lỗi "Khu {code} không nhận loại xe này.").
- Chống trùng: đã có pass `pending`/`active` overlapping cùng xe+khu → chặn "Xe này đã có vé {code} còn hiệu lực/chờ xác nhận."
- Gói: bắt buộc chọn 1 trong 4 (default 1 tháng).

### P3.4 States (luồng trạng thái chốt)
```
pending (Chờ xác nhận, Warning) ──staff xác nhận + thu tiền──▶ active (Success)
   │── customer hủy / staff từ chối ──▶ cancelled (Text-60)
active ── hết hạn (cron) ──▶ expired ── gia hạn (staff hoặc đăng ký mới P3) ──▶ pending/active
```
- Pending row: nút "Hủy đăng ký" (confirm dialog). Active row: nút "Gia hạn" → prefill form Section B. Cancelled/expired: text-only + "Đăng ký lại".
- Loading/error/toast: như P1/P2; submit fail trùng vé → inline dưới field Biển số (không banner chung).

### P3.5 A11y
- Gói radio cards là `radiogroup` + `radio` thật (keyboard arrows), giá mono. Form labels + `aria-describedby` giá preview (live `aria-live="polite"` khi đổi gói/khu). Badge Chờ xác nhận có text + icon `aria-hidden`. Confirm hủy là dialog `role="dialog" aria-modal` + focus trap + Esc.

---

## P4 — Đặt chỗ trước (làm cuối, V1 tối thiểu)

### P4.1 Phạm vi V1 — quyết định (tối thiểu, tránh bảng mới nếu được → kết luận: BẮT BUỘC bảng mới)
- Đã xét tái dùng: `parking_spots.status='reserved'` đơn độc **không đủ** (không biết ai giữ, giữ tới khi nào, mã nào để đối soát) → mọi cách "nhét" vào cột hiện có đều là phát minh cột âm thầm → **loại**.
- **Kết luận: P4 BẮT BUỘC 1 bảng mới `reservations`. @database làm migration; spec này chỉ đưa schema đề xuất + IPC.**
- Phạm vi V1 khóa: **chỉ giữ chỗ trong ngày** (date = today, không qua đêm); khung giờ do customer chọn (tối thiểu 1h, tối đa 4h); **tự hủy sau 15–30p quá giờ bắt đầu không check-in** (job quét 5 phút/lần, `expired` + spot về `available`); mỗi customer tối đa **2 reservation active**; không thanh toán trước (giữ chỗ miễn phí, thu phí lúc gửi như thường).
- Mã đặt chỗ: `R-YYYYMMDD-XXXX` (mono, in-app + copy button).

### P4.2 Layout / nav
- Tab "Đặt chỗ": form 3 fields (Khu — select active + còn chỗ; Ngày — default hôm nay, disable quá khứ + disable ngày khác hôm nay ở V1 với helper "V1 chỉ giữ chỗ trong ngày"; Khung giờ — 2 time input Từ/Đến) + preview "Còn X chỗ tại khu {code}" (live từ `zoneAvailability`) + CTA "Giữ chỗ" → success panel (mã `R-…` mono lớn + QR-text fallback + giờ hiệu lực + nút "Copy mã" + "Hủy giữ chỗ").
- Section "Giữ chỗ của tôi": list cards (mã mono + khu + giờ + countdown "Hết hạn sau Np" live 60s + badge: Giữ chỗ Success / Sắp hết Warning ≤15p / Hết hạn Text-60).

### P4.3 Contract API — MỚI (2 IPC + schema đề xuất)
- `customer:reserve {zone_id, date(=today), time_from, time_to} → {reservation}` — backend: check capacity (`free_spots>0`), check quota 2 active, `INSERT reservations {status='held'}` + `UPDATE spots (1 ô available→reserved, auto-pick)`. Trả `code + expires_at (= time_from + 20p)`.
- `customer:reservations → {rows}` + `customer:reserve-cancel {code}` (chỉ của mình + status held) — spot về available.
- Check-in với mã: staff nhập mã vào Check-in form (tái dùng `CheckInInput` + thêm `reservation_code?`; backend consume → `held→used`).
- Schema đề xuất cho @database (không tạo migration ở đây):
  ```sql
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,            -- 'R-YYYYMMDD-XXXX'
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_phone TEXT NOT NULL,
    zone_id INTEGER NOT NULL REFERENCES parking_zones(id),
    spot_id INTEGER REFERENCES parking_spots(id),  -- ô đã giữ (nullable nếu chỉ giữ theo khu)
    date TEXT NOT NULL,                   -- YYYY-MM-DD (= today ở V1)
    time_from TEXT NOT NULL,              -- HH:mm
    time_to TEXT NOT NULL,                -- HH:mm, CHECK > time_from
    status TEXT NOT NULL DEFAULT 'held'
      CHECK (status IN ('held','used','expired','cancelled')),
    expires_at TEXT NOT NULL,             -- ISO8601 = time_from + 20 phút
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_reservations_phone ON reservations(customer_phone);
  CREATE INDEX idx_reservations_status ON reservations(status);
  ```

### P4.4 Validation
- Ngày phải = hôm nay (V1); `time_from < time_to`, trong giờ hoạt động bãi (config, default 06:00–22:00); duration 1–4h; `time_from` không quá khứ >15p. Lỗi inline từng field (copy VN cụ thể, không "Dữ liệu không hợp lệ").
- Hết chỗ / quá quota → banner Warning (không phải lỗi user): "Khu {code} vừa hết chỗ giữ — chọn khu khác." / "Bạn đã có 2 chỗ đang giữ."

### P4.5 States & A11y
- Loading skeleton form; success panel `role="status"` + focus vào mã; countdown `aria-live="off"` (tránh spam SR) + text tĩnh "Hết hạn lúc HH:mm"; copy mã → toast "Đã sao chép mã {code}."; hết hạn → row mờ + badge + nút "Đặt lại". Job expiry không cần realtime push — poll 60s khi tab mở (reuse Guest 30s pattern, nhẹ hơn).
- Time inputs native `<input type="time">` có label; form keyboard-only pass; contrast badge như §10.1; 200% zoom không tràn.

---

## Thứ tự triển khai + mục cần DB (tóm tắt cho @leader)

| Pha | Value | DB mới? | IPC | Làm khi nào |
|---|---|---|---|---|
| P1 Hồ sơ | Cao (giảm ticket quầy) | **Không** | Tái dùng `users:update` (+`current_password`) | Đầu tiên |
| P2 Xe + lịch sử | Cao nhất (lý do đăng nhập) | **Không** | 2 IPC mới bọc query cũ (`customer:vehicles`, `customer:sessions`) | Sau P1 |
| P3 Vé tháng tự đăng ký | Cao (doanh thu) | **Nhỏ: +`'pending'` vào status CHECK** | 1 IPC mới (`customer:pass-request`), tái dùng `passes:cancel/confirm` | Sau P2 |
| P4 Đặt chỗ | Trung bình (nice-to-have) | **Có: bảng `reservations` mới** | 2–3 IPC mới | Cuối cùng |

**Status: verified** — đủ 4 pha P1→P4 (mỗi pha layout/nav + contract tái dùng/mới + validation + states + a11y), link xe qua `owner_phone=phone` không cột mới, P3 pending-check + P4 schema đề xuất ghi rõ cho @database, không phát minh cột âm thầm.
