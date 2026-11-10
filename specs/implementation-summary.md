# MO-004 — Web DB + build hoàn chỉnh (implementation summary)

## Vấn đề
Guest map trên web (`/#/map`) hiện banner đỏ "Không tải được sơ đồ." + grid trống.
Nguyên nhân: `sqflite` (plugin native) KHÔNG hỗ trợ web → `AppDb.db` ném lỗi
ngay `getDatabasesPath()`/`openDatabase` → `ParkingRepo.zones()` fail.

## Cách sửa (đã chọn)
**Chuẩn theo upstream `sqflite_common_ffi_web` v1.2.2** — KHÔNG fallback
in-memory seed riêng (giữ 1 code path SQLite duy nhất, seed zones A/B/C +
spots demo + poll 30s giữ nguyên):

1. `pubspec.yaml`: thêm `sqflite_common_ffi_web: ^1.2.2` (mobile giữ
   nguyên plugin `sqflite`).
2. Mới `lib/db/db_factory_init_web.dart`: `databaseFactory =
   databaseFactoryFfiWeb` (SQLite/WASM trong SharedWorker, lưu IndexedDB,
   cross-tab safe).
3. Mới `lib/db/db_factory_init_stub.dart`: no-op cho mobile/desktop/VM.
4. Sửa `lib/db/app_db.dart`: conditional import
   `db_factory_init_stub.dart if (dart.library.js_interop)
   db_factory_init_web.dart` + gọi `await initDatabaseFactory()` 1 lần
   trong getter `db` trước mọi `openDatabase`. Không đụng màn nào,
   không đụng Electron, poll 30s trong `map_screen.dart` giữ nguyên.
5. Chạy `dart run sqflite_common_ffi_web:setup` → sinh
   `web/sqlite3.wasm` (748 KB) + `web/sqflite_sw.js` (268 KB); tool tự
   thêm `web/**` vào `analysis_options.yaml` excludes.

## Lưu ý vận hành web
- IndexedDB tính theo origin (port): giữ cố định `--web-port` khi dev
  (vd `flutter run -d chrome --web-port 8099`), đổi port = DB trống mới.
- Thiếu 2 file `web/sqlite3.wasm` / `web/sqflite_sw.js` khi deploy →
  lỗi worker đầu tiên trong console. 2 file đã có trong `web/`.
- `singleInstance: false` không hỗ trợ DB persistent trên web (giữ mặc
  định `true` — code hiện tại đã đúng).

## Verification
- `flutter analyze`: **No issues found** (0 errors/warnings/infos)
- `flutter test`: **14/14 passed** (fee, validators, widget)
- `flutter build web --release`: **√ Built build\web** — `main.dart.js`
  (3.1 MB), `sqlite3.wasm` + `sqflite_sw.js` đã copy vào `build/web`;
  release mode nên mất banner DEBUG
- `flutter build apk --debug`: **BỎ QUA — không có Android SDK**
  (không ANDROID_HOME/SDK trên máy, không cài thêm theo scope)
