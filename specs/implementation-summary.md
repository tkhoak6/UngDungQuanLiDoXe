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

---

# FE-022 — Màn cấu hình server (nối BE-017)

## Section "Máy chủ PocketBase" (tab Cấu hình, sau card Giá theo khu)

- File mới `src/renderer/pages/ManagementConfigServer.tsx` (~200 dòng):
  badge Trạng thái (Online success / Local warning + lý do Việt: chưa cấu
  hình URL / chưa cấu hình mã bãi / mất kết nối) — lấy từ `pb:status`
  lúc mount; ô URL server (default `DEFAULT_PB_URL` từ `lib/management`,
  placeholder hiển thị URL mặc định, để trống = local-only); ô Parking lot
  ID (mono + nút "Copy hướng dẫn lấy ID": `navigator.clipboard` copy text
  "Collections → parking_lots → copy id", toast xác nhận) + hint inline;
  nút Kiểm tra (gọi `pb:test` với URL đang gõ — override tạm, KHÔNG lưu —
  hiện latency `180ms` / "Không kết nối được"); nút Lưu máy chủ (qua
  `app-config:set {pb_url, pb_parking_lot}`, validate client URL http(s) +
  lot `[A-Za-z0-9_-]{1,100}`, map `fields` server thành inline error).
- Thiếu lot → banner Warning (không chặn): "app vẫn chạy local-only, xin ID
  từ system_admin". Sau lưu → refresh badge local (không đoán online).
- `ManagementConfig.tsx`: thêm state `pbUrl/pbLot` (cache → server),
  render section; dirty-guard tab hiện có tự bao phủ (via `onDirty`).

## Types + adapter + mock (mirror `src/shared/types.ts`, BE-016/017)

- `renderer/types.ts`: `ParkingSettings` + `pb_url/pb_parking_lot`;
  `AppConfigSetInput` nhận 2 key; mới `PbMode/PbStatus/PbTestInput/PbTestResult`.
- `lib/api.ts`: `RendererApi.pbStatus()/testPbConnection(url?)` + impl
  backend (`pb:status` guard none, `pb:test` admin-only).
- `lib/management.ts`: `DEFAULT_PB_URL` export + `DEFAULT_SETTINGS` đủ 2 key
  (cache cũ thiếu key → merge defaults, không vỡ).
- `lib/mockApi.ts`: `mockSettings` đủ 2 key; `setAppConfig` validate mirror
  backend (URL http(s)+dot ≤500, strip slash, rỗng→null; lot regex,
  rỗng→null); mock `pbStatus` (luôn local-only, browser dev không ping được)
  + `testPbConnection` (validate định dạng, reachable demo latency 180ms).

## States / a11y

- Loading: badge "Đang kiểm tra…" + skeleton; error: toast danger, giữ form;
  empty (= chưa cấu hình): banner hướng dẫn, không chặn local.
- `<section aria-labelledby>`, `<label>` đầy đủ, hint/error qua
  `aria-describedby`, kết quả test `role="status"`, nút `aria-busy`.

## Verification

- `npx tsc --noEmit` → **pass**. Không `console.log`. Không đụng main/DB.
- Chưa chạy: click-through GUI (Electron/vite) — cần reviewer QA tay.
