# Bãi xe thông minh — Hệ quản lý đỗ xe client-server

Hệ quản lý đỗ xe theo kiến trúc **client-server**: **desktop (Windows)** tại quầy và **mobile (Android)** cho khách/nhân viên hiện trường cùng kết nối về **server PocketBase online** trung tâm. Mặc định chạy **local-first** (offline hoàn toàn); cấu hình server thì đăng nhập online trước, rớt mạng tự fallback về dữ liệu local.

| Nền tảng | Vai trò | Trạng thái |
|---|---|---|
| 🖥️ Desktop (Electron, Windows) | **Client** tại quầy | ✅ Hoàn thành — local-first (SQLite máy cục bộ) + đăng nhập online-first qua PocketBase (BE-016/BE-017, auth fallback local). |
| 📱 Mobile (Flutter, Android) | **Client** di động | ✅ V1 hoàn thành — customer 5 tabs + staff 4 tabs, SQLite local mirror; bản APK ký release đã build, **chưa đăng lên GitHub Releases**. |
| ☁️ Server PocketBase | **Server trung tâm** | ✅ Đang chạy — `https://mqaue7.bot-keep.xyz` (schema thật theo `specs/pb-server-map.json`; desktop nối auth, sync data P2). |

> **Ghi chú trung thực:** desktop đã dùng được (cài từ installer bên dưới). Mobile V1 code xong + APK release đã build nhưng chưa có link tải công khai. Đồng bộ dữ liệu 2 chiều (sync) là P2; hiện tại server mới nối ở tầng đăng nhập.

## Tải & cài đặt

### Desktop Windows (khuyên dùng)

