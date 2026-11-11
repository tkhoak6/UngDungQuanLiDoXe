# Vé QR + Quét biển số (ANPR) — Design Spec (DS-013)

> Spec only — KHÔNG code. Đọc cùng `DESIGN.md` (tokens), `./specs/mobile-app.md` (staff check-in/check-out §3, touch/a11y §4, offline §7), `./specs/customer-area.md` (P2 xe/P4 đặt chỗ — vé gắn biển số), `api-contract.md` (ticket_code §8, license_plate §6).
> Tokens: Primary `#1677FF`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI) + JetBrains Mono (mã QR / biển số / timestamp). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Motion 150–250ms + reduced-motion → instant.

## 0. Quyết định pha (V1 làm gì trước)

| Pha | Nội dung | Lý do thứ tự |
|---|---|---|
| **V1a — Vé QR (làm trước)** | Sinh QR lúc check-in + staff quét QR lúc check-out + khách xem vé QR | Ít phụ thuộc phần cứng; QR chạy tốt ngay cả camera yếu / máy staff cấu hình thấp; giá trị ngay (bỏ gõ tay biển số lúc check-out, chống vé giả) |
| **V1b — ANPR hỗ trợ nhập (làm sau)** | Camera + ML Kit on-device tự điền biển số vào ô check-in + ô đăng ký vé (P3) | Phụ thuộc camera + ánh sáng + góc chụp; là "tăng tốc nhập liệu", không phải luồng bắt buộc; cần tuning regex biển VN + test thực địa |

- Không chặn V1a chờ V1b. Mọi màn có ANPR **luôn giữ nhập tay** làm fallback chính.
- Admin mobile: không làm (theo mobile-app §0 — admin dùng desktop).

## 1. Vé QR thay giấy

### 1.1 Luồng UX

**A. Staff check-in → sinh vé (không đổi thao tác, thêm output):**
1. Staff nhập biển số (tay hoặc ANPR V1b) + khu + loại vé → bấm "Check-in" 52dp như hiện tại (mobile-app §3.1).
2. Success sheet hiện tại **thêm QR vé**: QR 200×200dp trên nền trắng padding 16 (tương phản scan tốt ngoài nắng) + `ticket_code` mono 16 + biển số mono 20 + ô/khu + giờ vào mono.
3. Nút: [In vé] (nếu có máy in) + [Check-in tiếp]. Khách có app → vé tự hiện trong tab Vé (mục C).

**B. Staff check-out → quét QR (thay gõ biển số):**
1. Màn Thu phí (`/staff/checkout`) thêm segmented hoặc toggle 48dp: [Quét QR | Nhập tay] — default **Quét QR** (vì nhanh hơn).
2. Chế độ Quét: viewfinder full-width (tỷ lệ 4:3, max-height 320dp) + khung ngắm 220×220dp góc bo 12 + hint 14 "Đưa mã QR vào khung" + nút torch (flash) 48dp + nút "Nhập tay" link.
3. Quét trúng → haptic + đóng camera ngay → preview phí như luồng hiện tại (biển mono 20 + khu + vào + elapsed + breakdown + CTA "Thu & Cho ra"). Không hiện thêm màn trung gian.
4. QR lạ/giả/hết hiệu lực → inline Danger banner trên cùng màn (không sheet mới): "Mã không hợp lệ — kiểm tra lại vé." + nút "Nhập tay".

**C. Khách xem vé QR của mình (tab Vé `/passes`):**
1. Section "Vé đang dùng": mỗi session `status='parked'` của mình (từ `customer:sessions`) render card: QR 160×160 + mã vé mono + biển số mono 18 + khu + giờ vào + countdown đỗ (live 60s, `liveRegion: false` + text tĩnh "Vào lúc HH:mm dd/MM").
2. Vé chỉ **hiển thị QR khi đang đỗ**; vé đã check-out → card text-only (không QR để tránh quét nhầm vé cũ).
3. Độ sáng: khi mở QR full-screen (tap card → bottom sheet), set `Brightness` cao tạm thời + nút "Tăng sáng khi quét" toggle (quay lại mức cũ khi đóng). Không cần package ngoài — dùng `screen_brightness` hoặc platform channel (ghi chú cho frontend).
4. Không screenshot-chặn ở V1 (vé gắn HMAC nên chụp màn hình vẫn verify được tính thật; chống dùng lại vé cũ bằng `status` server-side).

