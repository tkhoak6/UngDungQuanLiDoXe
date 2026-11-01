# Run Report — BE-003 Đưa app Electron lên (16/10/2026)

> Owner: @node-developer. Kết luận: **BLOCKED ❌ ở native binding better-sqlite3**
> (build main + renderer PASS, Electron launch không crash, nhưng DB không mở được
> cho tới khi user cài VS Build Tools).

## Lệnh đã chạy & kết quả từng bước

| # | Lệnh | Kết quả |
|---|------|---------|
| 1 | `node node_modules/typescript/bin/tsc --noEmit` | **PASS** (exit 0) |
| 2 | `node node_modules/typescript/bin/tsc -p tsconfig.json` | **PASS** → `dist/main/main.js`, `dist/preload/index.js` đúng layout `package.json` (`main: dist/main/main.js`) |
| 3 | `node node_modules/vite/bin/vite.js build` | **PASS sau fix** (lỗi ban đầu xem §A) → `dist/renderer/index.html` + assets (223 kB JS) |
| 4 | `node node_modules/vitest/vitest.mjs run --config vitest.backend.config.ts` | **PASS 10/10** (`fee-calculator.spec.ts`) |
| 5 | `cmd /c "npm.cmd install --no-audit --no-fund"` | **PASS** — thêm `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@types/react{,-dom}`; approve + rebuild `electron` → `node_modules/electron/dist/electron.exe` (188 MB) có mặt |
| 6 | `cmd /c "npm.cmd rebuild better-sqlite3"` | **FAIL** — xem log nguyên văn §B |
| 7 | Launch `electron.exe D:\DA` (2 lần, kill sau 12–18s) | **Process sống (không crash)** cả 2 lần; `data/parking.db` KHÔNG được tạo → DB chưa bootstrap (đúng như dự đoán khi thiếu binding); không quan sát được window trực tiếp từ sandbox (non-interactive session) nên chưa confirm bằng mắt |

## App có mở window không?

- Electron process **không crash** (còn sống sau 18s → `whenReady` + `createWindow` chạy qua).
- Nhờ fallback BE-003 trong `src/main/main.ts`: khi thiếu `dist/renderer/index.html`
  hoặc khi `openDatabase()` throw, app vẫn mở `BrowserWindow` 1280×800 với
  **trang lỗi tiếng Việt** thay vì trắng/crash.
- Dự kiến user thấy khi mở hiện tại: trang **"Không khởi động được" + lỗi
  `Could not locate the bindings file`** (thiếu better-sqlite3) — renderer đã build OK
  nên sau khi fix DB thì full UI lên ngay, không cần build lại renderer.

## URL / log bootstrap DB

- Dev DB: `./data/parking.db` (tức `D:\DA\data\parking.db`) — **chưa được tạo** (binding thiếu).
- Lần đầu mở thành công, `src/main/db.ts` tự chạy `specs/schema.sql` + `specs/seed.sql`,
  `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, startup sweep vé hết hạn.
- Tài khoản demo sau bootstrap: `admin` / `Admin@123`, `staff01` / `Staff@123`
  (**đổi password sau khi bàn giao**).

## Fix đã làm trong task này (diff nhỏ, đúng scope)

1. `src/main/main.ts` — fallback trang lỗi khi renderer/DB lỗi (không crash).
   Không đụng auth guard, IPC, envelope.
2. `tsconfig.json` — `rootDir: "."` → `"src"` (trước đây output sai ra
   `dist/src/main`, lệch `package.json` `main: dist/main/main.js`).
3. `package.json` — thêm deps renderer thiếu (`react`, `react-dom`, `vite`,
   `@vitejs/plugin-react`, `@types/react{,-dom}`) + scripts
   `dev:renderer`, `build:renderer`, `build:all`. Không đổi deps backend.
4. `src/renderer/pages/ZonesPage.tsx` (2 dòng, fix typo syntax của frontend —
   `})}` → `}))}` ở 2 block sort-header; **@frontend-react review lại**):
   thiếu 1 dấu `)` khiến `vite build` fail. Không đổi UI/logic.

## §A — Lỗi `vite build` ban đầu (đã fix)

```text
[D:/DA/src/renderer/pages/ZonesPage.tsx:253:18] Expected ")" but found "}"
```

## §B — Lỗi `npm rebuild better-sqlite3` (nguyên văn, CHƯA fix được)

```text
npm error gyp ERR! find VS could not find a version of Visual Studio 2017 or newer to use
npm error gyp ERR! find VS You need to install the latest version of Visual Studio
npm error gyp ERR! find VS including the "Desktop development with C++" workload.
npm error gyp ERR! stack Error: Could not find any Visual Studio installation to use
npm error gyp ERR! System Windows_NT 10.0.26200
npm error gyp ERR! command "C:\\Program Files\\nodejs\\node.exe" "...\\node-gyp\\bin\\node-gyp.js" "rebuild" "--release"
npm error gyp ERR! cwd D:\DA\node_modules\better-sqlite3
npm error node -v v24.22.0
```

Nguyên nhân: better-sqlite3 **luôn biên dịch từ source** (không có prebuilt);
máy này không có compiler nào (`cl.exe`/`gcc`/`clang` đều vắng mặt) và sandbox
không có quyền admin để cài Build Tools. Đã quét toàn `C:\Users` — không có
file `better_sqlite3.node` nào để tái dùng.

## Bước tiếp theo cho user (chạy local, PowerShell, **Run as Administrator** cho bước 1)

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
# 1. Cài toolchain C++ (một lần duy nhất, ~3 GB):
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"
# 2. Build binding cho đúng ABI của Electron 33 (Node 20), KHÔNG phải Node 24 hệ thống:
cmd /c "npm.cmd rebuild better-sqlite3 --no-audit --no-fund"
#    (nếu vẫn mismatch ABI khi chạy dưới Electron: npx @electron/rebuild -f -w better-sqlite3)
# 3. Kiểm tra binding:
node -e "const b=require('better-sqlite3');const d=b(':memory:');d.exec('CREATE TABLE t(a)');console.log('NATIVE OK')"
# 4. Chạy app:
cmd /c "npm.cmd run build:all"
cmd /c "npm.cmd run dev"
```

Login thử: `admin` / `Admin@123` → check-in 1 vé → preview-fee → check-out,
so khớp công thức `specs/backend-summary.md`.

## Lưu ý môi trường sandbox

- `npm`/`electron` dạng `.ps1` bị chặn bởi ExecutionPolicy → phải gọi qua
  `cmd /c "npm.cmd ..."` và gọi `electron.exe` trực tiếp. User chạy terminal
  bình thường không bị ảnh hưởng.
- Node hệ thống là **v24.22.0**; Electron 33 dùng Node 20 nội bộ → binding
  better-sqlite3 **bắt buộc** build lại dưới headers Electron (bước 2 ở trên).
