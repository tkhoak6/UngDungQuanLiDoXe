# App Mobile — UX Spec (Flutter, Android + iOS) — DS-012

> Stack: Flutter (single codebase Android+iOS). Spec only — KHÔNG code.
> Tokens kế thừa `DESIGN.md` §2–§9 + §10 mapping: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font: Plus Jakarta Sans (UI) + JetBrains Mono (biển số/mã/tiền/timestamp). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Focus-visible 2px Primary offset 2px. Motion 150–250ms + `prefers-reduced-motion` → instant.
> Nguồn entities: `api-contract.md` §1–§14. Luồng desktop tham chiếu: `./specs/parking-app.md` (§d check-in/out, §e vé tháng, §g guest map), `./specs/customer-area.md` (P1 hồ sơ, P2 xe/lịch sử, P3 vé, P4 đặt chỗ).
> Mobile V1 = **local SQLite mirror, chưa cần server** (sync sau — §7). Mọi IPC trong api-contract map 1-1 sang DAO local ở V1.

## 0. Phạm vi chốt (V1 vs P2)

| Đối tượng | V1 (làm ngay) | P2 (để sau) |
|---|---|---|
| **Khách (customer + guest)** | Sơ đồ chỗ trống (read-only, poll 30s), Đặt chỗ trong ngày (P4 customer-area), Xe của tôi + Lịch sử của tôi (P2), Vé tháng của tôi + đăng ký trước (P3), Hồ sơ + đổi MK (P1), Login SĐT + guest mode | Thanh toán online, đặt qua đêm / nhiều ngày, thông báo push, QR vào cổng, đa ngôn ngữ |
| **Nhân viên (staff)** | Check-in, Check-out + thu phí (cash/transfer tại chỗ), tra mã đặt chỗ, Chấm công Vào/Ra ca (attendance S3), Lịch sử ca mình | Quản lý zone/giá, báo cáo doanh thu full, quản lý users |
| **Admin** | **P2 — không làm mobile V1** (dùng desktop). Mobile chỉ hiển thị "Liên hệ quản trị viên" nếu role=admin đăng nhập | Dashboard admin, CRUD zone, backup/restore, cấu hình giá |

- Quyết định nav: **bottom-tab 4–5 tabs/role + top app bar 56dp**, KHÔNG sidebar, KHÔNG drawer chính (drawer chỉ dùng cho chi tiết row như desktop §e).
- Quyết định auth: tái dùng `users` + login-by-username (SĐT) hiện có; guest mode không cần login (chỉ Sơ đồ).

## 1. IA & Bottom-tab nav

### 1.1 Khách đã login (customer) — 5 tabs

```
[Sơ đồ] [Đặt chỗ] [Xe tôi] [Vé] [Cá nhân]
```

| Tab | Route | Nội dung | Badge |
|---|---|---|---|
| Sơ đồ | `/map` (default landing) | Zone chips + grid ô + summary strip (reuse parking-app §g, thu gọn mobile — §2.1) | Danger dot khi 1 zone đầy |
| Đặt chỗ | `/reservations` | Form giữ chỗ trong ngày + list "Giữ chỗ của tôi" (P4 customer-area §P4, mobile-first — §2.2) | Count pending (Success tint) |
| Xe tôi | `/vehicles` | Toolbar search + list cards xe + Lịch sử (segmented [Xe \| Lịch sử] trong cùng tab để tiết kiệm tab) | — |
| Vé | `/passes` | Section Vé của tôi + Đăng ký vé mới (P3, radio gói dạng cards dọc mobile) | Warning dot khi vé ≤7 ngày / pending |
| Cá nhân | `/profile` | Card Thông tin + Đổi MK (P1, form 1 cột) + Đăng xuất | — |

- Tab bar: height 64dp + safe-area bottom; icon 24dp + label 12/medium; selected = Primary icon+label, indicator pill tint `rgba(22,119,255,0.10)`; unselected Text/60.
- `NavigationBar` semantics: `selectedIndex` + `onDestinationSelected`; mỗi destination có `tooltip` = label; `aria-current` tương đương (`Semantics(selected: true, label: ...)`).

### 1.2 Khách ẩn danh (guest) — 1 màn, không tabs

- Chỉ `/map` read-only + CTA bottom sheet "Đăng nhập để đặt chỗ" (2 nút: Đăng nhập / Tiếp tục xem). Không hiện tabs Đặt chỗ/Xe/Vé/Cá nhân.

### 1.3 Nhân viên (staff) — 4 tabs

```
[Check-in] [Thu phí] [Chấm công] [Tôi]
```

