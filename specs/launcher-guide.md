# Launcher Guide — Mở app parking-desktop (DO-001)

> Script dev đã xác nhận trong `package.json`: `dev = tsc -p tsconfig.json && electron .`
> (`start-app.bat` gọi đúng `npm.cmd run dev`, không đụng `src/*` hay build config.)

## Cách (a) — Double-click (khuyên dùng) ✅

1. Mở File Explorer → `D:\DA`.
2. Double-click **`start-app.bat`** → cửa sổ đen (cmd) hiện log, app Electron mở sau vài giây.
3. Để nguyên cửa sổ đen khi đang dùng app.

## Cách (b) — Gõ lệnh tay trong terminal

Mở **cmd** (không cần PowerShell):

```bat
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d D:\DA
npm.cmd run dev
```

> Dùng `npm.cmd` (không phải `npm`) để tránh lỗi ExecutionPolicy của file `npm.ps1`.

## Cách tắt app

- Đóng **cửa sổ app Electron** là đủ (hoặc `Ctrl+C` trong cửa sổ cmd rồi đóng nó).

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách fix |
|---|---|
| `'npm' is not recognized` | Node chưa vào PATH — file bat đã tự thêm `C:\Program Files\nodejs` vào PATH. Nếu cài Node ở chỗ khác, sửa dòng `set "PATH=..."` trong `start-app.bat`. |
| Lỗi `...ps1 cannot be loaded...` / ExecutionPolicy | Đang gọi `npm` qua PowerShell thay vì `npm.cmd` qua cmd — dùng đúng cách (a) hoặc (b). |
| Trang **"Không khởi động được" + `Could not locate the bindings file`** | Thiếu native binding `better-sqlite3` — **xem chi tiết + 4 bước fix trong `specs/run-report.md` § "Bước tiếp theo cho user"** (cài VS Build Tools 1 lần, `npm.cmd rebuild better-sqlite3`, kiểm tra `NATIVE OK`, rồi `npm.cmd run build:all` + mở lại app). |
| Cửa sổ đen hiện lỗi rồi tắt ngay | Đã có `pause` khi lỗi để kịp đọc message — chụp màn hình gửi dev. |

Tài khoản demo sau khi DB bootstrap thành công: `admin` / `Admin@123`.