### 1.2 Format payload QR + ký HMAC

**Mục tiêu:** QR nhỏ (< 220 ký tự để scan nhanh, ECC level M), đọc được bằng mọi app quét (fallback text), verify offline được trên máy staff.

**Format chốt (versioned, dot-separated, uppercase, QR alphanumeric-friendly):**

```
P1.<ticket_code>.<PLATE_NORM>.<IN_TS>.<SIG>
VD: P1.T-20261111-0001.51H12345.730501.Nz... (base64url 43 ký tự)
```

| Field | Quy tắc |
|---|---|
| `P1` | Version payload (=1). Máy đọc version lạ → từ chối "Mã phiên bản mới — cập nhật app." |
| `ticket_code` | Nguyên văn `T-YYYYMMDD-XXXX` (api-contract §8). |
| `PLATE_NORM` | Biển số đã chuẩn hóa: UPPERCASE, **bỏ `-`/`.`/space** (`51H-123.45` → `51H12345`). Verify so sánh sau chuẩn hóa 2 đầu. |
| `IN_TS` | `check_in_at` dạng **epoch phút** (số phút từ epoch UTC, int) — gọn hơn ISO (~6 ký tự thay vì 19). Frontend/backend cùng hàm `floor(ms/60000)`. |
| `SIG` | `base64url(HMAC-SHA256(key, "P1.<ticket>.<plate>.<ts>"))` — 43 ký tự, **không padding `=`**. |

- Thuật toán: **HMAC-SHA256** (không dùng MD5/SHA1; không tự chế). Message = 3 field đầu join bằng `.` (ASCII). So sánh chữ ký bằng constant-time compare.
- QR encode: plain text (không JSON — JSON tốn ~40% ký tự thừa). Error correction **M**, quiet zone 4 modules.
- Chống giả: giả mạo phải biết key mới ký được SIG hợp lệ. Chống dùng lại: backend check `sessions.status='parked'` + `ticket_code` tồn tại — vé đã check-out (`completed`) quét lại → từ chối "Vé đã sử dụng lúc HH:mm." (không dựa vào QR để biết trạng thái).
- Chống sửa biển: đổi 1 ký tự plate → SIG sai → từ chối.

**Key lưu ở đâu (chốt):**
1. Key sinh 1 lần 256-bit (`crypto.randomBytes(32)`), lưu **server config** — cùng chỗ `ParkingSettings` file local (`app-config.json`, key `qr_hmac_key_b64`), **KHÔNG hardcode trong source, KHÔNG bundle vào app, KHÔNG in trong QR**.
2. Backup/restore `.db` + `app-config.json` phải đi cùng nhau (key mất → mọi QR cũ thành invalid; ghi chú vào deployment).
3. Máy staff verify offline cần key: cấp qua **endpoint xác thực `auth:qr-key` (staff login mới gọi được)** → máy lưu vào **secure storage** (`flutter_secure_storage` → Android Keystore / iOS Keychain), **KHÔNG lưu SharedPreferences plain**. Key rotation: config `qr_key_id` (int) đưa vào payload sau này (`P2.<key_id>...`); V1 giữ `P1` + 1 key, rotation = phát hành app-config mới + grace 7 ngày chấp nhận 2 keys (backend thử key mới trước, cũ sau).
4. P2 cân nhắc chuyển **Ed25519 chữ ký bất đối xứng** (private ở server, public trong app — không còn bí mật cần bảo vệ trên device). V1 HMAC là đủ vì máy staff là thiết bị quản lý.

**API thêm (cho @leader/backend, không làm trong spec này):**
- `tickets:qr-payload {ticket_code} → {qr_text}` — backend ký (frontend KHÔNG tự ký).
- `tickets:verify-qr {qr_text} → {valid, reason?, session?}` — dùng khi online (check status DB luôn).
- `auth:qr-key → {key_b64, key_id}` — staff-only, qua kênh đã đăng nhập.

### 1.3 Verify offline trên máy staff