| Tab | Route | Nội dung |
|---|---|---|
| Check-in | `/staff/checkin` (default) | Form biển số + khu + loại vé (reuse §d, xếp dọc mobile — §3.1) |
| Thu phí (Check-out) | `/staff/checkout` | Search ticket/biển số + preview phí + thu (cash/transfer) + in/báo |
| Chấm công | `/staff/attendance` | Card ca hiện tại + nút Vào/Ra + opening/closing cash + lịch sử 7 ngày |
| Tôi | `/staff/me` | Hồ sơ gọn (SĐT/địa chỉ tự sửa S1.4) + Lịch sử ca mình + Đăng xuất + phiên bản app |

- Guard theo `permissions` (§11/S4): thiếu `checkin` → tab Check-in/Thu phí ẩn + toast `NO_PERMISSION`; thiếu `reservation` → ẩn field mã đặt chỗ; thiếu `report_self` → ẩn lịch sử ca.
- Admin đăng nhập mobile V1 → màn chặn: icon + "Quản trị dùng bản desktop" + nút Đăng xuất (không crash, không hiện tabs staff).

## 2. Màn khách (mobile-first 360–430px)

### 2.1 Sơ đồ (`/map`) — ưu tiên tốc độ + đọc ngoài nắng

- Layout (360px): AppBar 56dp (logo + "Sơ đồ trống" 18/semibold + clock mono 12) → zone chips horizontal scroll (height 40dp, selected Primary fill white text) → summary strip 14 ("Còn 34/120 · 10s trước" + nút refresh icon 48dp) → grid 4 cột (cell min 72×56, gap 8, radius 8; free = Success outline+tint, occupied = Primary solid, maintenance = hatched + 🔧) → legend 12 (3 chips) sticky bottom trên grid → footer hint 12.
- Khác desktop §g: grid 4 cột thay vì 14 (vuốt dọc); plate trong cell rút gọn 10 mono (vd "51H…45") hoặc chỉ dot nếu hẹp; tap cell free → bottom sheet chi tiết (zone/giá giờ/mono + nút "Giữ chỗ" deep-link `/reservations?zone=X`); occupied → sheet read-only (không action).
- Poll 30s + manual refresh; crossfade 200ms; pause khi app backgrounded (`AppLifecycleState.paused` dừng timer).
- Contrast ngoài trời: text trên tint dùng bản darkened (Success text `#15803D`, Warning `#92400E`), không white-on-tint; toggle "Tương phản cao" trong Cá nhân (dày border 2dp, label 14).

### 2.2 Đặt chỗ (`/reservations`) — P4 thu gọn 1 cột

- Form card (padding 16, gap 12): Khu select (dropdown full-width, suffix "còn X") → Ngày (native date picker, default today, helper "V1 chỉ giữ chỗ trong ngày") → Từ/Đến (`input type=time` native, duration hint live "2h · trong 06:00–22:00") → preview availability 14 ("Còn X chỗ tại A") `aria-live polite` → CTA "Giữ chỗ" primary full-width height 48.
- Success: bottom sheet (không dialog giữa màn — mobile) với mã `R-…` mono 20 + giờ hiệu lực + countdown "Hết hạn sau Np" + 2 nút [Copy mã] [Hủy giữ chỗ].
- List "Giữ chỗ của tôi": cards dọc (mã mono + khu + giờ + badge Giữ/Sắp hết/Hết hạn + nút Hủy icon 48dp). Quota 2 → CTA disabled + Warning helper "Bạn đã có 2 chỗ đang giữ."
- Validation inline như P4.4 (ngày=today, 1–4h, 06:00–22:00); lỗi sai khung → inline dưới field, không banner chung.

### 2.3 Xe tôi (`/vehicles`) — segmented 2 trang trong 1 tab

- Segmented [Xe của tôi | Lịch sử] top (48dp, `SegmentedButton` semantics tablist).
- Xe: search bar 48dp (`role=search`) + filter loại xe chips → cards dọc (mỗi card: biển số mono 18/bold-uppercase + badge trạng thái + row Loại/Khu gần nhất/Lượt/Tổng tiền mono) thay vì table desktop (table → cards ở <600px). Tap card → detail bottom sheet (thay drawer 360px desktop): info + 5 lượt gần nhất.
- Lịch sử: date-range chips [Hôm nay|7 ngày|30 ngày] + search mã/biển → list rows (mã mono + biển + khu + tiền mono + time 12) + footer sticky "Tổng: X lượt · Y ₫".
- Empty xe: illustration-free + "Bạn chưa có xe nào — xe do quầy nhập đúng SĐT {phone} sẽ tự hiện." + nút "Xem Sơ đồ".

