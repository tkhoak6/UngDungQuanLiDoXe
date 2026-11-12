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

---

# FE-023 — Đặt nhanh 1 chạm (sửa form P4 desktop)

## Vấn đề (screenshot user 21:09)

Form cũ bắt nhập tay Từ/Đến giờ trong khung 06:00–22:00 — tối muộn gần như
không đặt được, sai là báo đỏ. Khó dùng.

## Cách sửa (chỉ `src/renderer/pages/MyReservationsPage.tsx`, KHÔNG đụng main/DB/IPC)

- Mode mặc định **"Đặt nhanh"** (`quick=true`): Khu vực (select như cũ) +
  Biển số (prefill xe đầu tiên từ `customer:vehicles`; >1 xe → dropdown +
  option "Biển số khác…" mở ô nhập tay) + chips Thời lượng **1h/2h/3h/4h**
  (default 2h) + dòng read-only "Bắt đầu: ngay bây giờ (HH:MM) → kết thúc
  dự kiến HH:MM (X giờ)" + nút **"Giữ chỗ ngay"**. Không có ô nhập giờ.
- Giờ bắt đầu = now (chốt lúc bấm nút), kết thúc = now + duration, kẹp
  `22:00`: vượt → **tự rút vừa khung** + note vàng
  "Đã rút còn X phút vì bãi đóng cửa 22:00." (vẫn Giữ chỗ được, không báo đỏ).
- Hết room (< 30p tới 22:00, tức từ 21:30, hoặc ngoài 06:00–22:00) → note đỏ
  "Hôm nay bãi sắp đóng cửa, quay lại sáng mai nhé." + **disable nút**
  (không cho submit rồi mới lỗi).
- Link **"Chỉnh giờ chi tiết"** (btn-ghost, `.link` không tồn tại trong
  index.css) mở form Từ/Đến cũ — validate cũ giữ nguyên (`handleReserve`
  không đổi). Link "Về đặt nhanh" để quay lại.
- Giữ nguyên: quota 2 (chặn mềm + banner), countdown "Hết hạn sau Np" tick
  30s, Hủy + Dialog xác nhận, poll 60s, My reservations list, success card
  + Copy mã. `refill` ("Đặt lại") mở mode chi tiết với giờ của vé cũ.
- Hằng số khung giờ: `OPEN_MIN=360`, `CLOSE_MIN=1320`, `MIN_KEEP_MIN=30`
  (local trong file, không phát minh field IPC mới).

## States / a11y

- Loading/error/empty của list giữ nguyên. Note vàng `role="status"`,
  note đỏ `role="alert"` (qua `Alert`). Chips `aria-pressed`, group có
  `aria-labelledby`. Dòng giờ dự kiến `aria-live="polite"`. Nút disable khi
  `busy || quickTooLate`.

## Verification

- `npx tsc --noEmit` → **pass** (EXIT:0). Không `console.log`.
- `npm run build:renderer` (vite) → **built in 8.53s**, không restart app.
- Logic đã self-review theo hợp đồng: 21:09 đặt 2h → end kẹp 22:00
  (rút còn 51p + note vàng, vẫn Giữ chỗ được); ≥21:30 → disable + note đỏ;
  giờ hành chính → đặt thẳng không note (validate server giữ nguyên chốt).
- Chưa chạy: click-through GUI thật (Electron/vite) — cần designer QA tay.
# FE-024 — Desktop đặt chỗ 24/24 (nối BE-019 + FE-023)
## Thay đổi (chỉ `src/renderer/*`, KHÔNG đụng main/DB/mobile)

- `pages/MyReservationsPage.tsx`:
  - XÓA `OPEN_MIN/CLOSE_MIN/MIN_KEEP_MIN`, `quickTooLate/quickTrimmed/
    quickEffective/quickEndMin`, note "bãi đóng cửa 22:00", note đỏ "quay lại
    sáng mai", `min/max 06:00–22:00` trên 2 ô `time`, mọi message chứa
    `06:00–22:00`.
  - Quick mode: `start = now` (chốt lúc bấm nút), `end = now + duration`
    (helper `addMinutesHHMM` tràn qua 0h) — KHÔNG clamp, KHÔNG disable theo
    giờ; nút disable chỉ khi `busy`. Dòng dự kiến hiện
    `Bắt đầu … → kết thúc … (X giờ)` + `(qua đêm)` khi tràn ngày.
    Chips 1h/2h/3h/4h giữ nguyên (server cho 15p–4h nhưng chips đủ dùng).
  - Detail mode: nhập tay mọi giờ, `end <= start` = qua đêm
    (`isOvernight`/`durationMin` helpers, ngày picker = ngày bắt đầu);
    validate mới — trùng giờ → `"Giờ kết thúc phải sau giờ bắt đầu."`;
    duration ngoài 15p–4h → `"Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ."`;
    quá khứ >15p giữ nguyên. Hint live dưới 2 ô giờ:
    `Qua đêm: 23:00 hôm nay → 01:00 hôm sau (2 giờ).`
  - Countdown/hết hạn theo `expires_at` server (giờ kết thúc +20p, có thể
    sang hôm sau) — logic `minutesToExpiry` giữ nguyên, đã đúng cả qua đêm.
  - Success card + từng row hiện `(qua đêm)` khi `end <= start`; success ghi
    `Tự hủy lúc HH:MM (20 phút sau giờ kết thúc)` lấy từ `expires_at`.
  - Subtitle `Giữ chỗ 24/24`, hint ngày
    `khung qua đêm (VD 23:00→01:00) tính sang hôm sau`, EmptyState bỏ chữ
    "trong hôm nay". `refill` ("Đặt lại") vẫn mở detail với giờ vé cũ.