1. Online (ưu tiên): gọi `tickets:verify-qr` → backend vừa check SIG vừa check `status='parked'` → trả session + fee preview.
2. Offline: máy dùng key trong secure storage tự check SIG (format + version + HMAC) → nếu SIG đúng → hiện preview "chưa đối soát" (Warning strip "Offline — chưa kiểm tra vé đã dùng, sẽ đối soát khi có mạng") + cho phép tiếp tục thu → giao dịch vào hàng `pending_sync` (mobile-app §7). Khi online lại: `tickets:verify-qr` đối soát; vé đã dùng → flag `NEED_REVIEW` cho admin (không tự trừ tiền khách).
3. Không có key trên máy (chưa login lần nào / bị xóa): chế độ quét báo "Chưa có khóa xác thực — đăng nhập khi có mạng 1 lần." + fallback nhập tay `ticket_code`.

### 1.4 States / fallback QR

| Case | UX |
|---|---|
| Camera không mở được / không có quyền | Auto-fallback tab Nhập tay + banner hướng dẫn cấp quyền (§3). Không màn trắng, không crash. |
| QR mờ / ngược sáng / nhăn giấy | Hint "Lau camera, tăng sáng vé khách" + nút torch + nút nhập tay luôn hiện. Timeout 30s không quét được → gợi ý "Nhập mã vé tay" (focus vào field). |
| QR sai format / SIG sai | Danger inline "Mã không hợp lệ — có thể vé giả hoặc chụp nhầm." + giữ camera chạy (cho quét lại) + link nhập tay. Log `qr_reject` local (đếm, không gửi ảnh). |
| Vé đã dùng / đã hủy | Warning inline "Vé {code} đã check-out lúc {HH:mm}." + nút "Xem lịch sử". |
| Vé của khu khác / sai loại | Vẫn cho check-out (vé toàn bãi) nhưng hiện note; không chặn. |
| Mất mạng lúc thu | Như §1.3.2 — offline strip + pending_sync. |

## 2. Quét biển số (ANPR on-device)

### 2.1 Nguyên tắc

- **100% on-device** bằng Google ML Kit Text Recognition (Latin script, v2). **KHÔNG gửi ảnh lên mạng** — ghi rõ trong dialog quyền + màn giới thiệu ("Ảnh chỉ xử lý trên máy").
- ANPR là **gợi ý điền form**, không phải quyết định tự động: mọi kết quả đều qua màn confirm sửa tay trước khi submit.
- Chạy ở 2 chỗ: (1) ô Biển số check-in staff (`/staff/checkin`), (2) ô Biển số đăng ký vé P3 (`/passes` Section B) + combobox xe. Không gắn vào chỗ khác ở V1.

### 2.2 Luồng UX (camera overlay + confirm)

1. Entry: icon camera 48dp (`Icons.directions_car` / `photo_camera`, tooltip "Quét biển số") đặt trong suffix của field Biển số (cả 2 màn trên).
2. Bấm → bottom sheet camera 90% height (không full-screen để giữ context form): viewfinder + **khung overlay tỷ lệ biển VN** (hình chữ nhật ngang ~3:1, viền Primary 2dp, góc bo 8) + hint 14 "Đặt biển số vào khung" + nút [Chụp] 56dp bottom-center + nút đóng + toggle torch.
3. Chụp (hoặc auto-capture khi ML Kit confidence cao — V1 **chỉ chụp thủ công** để tránh chụp nhầm; auto để P2):
   - Frame → `google_mlkit_text_recognition.processImage` → lấy `recognizedText` → chạy **normalize + regex VN** (§2.3) → trích ứng viên biển số.
   - Có 1 ứng viên rõ → đóng camera → điền vào field (uppercase) + toast Success "Đã điền {plate} — kiểm tra lại." + focus vào field để user sửa ngay.
   - Nhiều ứng viên (2+ match) → sheet chọn (radio list, mỗi dòng mono 18 + confidence) → chọn → điền như trên.
   - Không match → ở lại camera + Warning inline "Chưa đọc được — thử gần hơn / đủ sáng." + nút "Nhập tay" (đóng camera, focus field).
4. Sau điền: field hiển thị như nhập tay (validate pattern VN hiện có customer-area P3.3). User **bắt buộc nhìn lại** (helper "Kiểm tra lại biển số trước khi tiếp tục."). Submit như luồng thường.
5. Ảnh chụp: **xóa ngay sau khi nhận diện** (không lưu gallery, không cache file quá phiên; nếu phải ghi file tạm cho ML Kit thì xóa trong `finally`). Không log ảnh.