### 2.4 Vé (`/passes`) — P3 xếp dọc

- Section A cards vé (mã mono + biển + khu + hiệu lực + badge gồm Chờ xác nhận Warning) + nút context (Hủy/Gia hạn/Đăng ký lại).
- Section B form đăng ký: Biển số combobox (từ Xe tôi + nhập mới) → Khu select → Gói radio cards DỌC (4 options, mỗi row: tên gói + giá mono + "-10%" tag cho 12 tháng) → Ghi chú → giá preview sticky trên CTA → CTA "Gửi đăng ký" 48dp + helper "Trả tiền tại quầy khi nhận vé."
- Sau submit: card pending lên đầu + info banner "Mang {tiền} ra quầy để kích hoạt."

### 2.5 Cá nhân (`/profile`) — P1 một cột

- Card 1 Thông tin: SĐT read-only mono + badge + Họ tên editable + nút Lưu 48dp. Card 2 Đổi MK: 3 fields + show/hide `aria-pressed` + nút Đổi. Thêm: toggle Tương phản cao + Đăng xuất (Danger outline) + version 12/Text-60.
- Dirty-guard rời tab: confirm bottom sheet "Bỏ thay đổi? [Ở lại | Bỏ]".

## 3. Màn staff (touch-first, làm nhanh tại cổng)

### 3.1 Check-in (`/staff/checkin`)

- Layout 1 cột scroll: segmented [Check-in|Thu phí] top (deep-link 2 tabs nhưng giữ segmented để chuyển nhanh 1 tay) → Biển số field 56dp (mono 18, uppercase auto, helper "VD 51H-12345", duplicate guard link "Chuyển sang Thu phí") → Khu dropdown (suffix "còn X", full → disabled + Danger tag) → Loại vé radio [Vé lượt|Vé tháng] (vé tháng reveal Mã vé + lookup result inline) → Mã đặt chỗ optional (hiện chỉ khi `permissions.reservation=1`, lookup + consume) → Ghi chú 2 dòng → CTA "Check-in" primary 52dp full-width sticky bottom (trên keyboard, `SafeArea`).
- Sau thành công: success sheet (ticket mono + giờ vào + ô `A-12` lớn 24 + nút [In vé] [Check-in tiếp]) + haptic nhẹ (`HapticFeedback.lightImpact`).
- Offline: Warning banner sticky "Mất mạng — lưu本地, sẽ đồng bộ (n)" + queue count; CTA vẫn bấm được (lưu local, §7).

### 3.2 Thu phí (`/staff/checkout`)

- Search ticket/biển số (autofocus khi từ Check-in chuyển sang, scan-mode: `TextInputAction.search`) → kết quả card (biển mono 20 + khu + vào mono + elapsed live tick 60s) → fee breakdown list (giờ×đơn giá + cap ngày + giảm giá field + total 24 mono) → phương thức radio [Tiền mặt|Chuyển khoản] → CTA "Thu {tiền} & Cho ra" 52dp (disabled tới khi hợp lệ + `aria-disabled` reason tooltip).
- Giảm giá: number field + lý do (bắt buộc nếu >0, max theo policy).
- Vé tháng còn hiệu lực → total 0₫ + badge "Vé tháng" Success + CTA thành "Cho ra (vé tháng)".
- Sau thu: receipt sheet (dashed separator, mono amounts, nút In + Đóng) + toast Success.

### 3.3 Chấm công (`/staff/attendance`)

- Card ca hiện tại: shift name 18/semibold + giờ ca mono + work_date (lưu ý ca đêm: work_date = ngày bắt đầu ca, api-contract §14) + status badge (Chưa vào/Đang trực/Đã chốt).
- Chưa vào → field Tiền đầu ca (prefill từ closing ca trước) + nút "Vào ca" 52dp. Đang trực → elapsed + nút "Ra ca" mở sheet (Tiền cuối ca + Ghi chú bàn giao + preview đối soát "khớp/lệch ±X₫" Warning nếu lệch) → confirm. Đã chốt → summary + badge (có "Chốt bù" nếu muộn).
- List 7 ngày gần nhất (rows: date + ca + vào/ra mono + status badge). Banner "Quên chốt hôm qua" nếu `check_out_at IS NULL` + nút chốt bù.
- UNIQUE(user,shift,date) trùng → inline "Đã chấm ca này." (map `ALREADY_CHECKED_IN`).

### 3.4 Tôi (`/staff/me`)

