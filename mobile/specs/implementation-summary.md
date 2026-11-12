# MO-014 — ANPR quét biển số V1b (nối DS spec qr-anpr + MO-009)

## Quyết định (đọc `./specs/qr-anpr.md` §2 trước khi code)
- **100% on-device** ML Kit Text Recognition (Latin): chụp thủ công 1
  frame/lần (không stream realtime — pin + RAM 3GB), timeout 8s, ảnh tạm
  xóa trong `finally`, không gửi mạng, không log ảnh.
- V1 **KHÔNG tự sửa OCR** (tránh "sửa sai thành sai khác"): chỉ gợi ý
  fuzzy 1 ký tự ("Ý bạn là …?" 1-tap). Mọi kết quả qua màn confirm/sửa
  tay trước khi điền form; luôn giữ nhập tay làm fallback chính.
- Dùng `camera` (viewfinder + overlay 3:1 + torch + nút Chụp 56dp) thay
  vì `image_picker` (không custom overlay/torch được). `mobile_scanner`
  chỉ bọc QR — không tái dùng cho ANPR (nó không cho frame tĩnh).
- Không có `ios/` trong repo → copy NS Camera text ghi sẵn trong spec §3,
  P2 bổ sung khi mở build iOS.

## File đã tạo/sửa (chỉ `mobile/`, không đụng desktop/Electron)
| File | Thay đổi |
|---|---|
| `pubspec.yaml` | + `camera` 0.12.2, `google_mlkit_text_recognition` 1.0.2 (`flutter pub add`; dùng lại `permission_handler` đã có) |
| `lib/core/anpr.dart` (mới, pure) | `normalize` (UPPER + chỉ [A-Z0-9]), `vnPlate` (`^(\d{2}[A-Z]{1,2})(\d{4,6})$`, 7–10 ký tự), `parse`, `display` (chèn "-" sau cụm chữ, DB vẫn UPPERCASE), `extractCandidates` (match theo dòng → token → ghép cụm 2–4 token kề, giữ thứ tự, khử trùng — chịu được OCR tách "51h-123.45" thành 4 mảnh), `suggest` (fuzzy 1-edit 0↔O/D, 1↔I/L, 8↔B, 5↔S, 2↔Z; đã hợp lệ → null) |
| `lib/data/anpr_recognizer.dart` (mới) | Interface `AnprRecognizer` (`recognize`/`close`) + `MlKitAnprRecognizer` (Latin, `InputImage.fromFilePath`) — tách để test mock không cần camera/model |
| `lib/screens/anpr_sheet.dart` (mới) | `openAnprSheet()` → bottom sheet 90%: rationale Việt → system prompt → viewfinder 280 + overlay 3:1 (Primary 2dp, bo 8) + Chụp 56dp + torch/đóng 48dp + "Nhập tay". Chụp → ML Kit (8s) → 0 ứng viên: warning inline ở lại camera; 1: màn confirm (TextField sửa + gợi ý fuzzy live + "Điền vào form"); nhiều: radio list mono 18 + "Điền". Recognizer init khi mở sheet, `close()` + camera dispose khi đóng; từ chối 1 lần → đóng sheet (về nhập tay); vĩnh viễn → "Mở Cài đặt"; kIsWeb → text-only + nhập tay. Copy Việt + semanticLabel theo spec §3/§5 |
| `lib/widgets/plate_field.dart` (mới) | `PlateField`: TextField mono 18 + suffix camera 48dp + helper "Kiểm tra lại biển số…" sau quét + gợi ý fuzzy live (hoãn post-frame để không setState giữa build — an toàn với prefill trong FutureBuilder, giữ focus như MO-013). Quét xong: điền display-form + toast "Đã điền … — kiểm tra lại." + focus field. Hủy/lỗi → null, giữ nhập tay |
| `lib/screens/staff_ops.dart` | Ô biển số check-in → `PlateField` (giữ helper cũ + `next`) |
| `lib/screens/customer_main.dart` | Đặt chỗ: mode 1 xe → `PlateField`; mode dropdown (>1 xe) → thêm nút "Quét biển số" 48dp (`_scanIntoPlates`: khớp xe có sẵn thì chọn, biển lạ → custom + điền) |
| `lib/screens/customer_more.dart` | Đăng ký vé P3 Section B → `PlateField` |
| `test/anpr_mo014_test.dart` (mới, 18 tests) | normalize/parse-valid/sai/display/extract (đơn, tách token, đa biển, rỗng, thường+gạch, vụn 4 token)/suggest (hợp lệ→null, S→5, B→8, sai >1→null)/mock recognizer 2 tests |