### 2.3 Normalize + regex biển VN (cho frontend)

```
normalize(raw):
  uppercase → bỏ mọi ký tự ngoài [A-Z0-9] → vd "51H 123.45" → "51H12345"
match VN (sau normalize):
  ^(\d{2}[A-Z]{1,2})(\d{4,6})$   // 51H12345, 51H123456, 29AB12345 (biển dài mới 2 chữ)
  độ dài tổng 7–10 ký tự; không match → loại
hiển thị lại cho user: chèn "-" sau ký tự chữ: "51H-12345" (display-only, DB vẫn UPPERCASE như cũ)
```

- OCR hay nhầm: `0↔O/D`, `1↔I/L`, `8↔B`, `5↔S`, `2↔Z`. V1: **không tự sửa** (giữ nguyên để user sửa tay, tránh "sửa sai thành sai khác"); chỉ gợi ý dưới field khi pattern gần đúng: "Ý bạn là {gợi ý}?" (1 tap để áp dụng). Tự sửa fuzzy để P2.
- Confidence: ML Kit `TextBlock.confidence` nếu có; dưới ngưỡng → coi như không match (đi nhánh "Chưa đọc được").

### 2.4 Hiệu năng / pin / máy yếu

- Chỉ khởi tạo recognizer khi mở sheet camera, **close ngay khi đóng** (`textRecognizer.close()`).
- Xử lý 1 frame/lần chụp (không stream realtime ở V1 — tiết kiệm pin + chạy được máy RAM 3GB).
- Timeout xử lý 8s → "Xử lý quá lâu — thử chụp lại." + giữ camera.

## 3. Quyền camera Android + thông báo giải thích

| Mục | Spec |
|---|---|
| Manifest | `android.permission.CAMERA` (required). Không cần location/storage cho tính năng này. `ML Kit` bundle Latin model trong app (không download runtime → không cần `INTERNET` thêm cho ANPR). |
| iOS (ghi sẵn cho P2) | `NSCameraUsageDescription` text Việt (dưới). |
| Runtime flow | Lần đầu bấm quét → **dialog giải thích trước** (do app tự hiện, trước system dialog): title "Cho phép camera?" + body "Để quét mã QR lúc thu phí và đọc biển số. Ảnh biển số chỉ xử lý trên máy, không tải lên mạng." + [Tiếp tục | Để sau]. Bấm Tiếp tục → system request. |
| Từ chối 1 lần | Fallback nhập tay + lần sau bấm quét hiện lại dialog giải thích (ngắn). |
| Từ chối vĩnh viễn ("Don't ask again") | Banner/link "Đã chặn camera — mở Cài đặt để bật." + nút [Mở Cài đặt] (deep-link `app-settings:`). Không loop xin quyền. |
| Copy Việt chốt | Rationale: như trên. Permanently-denied: "Camera đang tắt nên không quét được. Bạn vẫn nhập tay bình thường — hoặc bật camera trong Cài đặt." |
| TalkBack | Mọi nút camera/torch/đóng có `semanticLabel` tiếng Việt; viewfinder `Semantics(label: "Khung quét", image: true)` + `excludeSemantics` cho overlay trang trí. |
| Package | `permission_handler` (check/request/openAppSettings统一 2 platform). |

## 4. Offline behavior (tổng hợp 2 tính năng)

| Tính năng | Offline |
|---|---|
| Hiện QR (khách) | QR đã sinh ở check-in lưu local cùng session → hiện được offline. Không cần mạng để "vẽ" QR (qr_flutter render từ `qr_text` đã lưu). |
| Quét QR + verify (staff) | Verify SIG offline bằng key trong secure storage (§1.3.2); check `status` thì đợi online. Thu phí offline → `pending_sync=1` như mobile-app §7. |
| ANPR | Chạy offline 100% (model on-device). Không banner mạng. |
| Lấy `qr-key` lần đầu | Cần mạng 1 lần (sau login). Chưa có key → quét vẫn mở được nhưng chỉ "đọc mã", verify ghi "chưa xác thực". |

## 5. Layout / states / a11y chi tiết (cho @frontend Flutter)