- Avatar + tên + role badge + SĐT/địa chỉ editable (S1.4, `profile_self` guard) + Lịch sử ca mình (reuse attendance:list mine-only) + Đăng xuất + version + nút "Đồng bộ ngay" (queue count).

## 4. Touch / Layout / A11y mobile (bắt buộc cho @frontend Flutter)

- **Touch target ≥48dp** mọi CTA/icon-button/chip/select (check-in CTA 52dp, tab 64dp incl. safe-area). Khoảng cách giữa 2 target kề nhau ≥8dp.
- **Type scale mobile:** AppBar 18/semibold, card title 16/semibold, body 14, helper 12, số/mã/tiền mono (JetBrains Mono, tabular). Dòng body ≤40 ký tự (màn hẹp).
- **Spacing:** screen padding 16, card padding 16, gap sections 24, gap fields 12 (map từ scale 4/8/12/16/24/32 — không phát minh).
- **Bottom sheets** thay dialogs desktop: `showModalBottomSheet` (drag handle, `isScrollControlled`, max-height 90%, Esc/back đóng, focus vào title khi mở, trả focus về trigger khi đóng). Confirm hủy/xóa vẫn 2 nút [Hủy/Danger] như desktop §Cross-screen-3.
- **Keyboard & nhập liệu:** biển số `textCapitalization.characters`, autocomplete off; SĐT `keyboardType.phone`; tiền `keyboardType.number`; date/time dùng native picker + fallback text `dd/mm/yyyy`; `/` không áp dụng mobile — thay bằng search autofocus + barcode/scan slot (P2, camera scan biển số).
- **SR (TalkBack/VoiceOver):** mọi icon-button có `tooltip`/`semanticLabel`; badge luôn có text (không màu-only); grid map dùng `Semantics(label: "A1-023: trống")`; countdown `liveRegion: false` + text tĩnh "Hết hạn lúc HH:mm"; fee total `liveRegion: true` debounce 1s; toast `SnackBar` + `announce`.
- **Contrast:** body Text `#111827` on Surface 16.7:1; white on Primary 4.6:1 (chỉ bold ≥14); badge text dùng bản darkened trên tint ≥4.5:1 (Success `#15803D`, Warning `#92400E`).
- **Zoom/text-scale:** chịu `textScaleFactor` tới 1.3 không tràn (cards wrap, grid cell co giãn); test 200% desktop tương đương text-scale lớn + landscape.
- **Motion:** 150–250ms ease-out; list stagger nhẹ (≤6 items); tôn `prefers-reduced-motion`/`disableAnimations` → instant; không animate layout properties.
- **Safe-area:** tab bar + sticky CTA bọc `SafeArea`; tránh notch/gesture bar; landscape: form max-width 640 center.

## 5. Trạng thái chung (mọi màn)

| State | Pattern mobile |
|---|---|
| Loading | Skeleton cards preserving layout + `aria-busy`; CTA spinner + "Đang…" |
| Empty | Title 16/semibold + mô tả 14 + CTA chính (không illustration nặng; onboard tone như customer-area P2.4) |
| Error | Danger banner full-width trên content + "Thử lại" 48dp, focus vào banner; FORBIDDEN → "Đăng nhập lại" |
| Offline | Warning strip sticky dưới AppBar + queue count + nút "Đồng bộ ngay"; giao dịch staff vẫn cho lưu local (đánh `pending_sync=1`) |
| Success | `SnackBar` 4s `role=status` (max 3 queue) + haptic nhẹ cho thu phí/check-in |

## 6. Contract dữ liệu cho Flutter (tái dùng entities api-contract, local-first)