## Luồng ANPR (theo hợp đồng)
- Bấm camera cạnh ô biển số → rationale → viewfinder + Chụp → on-device
  → confirm/sửa (gợi ý fuzzy, không tự sửa) → điền form + toast + focus.
  Từ chối/quá timeout/fail → về nhập tay, không kẹt.
- Offline 100% (model bundle theo app). Không key, không mạng, không
  thay đổi submit/validate hiện có (`Validators.plate` vẫn chốt ở submit).

## Verification (11/11/2026, Flutter 3.47.9, `D:\flutter\bin\flutter.bat`)
- `flutter analyze` → No issues found!
- `flutter test` → All tests passed! (69 tests: 51 cũ + 18 mới MO-014)
- grep `print(|debugPrint(` trong `lib/` → 0 match
- KHÔNG chạy app, KHÔNG đụng desktop/Electron (theo contract).
- Test thiết bị thật: **PENDING user** (camera + ML Kit cần device thật;
  widget/unit đã pass trên VM).

---

# MO-012 — Đặt nhanh 1 chạm + 24/24 mobile (nối BE-019 + FE-023)

## Quyết định (đọc spec trước khi code)
- Desktop `MyReservationsPage.tsx` (FE-023) vẫn kẹp khung 06:00–22:00
  (`OPEN_MIN/CLOSE_MIN`, `quickTooLate`, note "Đã rút còn…", "quay lại sáng
  mai"); mobile theo hợp đồng MO-012 **bỏ toàn bộ**: KHÔNG clamp/khóa theo
  giờ, KHÔNG chữ 06:00–22:00, chạy 24/24 như BE-019.
- Quy tắc BE-019 áp nguyên: `end <= start` = qua đêm (+24h), duration
  15p–4h, hết hạn = **giờ kết thúc + 20p** (datetime đầy đủ, tràn ngày —
  VD 23:00→01:00 hết hạn 01:20 hôm sau), `date` = ngày bắt đầu (= today),
  quá khứ >15p mới lỗi, quota 2 pending|active/ngày giữ nguyên.
- DB local (`app_db.dart` bảng `reservations`) KHÔNG có CHECK khung giờ
  nên INSERT qua đêm / 15–59p chạy ngay, không chờ migration-008
  (migration-008 chỉ cần cho SQLite desktop).

## File đã tạo/sửa (chỉ `mobile/`, không đụng desktop/Electron, không chạy app)
| File | Thay đổi |
|---|---|
| `lib/core/validators.dart` | `slot()`: XÓA check `fromMin < 6:00` / `toMin > 22:00`; `toMin == fromMin` → "Giờ kết thúc phải sau giờ bắt đầu."; duration qua đêm (+24h khi `end <= start`) 15p–4h → "Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ."; quá khứ >15p → "Giờ bắt đầu đã qua — vui lòng chọn khung giờ khác." (giữ check cùng ngày) |
| `lib/core/reservations.dart` (mới, pure) | `isOvernight`, `reservationDurationMin` (qua đêm +24h), `hhmm` (vòng 24h), `fmtDur`, `startEndOf` (end qua đêm +1 ngày), `stampOf` ('YYYY-MM-DD HH:MM:SS'), `minutesToExpiry` (countdown từ `expires_at`, null khi parse lỗi) |
| `lib/repos/customer_repo.dart` | `createReservation` + param `plate` (normalize + validate, lưu vào `license_plate` — cũ ghi `''` nên check-in không đối soát được); end qua đêm qua `startEndOf`; **`expires_at` = giờ kết thúc + 20p** (cũ `now+20p` sai khi quick đặt dài/quá đêm); message hết chỗ → "Khu vừa hết chỗ giữ — chọn khu khác." (Warning tone như spec); quota/sweep/capacity giữ nguyên |
| `lib/screens/customer_main.dart` | Viết lại `ReservationsScreen`: mode mặc định **đặt nhanh** (`_quick=true`) — Khu (dropdown availability, còn chỗ, disable khu hết) + Biển số (prefill xe đầu tiên từ `myVehicles`; >1 xe → dropdown + "Biển số khác…") + chips 1/2/3/4h (default 2h) + dòng "Bắt đầu: ngay bây giờ (HH:MM) → kết thúc dự kiến HH:MM (X giờ)" (+ "· qua đêm") + nút **"Giữ chỗ ngay"** (start = now chốt lúc bấm, KHÔNG ô nhập giờ, KHÔNG disable theo giờ). Link **"Chỉnh giờ chi tiết"** ↔ "Về đặt nhanh"; form tay Từ/Đến (`showTimePicker` mọi giờ, qua đêm được, dòng "X giờ · qua đêm (sang hôm sau)" / cảnh báo "mỗi lượt 15 phút–4 giờ"). List "Giữ chỗ của tôi": badge Giữ chỗ/Sắp hết (≤15p)/Đã nhận/Xong/Hết hạn + countdown "Hết hạn sau Np · Hết hạn lúc HH:MM" (quá hạn → "Đã quá giờ hẹn — hệ thống sẽ tự hủy") tick 30s + poll 60s + Copy mã + Hủy (dialog xác nhận) + "Đặt lại" (nạp giờ vé cũ vào form tay). Success sheet: mã mono + "(qua đêm)" + hết hạn đầy đủ + Copy mã. Quota ≥2 → dòng cảnh báo + repo chặn chốt. XÓA toàn bộ chuỗi 06:00–22:00/clamp/`quickTooLate` |
| `test/validators_test.dart` | Slot test viết lại theo BE-019 (15p ok, <15p chặn, qua đêm 23:00→01:00 ok, 21:00→23:00 ok, start==end chặn, quá khứ >15p chặn / ≤15p cho qua) |
| `test/reservations_mo012_test.dart` (mới, 5 tests) | Duration cùng ngày/qua đêm, hhmm vòng 24h, fmtDur, startEndOf + expires tràn ngày (01:20 hôm sau), minutesToExpiry countdown/âm/null |

## Hành vi qua đêm (theo hợp đồng)
- 23:30 đặt nhanh 2h → start 23:30 hôm nay, end 01:30 **hôm sau**, hết hạn
  01:50 hôm sau; card hiện "23:30–01:30" + countdown đếm từ `expires_at`
  (không kẹt ở `end_time` cùng ngày như BE cũ); sweep `pending →
  expired` đúng cả qua đêm (so `expires_at < datetime('now')`).
- Đêm nào cũng đặt được — không còn "bãi sắp đóng cửa, quay lại sáng mai".

## Verification (11/11/2026, Flutter 3.47.9, `D:\flutter\bin\flutter.bat`)
- `flutter analyze` → No issues found!
- `flutter test` → All tests passed! (44 tests: 39 cũ + 5 mới MO-012)
- grep `print(|debugPrint(` trong `lib/` → 0 match
- KHÔNG chạy app (theo contract). KHÔNG đụng desktop/Electron.

---

# MO-010 — Sửa đăng ký offline-first (implementation summary)

## Triệu chứng (user báo, nối MO-003)
- Mở màn Đăng ký → banner đỏ "Không kết nối được máy chủ. Thử lại sau."
  chặn ngay từ đầu dù nhập đủ SĐT/họ tên/mật khẩu. Server PocketBase thật
  đang tạm gác (merge paused) nên rớt mạng/timeout là bình thường.
- Nguyên nhân gốc: `registerCustomer` cũ remote-FIRST — mọi lỗi server
  không phân loại (`_mapClientError` default → PB_ERROR, PHONE_TAKEN +
  login lại fail, timeout…) đều `throw AuthException` ra UI thành banner
  đỏ chặn luồng, dù tài khoản local hoàn toàn tạo được.

## Fix (chỉ `mobile/`, không đụng login/desktop, không chạy app)
| File | Thay đổi |
|---|---|
| `lib/repos/hybrid_auth_repo.dart` | `registerCustomer` local-TRƯỚC: tạo local → `unawaited(_syncNewAccountToServer(...))` → trả `AuthSource.local` ngay. Sync nền best-effort tuyệt đối (catch-all + `dev.log`, không throw): ok → `_mirrorLocal`; `PbOfflineException` → pending; `PHONE_TAKEN` → thử `_remoteLoginAndMirror`; lỗi khác → pending. Thêm param inject `remoteRegister` (default `_defaultRemoteRegister` wrap `pbRegisterCustomer`) chỉ phục vụ test online-fail không cần mạng. Login giữ nguyên (remote-first + fallback local đúng, MO-006). |
| `lib/screens/auth.dart` | Register success: luôn vào app ngay (session set); `AuthSource.local` → note vàng `_PendingSyncNote` (warningTint/border, icon `cloud_off`, không nút Thử lại) + SnackBar "Đã lưu trên máy, sẽ đồng bộ…". Banner đỏ chỉ còn cho lỗi local thật (SĐT trùng trên máy, validation). Import `hybrid_auth_repo.dart` cho `AuthSource`. |
| `test/auth_register_mo010_test.dart` (mới, 5 tests) | `_FakeAuthRepo` in-memory (không chạm sqflite/mạng): offline tạo local + source local; online rớt mạng (`PbOfflineException`) vẫn pass local + sync đã chạy; online `PB_ERROR` vẫn pass local không throw; trùng SĐT trên máy → `PHONE_TAKEN`; SĐT sai → `INVALID_PHONE` trước khi đụng server. |
| Profile (`customer_profile.dart`) | Không đổi — badge "Ngoại tuyến (local)" đã hiện sẵn = chỉ báo pending-sync bền vững trong app. `server_settings.dart` (test kết nối tường minh) giữ banner đỏ là đúng. |

## Hành vi sau sửa
- **Offline**: nhập đủ → tạo tài khoản local → vào app ngay + note vàng "chưa đồng bộ lên máy chủ".
- **Online fail** (server gác/timeout/500): y hệt offline — không banner đỏ, sync nền pending.
- **Online ok**: vào app ngay local-first; sync nền mirror quyền/fullName từ server.
- **Lỗi thật**: SĐT đã có trên máy / sai định dạng / MK yếu → banner đỏ như cũ.

## Verification (11/11/2026, Flutter 3.47.9)
- `flutter analyze` → No issues found!
- `flutter test` → All tests passed! (39 tests: 34 cũ + 5 mới MO-010)
- grep `print(|debugPrint(` trong `lib/` → 0 match (`dev.log` không tính).
- KHÔNG chạy app (theo contract).

---
# MO-009 — QR mobile V1a (implementation summary)

## Quyết định phương án (đọc spec + backend-summary trước khi code)
- Mobile KHÔNG gọi IPC desktop (khác máy). Khách KHÔNG ký QR (key không
  nằm trên máy khách). Ký chỉ xảy ra trên **staff device** lúc check-in
  (thiết bị quản lý, đúng spec §1.2) bằng key trong secure storage.
- `qr_text` **persist vào DB local** (`parking_sessions.qr_text`, v3) lúc
  check-in → khách render QR **offline** bằng qr_flutter (đúng spec §4).
  Không key lúc check-in → `qr_text` NULL → card text-only (mã vé + biển
  số + ghi chú "QR sẽ hiện khi có mạng") — đúng fallback spec §1.4.
- Nguồn key V1a: nhập 1 lần ở màn Tôi → Khóa QR (dán base64 từ quản trị
  viên đọc `auth:qr-key` desktop). P2: fetch qua API khi có link server.

## File đã tạo/sửa (chỉ `mobile/`, không đụng desktop/Electron)
| File | Thay đổi |
|---|---|
| `pubspec.yaml` | + `qr_flutter`, `mobile_scanner`, `permission_handler`, `flutter_secure_storage`, `crypto` (`flutter pub add`) |
| `lib/core/qr_ticket.dart` (mới) | Pure Dart mirror 1-1 `src/main/qr-ticket.ts`: normalize (chỉ giữ [A-Z0-9]), epoch_min (stamp DB coi như UTC), sign HMAC-SHA256 base64url-43, verify format/version/HMAC + constant-time compare, `messageFor` Việt, `isValidKeyB64` |
| `lib/data/qr_key_store.dart` (mới) | Keystore/Keychain wrapper (`qr_hmac_key_b64`, `qr_key_id`), KHÔNG plain prefs |
| `lib/repos/qr_repo.dart` (mới) | `signForSession` (có key→ký+lưu, không key→null, không chặn check-in); `verify` (SIG offline + đối soát DB: NOT_FOUND/PLATE_MISMATCH/ALREADY_USED kèm giờ) |
| `lib/db/app_db.dart` | v2→v3: `ALTER TABLE parking_sessions ADD COLUMN qr_text TEXT` (idempotent); `_create` đã có cột |
| `lib/models/entities.dart` | `SessionRow.qrText?` (optional, không vỡ constructor cũ) |
| `lib/repos/customer_repo.dart` | + `myParkedSessions` (mine-only, status parked — QR vé cũ không bao giờ vẽ) |
| `lib/widgets/qr_views.dart` (mới) | `ParkedTicketCard` (QR 160 nền trắng), `TicketQrSheet` (full-screen 240), `CheckinQrView` (success sheet 200) |
| `lib/screens/qr_scanner_sheet.dart` (mới) | Rationale Việt trước system prompt, permanently-denied → Mở Cài đặt, torch 48dp, timeout 30s gợi ý nhập tay, quét trúng → haptic + đóng camera + trả raw |
| `lib/screens/staff_ops.dart` | Check-in success sheet gắn QR (ký ngay sau insert); Thu phí thêm segmented [Quét QR\|Nhập tay] default quét + nút Quét lại + inline Danger banner |
| `lib/screens/customer_more.dart` | Tab Vé: section "Vé đang dùng" (loading/error/empty đủ states) + tap → bottom sheet QR |
| `lib/screens/customer_profile.dart` | Màn Tôi (staff): card "Khóa QR" — trạng thái + dán/lưu/xóa key (validate 32 bytes) |
| `lib/state/providers.dart` | + `qrKeyStoreProvider`, `qrRepoProvider` |
| `android/.../AndroidManifest.xml` | `CAMERA` permission + `camera` feature `required=false`. Không có `ios/` trong repo → ghi chú P2 (copy §3 đã có sẵn trong spec) |
| `test/qr_ticket_mo009_test.dart` (mới) | 12 tests: vector chéo node:crypto, tamper biển/sig, sai key, version lạ, format/dài, messageFor Việt mọi reason, isValidKeyB64 |

## Luồng offline/online QR mobile (ghi rõ theo hợp đồng)
- **Online hay offline, hiện QR khách**: luôn offline được (qr_text đã lưu local, qr_flutter render, không cần mạng) — đúng spec §4.
- **Quét + verify staff offline**: SIG bằng key trong secure storage; check `status` trong DB local (parked/đã dùng). Thu offline → `pending_sync=1`; online đối soát lại (vé đã dùng → flag NEED_REVIEW — việc của P2 sync, V1 chỉ gắn cờ local).
- **Chưa có key trên máy**: quét mở được nhưng verify trả NO_KEY ("Chưa có khóa xác thực — đăng nhập khi có mạng 1 lần.") + fallback nhập tay.
- **Key provisioning V1a**: thủ công 1 lần (dán base64). KHÔNG bundle key vào app, KHÔNG log key (grep print = 0).

## Verification (11/11/2026, Flutter 3.47.9)
- `flutter analyze` → No issues found!
- `flutter test` → All tests passed! (34 tests: 22 cũ + 12 mới MO-009)
- grep `print(|debugPrint(` trong `lib/` → 0 match
- `flutter build web --release` → √ Built build\web (scanner guarded `kIsWeb` → text-only + nhập tay)
- KHÔNG chạy app (Leader chạy)

---
# MO-006 — Sửa login staff mobile (implementation summary)

## Nguyên nhân gốc (user báo: khoa01/khoa01 desktop OK, mobile web báo "Sai mật khẩu")
1. **2 DB độc lập, user khác nhau**: desktop dùng `D:/DA/data/parking.db`
   (bcrypt, `src/main/auth.ts:158`); mobile web dùng IndexedDB qua
   `sqflite_common_ffi_web` + scheme `demo:<pw>` (`lib/repos/auth_repo.dart:60`).
   Seed mobile (`lib/db/app_db.dart:_seed` cũ) chỉ có admin/staff01/customer —
   **không có `khoa01`** (grep `khoa01` toàn repo code = 0 match: user này được
   tạo runtime trên desktop, chỉ sống trong parking.db). Query local username
   không match → local NOT_FOUND là đúng bản chất.
2. **Nhánh hybrid nuốt lỗi gây hiểu lầm**: PB-first
   (`lib/repos/hybrid_auth_repo.dart:47-54` cũ) — PB gộp "không tồn tại + sai
   MK" thành WRONG_PASSWORD (`lib/data/pb_auth_remote.dart:172-181`); khi
   local cũng lỗi, code cũ rethrow lỗi PB → `_friendly` map WRONG_PASSWORD →
   banner "Sai mật khẩu. Thử lại." dù thực tế user không tồn tại trong DB mobile.

## Fix (chỉ `mobile/`, không đụng desktop, không ép PB — merge PB tạm gác)
- `lib/db/app_db.dart`: thêm `DemoStaffSeed` + `demoStaffSeeds`
  (staff01 giữ nguyên + **khoa01/khoa01** khớp plaintext desktop); `_seed`
  dùng `_ensureDemoStaff`; bump version 1→2 + `onUpgrade` idempotent cho DB
  đã tạo (kể cả IndexedDB web) — cài mới và máy cũ đều login được.
- `lib/repos/hybrid_auth_repo.dart`: thêm pure
  `resolveRemoteFailure(remote, local)` — local NOT_FOUND thắng (báo đúng
  "không tồn tại"), còn lại giữ lỗi remote (gộp vì bảo mật); `dev.log`
  ghi `remote=/local=/→` code để debug phân biệt (không log secret).
- `lib/core/auth_messages.dart` (mới): `friendlyAuthMessage` public, test được;
  copy NOT_FOUND → "Tài khoản không tồn tại trên thiết bị này. Khách đăng ký
  bằng SĐT, nhân viên liên hệ quản trị viên." `lib/screens/auth.dart` dùng lại.
- `test/auth_login_mo006_test.dart` (mới, 9 tests): seed chứa khoa01 + giữ
  staff01 + password qua `Validators.password`; 3 case resolveRemoteFailure;
  3 case message copy.

## Giới hạn đã ghi rõ (trong code + báo Leader)
- Chỉ các staff liệt kê trong `demoStaffSeeds` mới login được cả 2 app ở phạm
  vi local. Staff tạo mới trên desktop (runtime, bcrypt) KHÔNG tự sang mobile.
- Đồng bộ thật + scheme bcrypt thống nhất chờ PB-merge (ngoài scope MO-006).

## Verification (11/11/2026, Flutter 3.47.9)
- `flutter analyze` → No issues found!
- `flutter test` → All tests passed! (22 tests: 13 cũ + 9 mới MO-006)
- grep `print(|debugPrint(` trong `lib/` → 0 match (`dev.log` không tính).
- KHÔNG chạy app (Leader chạy).

## Web SQLite (đã có từ trước, kiểm tra lại OK — MO-004 thực ra đã apply)
- `pubspec.yaml:19`: `sqflite_common_ffi_web: ^1.2.2` (giữ `sqflite` cho mobile).
- `lib/db/app_db.dart:4-5`: conditional import
  `db_factory_init_stub.dart if (dart.library.js_interop) db_factory_init_web.dart`
  → compile-time web detection (tương đương `kIsWeb`, chuẩn cho sqflite web).
- `lib/db/db_factory_init_web.dart`: `databaseFactory = databaseFactoryFfiWeb`
  (SQLite/WASM + IndexedDB, SharedWorker). `db_factory_init_stub.dart`: no-op mobile.
- `web/sqlite3.wasm` + `web/sqflite_sw.js` có sẵn, build copy sang `build/web/`.

## Không đổi code trong task này (không cần — analyze/test/build đều pass)

## Verification (10/11/2026, Flutter 3.47.9)
- `flutter pub get` → Got dependencies!
- `flutter analyze` → No issues found!
- `flutter test` → All tests passed! (13 tests: fee, validators, widget)
- `flutter build web --release` → √ Built build\web
- `build/web/main.dart.js` 3.131.690 bytes TỒN TẠI; `index.html` không chứa DEBUG.
- grep `print(|debugPrint(` trong `lib/` → 0 match.
- APK: bỏ qua (không có Android SDK) theo contract.

---

# MO-017 — Cải thiện tỉ lệ nhận diện ANPR (nối MO-014, case screenshot 00:13)

## Chẩn đoán lại bằng chứng thật (đính chính giả thuyết Leader)

- Giả thuyết "model tải qua Play Services, cần mạng lần đầu" là **SAI với
  plugin đang dùng** (xác minh bằng source, không đoán):
  `google_mlkit_text_recognition 1.0.2` (pub cache) → Android dùng
  `com.google.mlkit:text-recognition:16.0.1` (**bundled**, model đi kèm
  APK, không phải thin-client Play Services), iOS bundle
  `LatinOCRResources`. Latin KHÔNG cần tải thêm, KHÔNG cần mạng lần đầu.
- Kênh native chỉ có `vision#startTextRecognizer` / `vision#close…` → **API
  KHÔNG có pre-check trạng thái model** → đi nhánh "bắt lỗi/timeout" theo
  đúng contract ("nếu API hỗ trợ HOẶC bắt lỗi").
- Nguyên nhân rỗng khả dĩ nhất ở case user: ảnh đêm thiếu sáng/nhòe +
  timeout khởi tạo lạnh lần đầu (8s), hoặc OCR full-frame bỏ sót biển 2
  dòng nhỏ. Code cũ gộp tất cả thành 1 message "Chưa đọc được" gây hiểu lầm.
- File `./specs/qr-anpr.md` (§2) được các summary cũ trích dẫn **không tồn
  tại** trong `mobile/specs/` — task này bám contract MO-017 + code hiện có.

## Quyết định (chỉ `mobile/`, không đụng desktop, không chạy app)

| File | Thay đổi |
|---|---|
| `lib/core/anpr.dart` | + `AnprFailureKind` (engine/timeout/empty/unmatched) + `classify({error, text})` (lỗi thắng trước text) + `hintFor(kind, {torchOn})` (copy Việt riêng từng nguyên nhân, empty gợi ý flash khi torch tắt) + `bestEffort` (dòng có chữ đầu → normalize, cắt 10) + `ocrSnippet` (gộp whitespace, cắt 48 + …) + `extractCandidates` ghép **cặp dòng kề** (biển 2 dòng "65-AB/829.65" → `65AB82965`; dòng rác ghép vào quá dài/sai pattern tự rớt) + `AnprCrop`/`CropBox` (tỉ lệ overlay canh giữa → pixel, kẹp biên, vô lý → null/full-frame fallback). Toàn pure, test được |
| `lib/data/anpr_recognizer.dart` | + `AnprEngineException(code, message)` — `MlKitAnprRecognizer.recognize` wrap `PlatformException` (`TextRecognizerError` từ Kotlin) + `Exception` → typed, giữ message gốc; comment ghi rõ bằng chứng bundled + không có API pre-check |
| `lib/screens/anpr_sheet.dart` | `_capture`: `TimeoutException` → hint timeout; `AnprEngineException`/lỗi khác → hint engine; text rỗng → hint empty (+torch); có chữ không khớp biển → sang confirm với `_rawOcr` (banner "Máy đọc được: …" + field prefill best-effort để sửa/dùng) thay vì rớt "Chưa đọc được". Nút chính thành **"Thử lại"** sau thất bại. "Chụp lại" ở confirm/pick reset `_rawOcr`. Giữ nguyên: xóa frame trong `finally`, không gửi mạng, "Nhập tay" luôn sẵn |
| `test/anpr_mo017_test.dart` (mới, 23 tests) | classify 5 (timeout/engine/empty/unmatched/lỗi-thắng-text) + hintFor 4 + bestEffort/snippet 3 + cross-line 5 (gồm case screenshot + không ảo từ 2 biển kề dòng + hồi quy MO-014) + AnprCrop 4 + engine typed 2 (recognize trên VM → `AnprEngineException`) |
| Crop byte ảnh thật | **HOÃN sang P2** (ghi rõ, không stub): cần thêm dep `image` + đo trên thiết bị thật; `AnprCrop` đã sẵn công thức + test để P2 dùng ngay. Không đáng đổi lockfile khi chưa đo được lợi ích |

## Verification (12/11/2026)

- `flutter analyze` → **No issues found!** (toàn dự án)
- `flutter test` → **All tests passed! (115 tests: 92 cũ + 23 mới MO-017)**
- grep `print(|debugPrint(` trong `lib/` → 0 match
- KHÔNG chạy app (theo contract)

## Cần test thiết bị thật (chưa cover — ghi rõ cho QA)

- Timeout 8s lần đầu/khởi tạo lạnh + ảnh đêm thật (thiếu sáng/nhòe/rung).
- Nhánh engine thật (`TextRecognizerError` native) — VM chỉ mô phỏng bằng
  MissingPluginException.
- Crop byte vùng overlay (P2) + đo có tăng tỉ lệ đọc biển 2 dòng xa không.
- Torch auto-suggest chỉ là gợi ý text — chưa tự bật flash.
