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