1. Tải installer **`BaiXeThongMinh-Setup-0.1.0.exe`** (~87 MB) tại
   [GitHub Releases — Bãi xe thông minh v0.1.0](https://github.com/tkhoak6/UngDungQuanLiDoXe/releases/tag/v0.1.0).
2. Double-click → SmartScreen hiện "Unknown publisher" (app chưa ký số) → bấm **More info → Run anyway**.
3. Cài per-user, **không cần quyền Admin**. Không cần Node.js, không cần mạng.
4. Lần đầu mở app: DB tự tạo + seed tài khoản demo (xem bên dưới) — đăng nhập `admin` → **đổi mật khẩu NGAY**.

Chi tiết cài/backup/gỡ/build lại: [`specs/distribution-guide.md`](specs/distribution-guide.md).

### Mobile Android

Chưa có file APK trên GitHub Releases. Hai cách lấy bản mobile:

- **Liên hệ tác giả** để nhận file `app-release.apk` (bản release đã ký, ~58 MB, applicationId `vn.baixe.parkingmobile`).
- **Tự build từ source** (cần Flutter SDK):

```bash
cd mobile
flutter pub get
flutter build apk --release
# ra: mobile/build/app/outputs/flutter-apk/app-release.apk
```

Tài khoản demo mobile (seed local): customer `0901234567` / `customer123`, staff `staff01` / `staff123`, hoặc "Tiếp tục xem sơ đồ" (guest, không login). Chi tiết: [`mobile/README.md`](mobile/README.md), [`specs/mobile-app.md`](specs/mobile-app.md).

## Kết nối máy chủ online (tùy chọn)

Desktop chạy local-only nếu bỏ trống cấu hình. Để dùng đăng nhập online:

1. Mở app desktop → **Quản lý → Cấu hình → section "Máy chủ PocketBase"**.
2. Nhập **URL server** (mặc định `https://mqaue7.bot-keep.xyz`) và **Parking lot ID** —
   xin ID từ `system_admin`, hoặc tự tra: mở PocketBase Admin → Collections → `parking_lots`
   → mở dòng bãi của bạn → Copy ID dán vào ô.
3. Bấm **Kiểm tra** (hiện độ trễ) rồi **Lưu**. Badge trạng thái hiện Online/Local.
4. Để trống URL = quay về local-only.

Hành vi đăng nhập (BE-016): **online trước** — thành công thì mirror về local (lần sau
offline vẫn đăng nhập được); rớt mạng/sai pass/chưa có user trên server thì **fallback
local**. Tài khoản bị khóa/sai vai trò thì không fallback. Đăng ký khách mới: tạo local
trước, đồng bộ lên server best-effort (offline vẫn dùng được). Sync dữ liệu nghiệp vụ
2 chiều là P2 — hiện tại giá/cấu hình bãi vẫn lấy từ local.

## App desktop (Windows) — đã hoàn thành

App desktop Windows (Electron + SQLite local-first + React) cho quầy bãi xe: check-in/out, tính phí tự động, vé tháng, đặt chỗ, chấm công ca trực, báo cáo và backup.
Chạy offline hoàn toàn, dữ liệu lưu máy cục bộ, không cần mạng hay server riêng.
Giao diện enterprise data-dense (Ant-inspired, primary `#1677FF`), cửa sổ tối thiểu 1280×720.

## Tính năng chính (theo vai trò)

**Admin (toàn quyền)**
- Cấu hình khu vực / chỗ đỗ / giá giờ-ngày, bật-tắt khu.
- Quản lý users + phân quyền chi tiết 5 flags (`checkin`, `pass_sale`, `report_self`, `profile_self`, `reservation`).
- Báo cáo doanh thu, chi tiết giao dịch (M1), cấu hình bãi xe (M2: tên/logo/giá/**máy chủ PocketBase**), backup/restore DB (M3).
- Quản lý ca làm việc (shifts), xem chấm công, hiệu suất, nhật ký hoạt động.

**Nhân viên**
- Check-in (auto-pick chỗ trống) / check-out + thu phí (tiền mặt/chuyển khoản/thẻ/ví), phí tối thiểu 30 phút = 1 giờ, ≥ 12h tính giá ngày, vé tháng còn hiệu lực = 0đ.
- Bán / gia hạn vé tháng (gói 1/3/6/12 tháng, gói 12 giảm 10%), xác nhận vé `pending` khi thu tiền tại quầy.
- Xác nhận / hủy đặt chỗ, chấm công vào-ra ca + bàn giao tiền mặt (opening/closing cash, đối soát lệch chỉ cảnh báo), xem báo cáo ca của mình.
- Xem sơ đồ chỗ trống, tự sửa SĐT/địa chỉ của mình (nếu được phân quyền).

**Khách (guest, không đăng nhập) / Khách hàng (customer, đăng ký SĐT)**
- Guest: xem bản đồ chỗ trống read-only, tự refresh 30s.
- Customer: tự đăng ký bằng SĐT VN 10 số (= username) + mật khẩu ≥ 6 ký tự, đăng nhập, đặt chỗ trong ngày (khung 06:00–22:00, tối đa 2 chỗ `pending`/`active`, giữ ~20 phút), hủy chỗ của mình, xem vé tháng của mình, đăng ký vé `pending` chờ staff xác nhận.

## Công nghệ

- Desktop: Electron 33 + `better-sqlite3` (local-first, WAL), IPC qua preload.
- Frontend: React 18 + Vite 5 + TypeScript, icons `lucide-react`.
- Backend logic: Node + better-sqlite3 transactions (check-out = update session + spot + insert payment trong 1 transaction).
- Online: PocketBase JS SDK (`pocketbase@^0.28.2`, auth online-first + mirror local), server mặc định `https://mqaue7.bot-keep.xyz`.
- Mobile: Flutter (single codebase), SQLite local mirror (sqflite), Riverpod + GoRouter.
- Test: Vitest (fee-calculator 10 case), `tsc --noEmit` typecheck.
- Đóng gói: electron-builder NSIS → `release/BaiXeThongMinh-Setup-<version>.exe`.

## Yêu cầu

- Windows 10/11 64-bit.
- Node.js 20 (đúng ABI Electron 33 — xem `specs/run-report.md`; Node 24 hệ thống bị lệch ABI).
- VS Build Tools workload "Desktop development with C++" (1 lần, để biên dịch `better-sqlite3`).
- Không cần mạng khi chạy app đã cài (trừ khi dùng đăng nhập online).

## Chạy dev

Cách nhanh — double-click:

```bat
start-app.bat
```

Để nguyên cửa sổ cmd khi đang dùng app. Đóng cửa sổ Electron là đủ để tắt.

Chạy tay bằng lệnh (mở **cmd**, không dùng PowerShell):

```bat
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d D:\DA
npm.cmd run dev
```

Lệnh liên quan trong `package.json`:

```bat
npm.cmd run dev             ^(tsc + electron ^. — chạy app^)
npm.cmd run dev:renderer    ^(vite dev server riêng, khi cần^)
npm.cmd run build:all       ^(tsc + vite build^)
npm.cmd run typecheck       ^(tsc --noEmit^)
npm.cmd run test            ^(vitest run toàn bộ^)
npm.cmd run verify:fee      ^(vitest fee-calculator^)
```

Lần đầu chạy dev: DB ở `./data/parking.db` (riêng với bản đã cài). Nếu báo `Could not locate the bindings file`, xem `specs/run-report.md` § "Bước tiếp theo cho user" (cài VS Build Tools → `npm.cmd rebuild better-sqlite3`).

## Build installer Windows

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm install
npm run dist:win
```

- `npm run dist:win` = `build:all` + electron-builder NSIS → `release/*.exe`.
- `npm run dist` = bản `win-unpacked` (test nhanh không cần cài).
- Nếu binding sai ABI: `npx @electron/rebuild -f -w better-sqlite3`.
- Tăng version: `npm version patch` rồi build lại.
- Lưu ý ký số: installer chưa ký → SmartScreen hiện "Unknown publisher" → bấm **More info → Run anyway**. Cài per-user, không cần quyền Admin.

## Tài khoản demo

| Tài khoản | Mật khẩu | Quyền |
|---|---|---|
| `admin` | `Admin@123` | Toàn quyền |
| `staff01` | `Staff@123` | Nhân viên |

> ⚠️ Đăng nhập `admin` → đổi mật khẩu NGAY (Users → sửa user) rồi mới tạo tài khoản cho từng nhân viên.

DB bản đã cài: `%APPDATA%\parking-desktop\parking.db` (cấu hình `app-config.json` cùng thư mục, auto-backup `parking-YYYYMMDD-HHmm.db` giữ 7 bản lúc 03:00). Gỡ app không xóa DB; bàn giao máy mới thì backup rồi xóa tay thư mục này.

## Cấu trúc thư mục

```text
D:\DA\
  start-app.bat        Mở app dev (double-click)
  package.json         Scripts dev/build/dist + config electron-builder
  src/
    main/              Electron main + IPC + SQLite + PocketBase client (fee-calculator, backup job)
    preload/           Bridge IPC an toàn
    renderer/          React UI (sidebar 240px + topbar 56px)
    shared/            Types + contract dùng chung
  mobile/              App Flutter (Android/iOS): lib/, android/, test/
  specs/*.sql          Schema + seed + migration 002→007
  specs/pb-*.json      Schema + mapping server PocketBase
  build/               icon.ico/icon.png (chữ P trên #1677FF)
  release/             Installer .exe + win-unpacked
  data/                parking.db dev (không commit)
```

## Tài liệu chi tiết

- Cài đặt / backup / gỡ / build lại: [`specs/distribution-guide.md`](specs/distribution-guide.md)
- Mở app dev (launcher): [`specs/launcher-guide.md`](specs/launcher-guide.md)
- Server PocketBase (import + vận hành): [`specs/pocketbase-guide.md`](specs/pocketbase-guide.md)
- Gộp an toàn với server thật (mapping entity): [`specs/pb-merge-plan.md`](specs/pb-merge-plan.md)
- Backend + auth online (BE-016/BE-017): [`specs/backend-summary.md`](specs/backend-summary.md)
- Mobile (UX spec + summary): [`specs/mobile-app.md`](specs/mobile-app.md), [`mobile/README.md`](mobile/README.md)
- API + schema + ma trận quyền: [`api-contract.md`](api-contract.md)
- Design tokens + mapping trạng thái: [`DESIGN.md`](DESIGN.md)
- Spec nghiệp vụ gốc: [`specs/parking-app.md`](specs/parking-app.md)
- Khu vực nhân viên (chấm công/phân quyền): [`specs/staff-area.md`](specs/staff-area.md)
- Khu vực khách (đăng ký/đặt chỗ): [`specs/customer-area.md`](specs/customer-area.md)
- Khu vực quản lý M1–M3: [`specs/management-area.md`](specs/management-area.md)
- Báo cáo build/run gần nhất: [`specs/run-report.md`](specs/run-report.md), [`specs/review-report.md`](specs/review-report.md)
