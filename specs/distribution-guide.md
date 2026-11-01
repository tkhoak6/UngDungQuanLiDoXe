# Distribution Guide — Đóng gói & cài đặt Bãi xe thông minh (DO-002)

> Owner: @devops. Scope: `package.json` (build config + scripts), `build/icon.*`,
> electron-builder NSIS. KHÔNG đụng `src/*`, DB, IPC.

## 1. File installer ở đâu

| Artifact | Đường dẫn | Ghi chú |
|---|---|---|
| Installer Windows | `release/BaiXeThongMinh-Setup-0.1.0.exe` (~90 MB) | NSIS, đã build + smoke test 26/10/2026 |
| Blockmap (auto-update P2) | `release/BaiXeThongMinh-Setup-0.1.0.exe.blockmap` | Chưa dùng — để dành khi làm auto-update |
| Thư mục unpack test | `release/win-unpacked/` | Bản giải nén, dùng debug nhanh không cần cài |

Tên file ASCII (`BaiXeThongMinh-Setup-…`) để tránh lỗi font khi copy qua USB/Zalo;
tên hiển thị trong app + shortcut vẫn là **"Bãi xe thông minh"**.

## 2. Cách cài (máy quầy / máy chủ bãi xe)

1. Copy file `.exe` qua USB tới máy cần cài, double-click.
2. **SmartScreen sẽ chặn** (app chưa ký số — xem §7): bấm **More info → Run anyway**.
3. Installer dạng assisted (`oneClick: false`): bấm Next, **được chọn thư mục cài**
   (mặc định `%LOCALAPPDATA%\Programs\Bãi xe thông minh`), bấm Install.
4. **Không cần quyền Admin** (`perMachine: false` — cài per-user).
5. Xong: mở app từ shortcut **Desktop** hoặc **Start Menu** ("Bãi xe thông minh").

Yêu cầu máy: Windows 10/11 64-bit. Không cần cài Node.js, không cần mạng.

## 3. Lần đầu chạy (bắt buộc — bảo mật)

App tự tạo DB + seed tài khoản demo ở lần mở đầu tiên:

| Tài khoản | Mật khẩu mặc định |
|---|---|
| `admin` | `Admin@123` (toàn quyền) |
| `staff01` | `Staff@123` (nhân viên) |

**Đăng nhập `admin` → đổi mật khẩu NGAY** (Users → sửa user), rồi mới tạo
tài khoản cho từng nhân viên. Đổi pass: xem `specs/backend-summary.md` §BE-008
(`users:update` + `current_password`).

## 4. Dữ liệu nằm ở đâu

| Thứ | Đường dẫn | Ghi chú |
|---|---|---|
| DB chính | `%APPDATA%\parking-desktop\parking.db` (+ `-wal`/`-shm`) | Tự bootstrap `schema.sql` + `seed.sql` lần đầu; DB cũ tự migrate 002→007 + backup `.bak-00x` cạnh DB |
| Cấu hình giá/vé/logo | `%APPDATA%\parking-desktop\app-config.json` | Sửa qua màn hình Quản lý (M1), không sửa tay khi app đang chạy |
| Auto-backup hằng ngày | cùng thư mục, `parking-YYYYMMDD-HHmm.db` (giữ 7 bản, chạy 03:00) + `backup-auto.log` | Job M3 (BE-015), lỗi không crash app |

> Lưu ý tên thư mục là `parking-desktop` (theo `package.json` `name`), không phải
> "Bãi xe thông minh". Dev chạy `npm run dev` dùng `./data/parking.db` riêng —
> 2 môi trường không đụng nhau.

## 5. Backup & cập nhật bản mới

- **Backup tay**: trong app (Quản lý → Backup) → chọn chỗ lưu (copy ra USB).
- **Trước khi cập nhật / sửa máy**: copy `parking.db` ra USB.
- **Cập nhật = chạy installer bản mới đè lên** (không cần gỡ bản cũ).
  DB giữ nguyên, migration mới (nếu có) tự chạy + tự backup `.bak-00x`.
- **Chưa có auto-update qua mạng (P2)** — cập nhật thủ công bằng file setup mới.

## 6. Gỡ cài đặt

Control Panel / Settings → gỡ "Bãi xe thông minh", hoặc chạy Uninstall trong
thư mục cài. **`deleteAppDataOnUninstall: false` — gỡ app KHÔNG xóa DB**
(`%APPDATA%\parking-desktop` giữ nguyên) nên cài lại vẫn còn đủ dữ liệu.
Muốn xóa sạch (bàn giao máy mới): xóa tay thư mục `%APPDATA%\parking-desktop`
**sau khi đã backup**.