- **Kích thước scan:** QR hiển thị ≥160dp (card) / 200dp (sheet check-in success); module đen trên trắng tinh (không tint, không logo chèn giữa QR ở V1 — logo làm hỏng ECC). Tương phản 21:1.
- **Touch:** mọi nút camera/torch/đóng/copy ≥48dp, cách nhau ≥8dp (mobile-app §4). CTA thu phí giữ 52dp.
- **Type:** mã/timestamp/biển/tiền mono (JetBrains Mono); hint 12; title 16/semibold; QR sheet title focus khi mở (SR), đóng trả focus về trigger.
- **Bottom sheets** thay dialogs (drag handle, max 90%, back/Esc đóng) — camera sheet + QR full-screen + chọn ứng viên ANPR đều là sheet.
- **Live-regions:** countdown "Hết hạn sau" `liveRegion: false`; fee total `liveRegion: true` debounce 1s; toast max 3 queue 4s.
- **Reduced-motion:** crossfade camera open 200ms → instant khi `disableAnimations`.
- **Text-scale 1.3:** QR co giãn nhưng giữ min 120dp; field biển số wrap không tràn; camera hint ellipsize 2 dòng.
- **Dark-mode/outdoor:** QR luôn nền trắng (kể cả dark-mode) để scan được; toggle tương phản cao dày viền khung quét 3dp.

## 6. Packages Flutter (chốt + lý do)

| Package | Dùng cho | Vì sao chọn |
|---|---|---|
| `mobile_scanner` | Quét QR check-out (viewfinder + torch + gọi MLKit barcode) | Được maintain tích cực nhất 2024–26, hỗ trợ MLKit tích hợp, auto-focus/torch API gọn; thay `qr_code_scanner` (đã ngừng phát triển, lỗi Android 14+). |
| `qr_flutter` | Vẽ QR (success sheet staff + vé khách) | Render offline từ string, custom size/error-correction được, không cần mạng. |
| `google_mlkit_text_recognition` | ANPR on-device (Latin model) | On-device đúng yêu cầu "không gửi ảnh"; bundle model theo app nên offline; thay gọi API cloud OCR (tốn tiền + lộ ảnh). |
| `permission_handler` | Quyền camera + mở Settings | Chuẩn 2 platform, xử lý permanently-denied gọn. |
| `flutter_secure_storage` | Lưu `qr_hmac_key` trên device | Keystore/Keychain thay vì plain prefs (bắt buộc §1.2). |
| `screen_brightness` (optional) | Tăng sáng khi hiện QR khách | UX quét nhanh dưới nắng; fallback thủ công nếu plugin lỗi — không chặn V1. |

- Không thêm: `camera` trực tiếp (mobile_scanner đã bọc), `google_mlkit_barcode_scanning` riêng (mobile_scanner đủ cho QR), bất kỳ SDK OCR cloud nào.
- Version pin + `flutter analyze` sạch là việc của frontend lúc implement.

## 7. Không thuộc V1 (ghi rõ để khỏi scope-creep)

- Auto-capture ANPR realtime, fuzzy-correct OCR, đọc biển xe máy cũ mờ nát chuyên sâu.
- Ed25519 thay HMAC, QR có logo, vé NFC, cổng barrier tự động.
- Thanh toán online trong QR (QR chỉ là mã vé, không phải VietQR).

## Verification

- [x] Luồng UX 3 bên: staff quét QR check-out (§1.1B), khách xem vé (§1.1C), camera overlay + confirm ANPR (§2.2)
- [x] Format payload QR + HMAC-SHA256 + key ở server config/secure storage, không hardcode (§1.2)
- [x] Verify offline + pending_sync đối soát sau (§1.3, §4)
- [x] Fallback camera/scan fail từng case (§1.4, §2.2.4)
- [x] Quyền camera Android + copy giải thích + permanently-denied (§3)
- [x] States/a11y mobile (touch ≥48dp, sheets, live-regions, mono, tương phản QR) (§5)
- [x] Pha V1a QR trước → V1b ANPR sau + lý do (§0)
- [x] Packages Flutter + lý do loại trừ (§6)

**Status: verified** — đủ UX/format/fallback/quyền/offline/pha cho @leader giao @frontend Flutter + @node-developer (3 IPC + key config).