- `types.ts`: comment `Reservation` đồng bộ BE-019 (24/24, qua đêm,
  `expires_at` = kết thúc +20p).
- `lib/mockApi.ts` (`reserve`): mirror BE-019 — bỏ check 06–22, `start===end`
  lỗi, duration qua đêm (+24h) 15p–4h, `expires_at` = end +20p với **ngày**
  tràn đúng (`expDay` từ `Date`, không còn hardcode `day`).

## States / a11y

- Loading/error/empty, quota 2, Dialog hủy, poll 60s, tick 30s giữ nguyên.
- Hint qua đêm `field-hint` + `aria-describedby`; lỗi validate `field-error`
  `id="rsv-time-err"`; chips `aria-pressed`; giờ dự kiến `aria-live="polite"`.

## Verification

- `npx tsc --noEmit` → **pass** (EXIT:0). Không `console.log`.
- `npm run build:renderer` (vite) → **built in 11.47s**, không restart app.
- Logic overnight verify bằng node: `23:00 + 120p = 01:00`,
  `durationMin(23:00→01:00) = 120`, `isOvernight = true` → đặt được,
  countdown theo `expires_at` 01:20 hôm sau.
- Chưa chạy: click-through GUI thật + runtime qua đêm cần DB đã
  migration-008 (BE-019 note: DB cũ CHECK cũ vẫn chặn INSERT qua đêm —
  chờ @database).

---

# FE-025 — Desktop notify UI (nối BE-021, spec notifications.md DS-014 V1)

## Đấu dây renderer với scheduler có sẵn (chỉ `src/renderer/*`, KHÔNG main/DB/FCM)

- Mới `src/renderer/lib/notify.ts` (~120 dòng): `subscribeNotifyDeepLink(cb)`
  (thử bridge mở rộng `window.api.onNotifyDeepLink` + window CustomEvent cùng
  kênh `notify:deep-link` — mock `testNotify({sample})` dispatch event này nên
  QA click-through được ngay trên bản web/vite), `dispatchNotifyDeepLink`,
  `notifyPermission/requestNotifyPermission` (chỉ gọi SAU rationale), rationale
  §5.1 (`shouldShowNotifyRationale` — permission default + tối đa 2 lần),
  banner §5.2 (`shouldShowFallbackBanner/dismiss` — nhớ 7 ngày), `FALLBACK_COPY`.
- Mới `src/renderer/components/NotifyBanner.tsx`: `NotifyFallbackBanner`
  (`role="status"` Warning strip + "Hướng dẫn bật" Settings→System→Notifications
  + "Để sau 7 ngày") và `NotifyRationaleDialog` (bullets 3 dòng + [Để sau] /
  [Bật thông báo], focus-trap/Esc qua `Dialog` có sẵn).
- `types.ts`: mirror `NotifyEvent/Tab/DeepLink/FireMode/FireItem/TestInput/Output`
  từ `src/shared/types.ts` (ApiMap `notify:test`). `lib/api.ts` +
  `lib/mockApi.ts`: `testNotify(sample?)` — mock dry-run trả 4 item demo
  (E1 MT-2026-0001, E2 R-code, E3 khu A, E4 att 101) + dispatch CustomEvent khi
  có sample để App điều hướng + highlight như click Toast thật.
- `App.tsx`: subscribe 1 lần → map tab (passes→Vé tháng, attendance→Chấm công,
  map→Sơ đồ, reservations của staff → ở yên + toast mã để đối soát tại quầy;
  customer luôn ở GuestPage nên GuestPage tự map tab con) + toast success xác
  nhận điều hướng (tự tắt 5s). Truyền highlight props xuống các màn.
- Highlight row: PassesPage (`highlightPassCode`, `tr.row-flash` có sẵn trong
  index.css + scrollIntoView), AttendanceTable (`highlightId`, `tr.row-flash`
  + auto về tab Chấm công), MyReservationsPage (`highlightCode`, outline
  primary + scroll), MyVehiclesPage pending alert (`highlightPassCode`,
  outline + scroll), GuestPage (E3 preselect zone theo `zone_code` sau khi
  zones load; E4 không có màn customer → bỏ qua).
- Banner fallback cắm đúng 3 màn spec: Vé tháng (surface passes, staff +
  customer qua MyVehiclesPage), Đặt chỗ (surface reservations), Chấm công
  (surface attendance). Rationale cắm đúng 3 trigger spec: giữ chỗ thành công
  (MyReservationsPage), đăng ký vé (MyVehiclesPage buy success), vào ca
  (AttendancePage check-in success).
- `ManagementSafety.tsx`: card "Thông báo desktop (thử nghiệm)" — badge quyền
  (`notifyPermissionLabel`), nút "Quét ngay (dry-run)" + 4 nút "Gửi thử E1–E4"
  (gọi `notify:test`), list kết quả `fired/deferred` + mode VN + hint click
  Toast → đúng tab.

## Lưu ý cho @leader/BE (ngoài scope FE-025)

- Preload hiện chỉ expose `api.invoke` (contextIsolation+sandbox) nên renderer
  Electron thật CHƯA nhận được `webContents.send(notify:deep-link)` — cần BE
  bổ sung ~3 dòng `onNotifyDeepLink` vào `src/preload/index.ts` (subscribe của
  FE đã thử bridge này trước, tương thích xuôi). Bản web/vite + dry-run đã QA
  được qua CustomEvent fallback.

## Verification

- `npx tsc --noEmit` → **pass** (EXIT:0). Không `console.log`.
- `npm run build:renderer` (vite) → **built in 12.53s**, không restart app.
- Chưa chạy: click Toast thật trong Electron (cần preload `on` + DB có data
  mẫu E1–E4) — chờ designer QA tay.