## 7. SmartScreen & ký số (đã biết, ngoài scope)

Installer + file `.exe` **KHÔNG được ký số** (không có cert). Windows SmartScreen
sẽ hiện cảnh báo "Unknown publisher" — bấm **More info → Run anyway** là cài
được bình thường. Đây là cảnh báo chuẩn cho mọi app nội bộ không ký, không phải
virus. Mua cert ký số (OV/EV ~ vài trăm USD/năm) là việc P2 nếu cần triệt cảnh báo.

## 8. Build lại installer (máy dev)

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm install            # lần đầu; cần VS Build Tools để biên dịch better-sqlite3
npm run dist:win        # build:all + electron-builder NSIS → release/*.exe
npm run dist            # bản win-unpacked (test nhanh không cần cài)
```

- **Node**: dùng Node 20 cho đúng ABI Electron 33 (Node 24 hệ thống lệch ABI —
  xem `specs/run-report.md`). Binding `better-sqlite3` phải build lại cho ABI
  Electron: `npx @electron/rebuild -f -w better-sqlite3` (cần VS Build Tools
  workload "Desktop development with C++", cài 1 lần).
- **Tăng version**: `npm version patch` (0.1.0 → 0.1.1) rồi `npm run dist:win`.
- **Icon**: `build/icon.ico` (+ `build/icon.png`) — chữ "P" trắng trên nền
  `#1677FF` (design token), sinh bởi `tools/gen-icon.cjs` (đã xóa sau build;
  chạy lại `node tools/gen-icon.cjs` nếu cần vẽ lại — file đã dọn).
- Không có secret/env build-time nào — mọi cấu hình nằm trong DB + app-config.

### Lưu ý bản build từ sandbox (26/10/2026)

Máy build sandbox thiếu quyền tạo symlink (không admin/Developer Mode) nên
`winCodeSign` (rcedit) không giải nén được. Build đã dùng flags tạm thời:

```
--config.npmRebuild=false --config.win.signAndEditExecutable=false --config.asar=false
```

- `npmRebuild=false`: OK vì binding `better-sqlite3` trong `node_modules` đã
  đúng ABI Electron 130 (đã verify load + bootstrap DB thật dưới Electron).
- `signAndEditExecutable=false` + `asar=false`: hệ quả là **file `.exe` bản này
  mang icon + metadata mặc định của Electron** (chưa gắn icon "P" vào exe).
  Installer (makensis) vẫn gắn `installerIcon`/`uninstallerIcon` bình thường.
- **Build lại trên máy có quyền** (user dev / máy build chuẩn): chỉ chạy
  `npm run dist:win` (không thêm flags) → exe có icon + asar đầy đủ.
  Config chuẩn đã nằm trong `package.json`, không cần sửa gì thêm.

## 9. Verification (DO-002, 26/10/2026)

| Check | Kết quả |
|---|---|
| `npm run build:all` (tsc + vite) | PASS |
| `npx tsc --noEmit` | PASS |
| `vitest fee-calculator` | 10/10 PASS |
| `electron-builder --win nsis` | PASS → `release/BaiXeThongMinh-Setup-0.1.0.exe` (90 MB) |
| Payload check | `resources/app/{dist,node_modules,package.json}` + `resources/specs/*.sql` (8 file) + `better_sqlite3.node` đủ |
| Smoke: unpacked exe chạy 15s | alive, không crash; bootstrap `%APPDATA%\parking-desktop\parking.db` 12 bảng, seed `admin`/`staff01`, 3 zones, 3 shifts |
| Smoke: silent install (`/S /D=...`) | files giải nén đủ; **app đã cài chạy alive, không crash** |
| Gỡ cài đặt | Uninstaller chưa kịp sinh do sandbox kill installer giữa chừng (timeout) → dọn tay, không còn file/registry/shortcut sót; user test lại bước gỡ bằng tay (Control Panel) khi cài thật |
| Icon exe | icon mặc định Electron (giới hạn sandbox §8), installer icon OK |

**Status: partially_verified** — build + cài + chạy + DB đều pass bằng chứng thật;
còn 2 việc user làm trên máy thật: (1) cài bằng double-click + vượt SmartScreen,
(2) gỡ qua Control Panel để confirm uninstaller (sandbox đã dọn sạch, không sót).