- **Entities Dart = map 1-1 từ api-contract §1–§14** (giữ nguyên tên field snake_case ở DB, camelCase ở model + `fromJson/toJson` thủ công, KHÔNG đổi nghĩa): `Role, User/UserDTO/StaffSelfProfile/StaffPermissions (+STAFF_DEFAULTS), ParkingZone, ParkingSpot, Vehicle, MonthlyPass (status gồm 'pending' — migration-003), ParkingSession (+CheckInInput/CheckOutInput), Payment, ZoneAvailability, RevenueDaily, SessionsDaily, SpotMapCell, Reservation (+CustomerReserveInput/Output), Shift, Attendance, ParkingSettings (file local, không DB), TxRow/TxList* (P2 admin — mobile không gọi V1).**
- **Quy ước V1:** datetime ISO8601 UTC string, tiền int VND, bool SQLite 0/1, biển số UPPERCASE-trim, SĐT `0\d{9}`, `username=SĐT` cho customer, mine-only resolve `me.phone/me.id` ở repository layer (không tin client).
- **Local store (sqflite/drift, mirror schema SQLite desktop):** tables `users, parking_zones, parking_spots, vehicles, monthly_passes, parking_sessions, payments, reservations, shifts, attendance` + cột phụ `pending_sync INTEGER DEFAULT 0` ở sessions/payments/reservations/attendance (KHÔNG sync ngược lên desktop ở V1 — chỉ để hàng đợi + đối soát sau; KHÔNG thêm cột nghiệp vụ mới).
- **Seed/config local:** shifts seed MORNING 06–14 / AFTERNOON 14–22 / NIGHT 22–06(+1); `ParkingSettings.fee_grace_minutes=30`, `fee_day_threshold_hours=12` lưu SharedPreferences/file local (đọc cùng hằng số khi preview phí — công thức §8: ≤30p→1h, ≥12h→giá ngày, vé tháng→0).
- **Sync sau (P2, không làm V1 nhưng giữ chỗ):** repository interface `SyncQueue {pendingCount(), pushNow()}` + `lastSyncAt` per-table; conflict rule chốt trước: **server/desktop thắng cho giá/zone, client thắng cho giao dịch trong hàng đợi** (append-only payments không merge field). Mọi DAO viết qua 1 `DbProvider` duy nhất (tránh 2 nguồn sự thật).
- **Quyền:** `resolvePerm(user,key)` copy từ §11 (`?? 1`, admin bypass); UI ẩn tab/field theo flag + repository re-check trước khi ghi local.

## 7. Offline-first (V1 không server)

1. Đọc luôn từ SQLite local (Sơ đồ từ `v_zone_availability` + `v_spot_map` snapshot lúc mở app; không chờ mạng).
2. Ghi staff (check-in/out, thu, attendance) → transaction local + `pending_sync=1` + toast "Đã lưu — sẽ đồng bộ".
3. Poll/refresh chỉ refresh snapshot local (30s map, 60s reservations) — không coi là "fetch server".
4. Banner offline dựa trên `connectivity_plus` + lần đọc snapshot thành công cuối ("Cập nhật Xs trước").
5. Không chặn CTA vì offline trừ Đặt chỗ mới khi zone snapshot cũ >5 phút (Warning "Dữ liệu chỗ đã cũ — kéo để làm mới").

## 8. Handoff cho @frontend Flutter (đọc file, không hỏi lại)

- Vào: `DESIGN.md` (tokens), `api-contract.md` (§1–§14 entities), `./specs/customer-area.md` (P1–P4 validation/copy), `./specs/parking-app.md` (§d/§e/§g fee + states).
- Ra (Flutter): `lib/models/*` (map §6), `lib/db/*` (drift schema + DAO + seed shifts), `lib/repos/*` (mine-only + permissions + SyncQueue stub), `lib/screens/{guest,customer,staff}/*` (§2–§3), `lib/widgets/{bottom_tabs,plates,money,badges,sheets}*` (tokens §0). Mỗi màn demo loading/error/empty + keyboard/SR pass + text-scale 1.3.
- Cấm: thêm màu ngoài tokens, target <48dp, table ngang bắt scroll ở mobile (dùng cards), thanh toán online V1, admin mobile V1.

## Verification

- [x] Nav đủ 2 vai trò V1 (khách 5 tabs + guest 1 màn; staff 4 tabs) + admin P2 chặn rõ
- [x] Màn chính theo vai trò: khách Sơ đồ/Đặt chỗ/Xe/Vé/Cá nhân; staff Check-in/Thu/Chấm công/Tôi
- [x] Mobile-first 360–430px: 1 cột, cards thay table, bottom sheet thay dialog, grid 4 cột
- [x] Touch ≥48dp + safe-area + native pickers + haptic + text-scale
- [x] Offline-first: local SQLite mirror + pending_sync + snapshot poll + banner (chưa cần server)
- [x] Tokens DESIGN.md tái dùng 100%, không màu mới; status mapping §10 giữ nguyên
- [x] Contract Flutter: entities 1-1 api-contract, Drift tables + SyncQueue stub P2, mine-only + permissions
- [x] States/a11y mobile: skeleton/banner/snackbar, SR labels, live-region, contrast darkened, reduced-motion
- [x] Phân biệt V1/P2 (bảng §0 + cấm online-pay/admin-mobile V1)

**Status: verified** — đủ nav/màn chính/touch/offline/a11y, phân biệt V1/P2, không code, không sửa spec desktop.
