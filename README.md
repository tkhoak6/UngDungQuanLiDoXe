# Bãi xe thông minh — Hệ quản lý đỗ xe client-server

Hệ quản lý đỗ xe theo kiến trúc **client-server**: **client** gồm **app máy tính (Desktop)** tại quầy bãi xe và **app điện thoại (Mobile)** cho khách/nhân viên hiện trường, cùng kết nối về **server online trung tâm** (API + DB tập trung, đồng bộ 2 chiều). Offline vẫn chạy bình thường, có mạng thì đồng bộ lên server.

| Nền tảng | Vai trò | Trạng thái |
|---|---|---|
| 🖥️ Desktop (Electron, Windows) | **Client** tại quầy | ✅ Hoàn thành — đang chạy local-first (SQLite máy cục bộ); lộ trình nối lên server online để đồng bộ. |
| 📱 Mobile (app điện thoại) | **Client** di động | 🔜 Lộ trình — khách check-in/out, xem chỗ trống thời gian thực, đặt chỗ trước; dùng chung contract `api-contract.md` với server. |
| ☁️ Server online | **Server trung tâm** | 🔜 Lộ trình — API trung tâm + DB tập trung, đồng bộ 2 chiều với các client (offline vẫn chạy, có mạng đồng bộ sau). |

> **Ghi chú trung thực:** hiện tại chỉ **Desktop client** đã hoàn thành và dùng được (local-first). Mobile và Server online là lộ trình, chưa có bản chạy được.
>
> Phần còn lại của README này mô tả chi tiết **Desktop client**.
>
> **Lộ trình kỹ thuật:** (1) Giữ SQLite local trên Desktop làm cache/offline store, thêm lớp sync đẩy/kéo về server khi có mạng. (2) Server online giữ DB tập trung làm nguồn chân lý (source of truth), xung đột giải quyết theo timestamp + quy tắc nghiệp vụ. (3) Mobile dùng chung contract `api-contract.md`, không truy cập DB trực tiếp. (4) Desktop hiện tại không cần sửa logic nghiệp vụ khi nối server — chỉ thêm adapter đồng bộ.

## App desktop (Windows) — đã hoàn thành

App desktop Windows (Electron + SQLite local-first + React) cho quầy bãi xe: check-in/out, tính phí tự động, vé tháng, đặt chỗ, chấm công ca trực, báo cáo và backup.
Chạy offline hoàn toàn, dữ liệu lưu máy cục bộ, không cần mạng hay server riêng.
Giao diện enterprise data-dense (Ant-inspired, primary `#1677FF`), cửa sổ tối thiểu 1280×720.

## Tính năng chính (theo vai trò)

**Admin (toàn quyền)**
- Cấu hình khu vực / chỗ đỗ / giá giờ-ngày, bật-tắt khu.
- Quản lý users + phân quyền chi tiết 5 flags (`checkin`, `pass_sale`, `report_self`, `profile_self`, `reservation`).
- Báo cáo doanh thu, chi tiết giao dịch (M1), cấu hình bãi xe (M2: tên/logo/giá), backup/restore DB (M3).
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
- Test: Vitest (fee-calculator 10 case), `tsc --noEmit` typecheck.
- Đóng gói: electron-builder NSIS → `release/BaiXeThongMinh-Setup-<version>.exe`.

## Yêu cầu

- Windows 10/11 64-bit.
- Node.js 20 (đúng ABI Electron 33 — xem `specs/run-report.md`; Node 24 hệ thống bị lệch ABI).
- VS Build Tools workload "Desktop development with C++" (1 lần, để biên dịch `better-sqlite3`).
- Không cần mạng khi chạy app đã cài.

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
    main/              Electron main + IPC + SQLite (fee-calculator, backup job)
    preload/           Bridge IPC an toàn
    renderer/          React UI (sidebar 240px + topbar 56px)
    shared/            Types + contract dùng chung
  specs/*.sql          Schema + seed + migration 002→007
  build/               icon.ico/icon.png (chữ P trên #1677FF)
  release/             Installer .exe + win-unpacked
  data/                parking.db dev (không commit)
```

## Tài liệu chi tiết

- Cài đặt / backup / gỡ / build lại: [`specs/distribution-guide.md`](specs/distribution-guide.md)
- Mở app dev (launcher): [`specs/launcher-guide.md`](specs/launcher-guide.md)
- API + schema + ma trận quyền: [`api-contract.md`](api-contract.md)
- Design tokens + mapping trạng thái: [`DESIGN.md`](DESIGN.md)
- Spec nghiệp vụ gốc: [`specs/parking-app.md`](specs/parking-app.md)
- Khu vực nhân viên (chấm công/phân quyền): [`specs/staff-area.md`](specs/staff-area.md)
- Khu vực khách (đăng ký/đặt chỗ): [`specs/customer-area.md`](specs/customer-area.md)
- Khu vực quản lý M1–M3: [`specs/management-area.md`](specs/management-area.md)
- Báo cáo build/run gần nhất: [`specs/run-report.md`](specs/run-report.md), [`specs/review-report.md`](specs/review-report.md)
