# Implementation Summary — FE-001 Phase 2 (Electron Renderer)

> Stack: **Vite + React 19 + TypeScript strict**. No Tailwind/shadcn runtime
> (no network in build env) — `src/renderer/index.css` implements the token
> system + shadcn-style primitives (`Button`, `Field`, `Badge`, `Dialog`,
> `Alert`, `SkeletonRows`, `EmptyState`, `RetryPanel`, `Toasts`) bound 1:1 to
> `DESIGN.md` tokens. All hex colours live in `index.css` `:root` only.

## Files created

| File | Purpose |
| ---- | ------- |
| `package.json` / `tsconfig.json` / `vite.config.ts` / `index.html` | Vite React-TS scaffold (Plus Jakarta Sans + JetBrains Mono via Google Fonts) |
| `src/renderer/types.ts` | Domain types verbatim from `api-contract.md` §1–10 (+ `SessionRow`/`PassRow` view models) |
| `src/renderer/index.css` | Tokens (§2+§10), shell (sidebar 240 / topbar 56 / content 1200), table, dialog, slots, login, chart |
| `src/renderer/lib/format.ts` | `formatVND` (vi-VN ₫ mono), `formatDateTime` (dd/mm/yyyy HH:mm), plate/phone helpers |
| `src/renderer/lib/fee.ts` | Display-only fee preview (≤30′→1h, ≥12h→daily cap, monthly=0) + `occupancyBucket` (85%/100%) |
| `src/renderer/lib/api.ts` | `RendererApi` UI contract + `callApi(fn, mockFallback)` + backend adapter over `window.api.invoke` + plate caches (localStorage) |
| `src/renderer/lib/mockApi.ts` | Full mock backend mirroring `seed.sql` (zones A/B/C, sessions, passes) incl. dup-plate guards |
| `src/renderer/store/auth.tsx` | `AuthProvider` — login/guest/logout, role state |
| `src/renderer/components/ui.tsx` | Shared primitives (focus-trap Dialog with Esc + focus return, toasts, skeletons) |
| `src/renderer/layout/AppShell.tsx` | Sidebar + topbar + role-filtered nav (permission matrix §11 enforced) |
| `src/renderer/App.tsx` | Root: login gate, staff→sessions default guard, global `/` focuses search |
| `src/renderer/main.tsx` | Vite entry |
| `src/renderer/pages/LoginPage.tsx` | (a) split brand/form, role radio-cards, Caps-Lock warning, show/hide pw, guest path |
| `src/renderer/pages/DashboardPage.tsx` | (b) 4 KPI `<dl>`, occupancy cards + progressbars, legend, chart + sr table, activity, 60s refresh |
| `src/renderer/pages/ZonesPage.tsx` | (c) search/type/status filter, CRUD table, 480px form (daily ≤12×hourly guard), delete guard (occupied>0 blocks), lock toggle |
| `src/renderer/pages/SessionsPage.tsx` | (d) Check-in/out tabs, plate normalize, zone filter + full-disable, monthly lookup, **fee preview receipt + live elapsed + deferred sr-only total announcer**, receipt dialog |
| `src/renderer/pages/PassesPage.tsx` | (e) search + ≤7d filter, table (+Khu vực col), detail drawer, create/renew form (zone + vehicle-type + 1/3/6/12 pack, 12T −10%), cancel-with-reason confirm |
| `src/renderer/pages/RevenuePage.tsx` | (f) range presets + custom, zone/kind filters, 3 KPI, stacked bars + sr table, grouped table + sticky totals, export progress + live announce, >90d weekly note |
| `src/renderer/pages/GuestPage.tsx` | (g) slim header + live clock, zone chips, `role="grid"` slot map (56×40, free/occupied/maintenance + `aria-label` per cell), 30s poll + manual refresh + 15s auto-retry, kiosk high-contrast toggle, all-full notice |

## State handling (per screen)

Every data screen implements **loading (skeleton, fixed heights, `aria-busy`) /
error (retry panel, Guest auto-retries with countdown) / empty (actionable
empty-state)**. Forms validate inline (12px Danger), destructive actions use
confirm dialogs, money actions always preview first. Toasts: bottom-right, 4s,
`role="status"`/`alert`, max 3.

## window.api wiring

- `callApi(backendCall, mockFallback)` — uses the **real preload bridge**
  (`window.api.invoke(channel, input)`, channels from `src/shared/types.ts`
  `ApiMap`) when present, otherwise the mock. Zero page-code changes needed
  when IPC lands — just run under Electron.
- Plate enrichment gap (for @leader → backend): `sessions:active` and
  `passes:list` return raw rows **without `license_plate`**. Adapter works
  around it via `vehicles:find` on search + a persistent plate cache
  (`remember/lookupSessionPlate`, `remember/lookupPassPlate`, localStorage).
  **Recommended backend follow-up:** include `license_plate` (JOIN vehicles)
  in `sessions:active` / `passes:list` / `sessions:history` responses.
- Mock credentials: `admin/123456` → admin, bất kỳ user nào + `123456` →
  staff, user `locked` → locked-account error, `guest` role card → guest map.

## Impeccable Polish Gate (static — no browser/node in this env)

- **critique**: 3/4 — hierarchy, tokens, states, copy all per spec; −1 for
  static demo chart bars (acceptable: real data via `reports:revenue` at runtime).
- **audit**: a11y — labels on all inputs, radiogroup/tabs/grid roles,
  progressbars with values + text fallback, chart sr-tables, focus-visible
  never removed, `prefers-reduced-motion` disables shimmer/transitions;
  contrast from darkened badge text on tints (≥4.5:1). Responsive — min
  1280 shell, tables scroll internally, cells never shrink <48×36.
- **polish fixes applied**: live-ticking elapsed in fee preview; deferred
  (non-chatter) SR fee announcer; global `/` search shortcut; guest grid
  labelled with the actually-loaded zone; pass form gained zone + vehicle-type
  (required by `passes:create`); pass table gained Khu vực column; mock login
  aligned to seed accounts; all hard-coded hex moved into tokens.

## Verification

- `grep console\.` in `src/renderer/` → **0 matches**; `any` → 0 (one comment
  hit in `src/main`, not mine); hex outside `index.css` → 0.
- `npx tsc --noEmit` / `npm install` **could not run — no Node runtime in
  this sandbox** (`node`/`npm`/`npx` not recognized). Code was reviewed for:
  strict types, `noUnusedLocals` (all imports used), `JSX.Element` type
  imports (react-jsx), no `Window.api` redeclaration conflict with preload.
- **Status: `partially_verified`** — please run before Phase 3 QA:
  `npm install && npx tsc --noEmit && npm run dev`.

## Fix Round 2 — FE-002 (post DS-002 FAIL, `./specs/design-qa-report.md` §8)

All 14 P0/P1 items fixed, tokens/style untouched (CSS additions use `var(--…)` only).

| # | Item | Fix | Files |
| - | ---- | --- | ----- |
| P0-1 | Revenue monthly missing | `monthly` composed from pass sales (`listPasses`, grouped by `start_date`, zone-aware) + `total = casual + monthly` per filter; stacked bars Primary (lượt) + Secondary (tháng) + legend; dynamic `aria-label`; sr-table per-kind; tfoot splits Vé lượt / Vé tháng | `pages/RevenuePage.tsx` |
| P0-2 | Guest SR chatter | `secondsAgo` moved out of `aria-live` (now `aria-hidden` static line); live region holds only `free/cap` + `aria-atomic` | `pages/GuestPage.tsx` |
| P1-3 | Dashboard chart hardcode | Bars = fixed hourly weights × real `todayRevenue`; dynamic label + per-hour sr-table; zero-revenue guard label | `pages/DashboardPage.tsx` |
| P1-4 | Dashboard KPI semantics | Label → "Vé tháng sắp hết hạn", counts `active && 0≤daysLeft≤7`, dynamic delta; revenue range uses `todayLocal()` | `pages/DashboardPage.tsx` |
| P1-5 | Dashboard columns flipped | Zones 2fr left, chart+activity 1fr right via new `.two-col-flip`; activity `aria-live` removed (was re-announcing every 60s) | `pages/DashboardPage.tsx`, `index.css` |
| P1-6 | Zones pagination | Footer 10/20/50 (default 10), prev/next, range text, page reset on filter change | `pages/ZonesPage.tsx`, `index.css` (`.pager`) |
| P1-7 | Zones sortable | Tên/Sức chứa/Giá giờ/Giá ngày sortable buttons + `aria-sort` on `<th>` | `pages/ZonesPage.tsx`, `index.css` (`.th-sort`) |
| P1-8 | Zones status field | Trạng thái select Hoạt động/Bảo trì ↔ `is_active` + helper note | `pages/ZonesPage.tsx` |
| P1-9 | Sessions duplicate link | Dup error (`/đã check-in/i`) shows "Chuyển sang Check-out" → `setTab('out')` + prefill lookup | `pages/SessionsPage.tsx` |
| P1-10 | Passes drawer Esc/return | Esc listener + focus close-btn on open + focus-return to trigger on close | `pages/PassesPage.tsx` |
| P1-11 | Passes row keyboard | `tr` tabIndex 0 + Enter/Space opens detail + `aria-label` per row | `pages/PassesPage.tsx` |
| P1-12 | Passes renew start | `renewStart = max(today, expiry) + 1 day`; hint text updated; "Nối tiếp từ…" kept | `pages/PassesPage.tsx` |
| P1-13 | Guest nested in shell | `safePage === 'guest'` returns chromeless `<GuestPage/>` for every role | `App.tsx` |
| P1-14 | Dialog focus trap | Tab/Shift+Tab wrap inside panel; Esc + focus-return preserved | `components/ui.tsx` |

## Verification (Round 2)

- `grep console\.log` in `src/renderer/` → **0 matches**; `any` → 0; hardcode hex in `*.tsx`/`*.ts` → 0 (tokens stay in `index.css` `:root`).
- Every screen still renders loading (skeleton + `aria-busy`) / error (retry) / empty states — untouched code paths.
- `npx tsc --noEmit` **could not run — no Node runtime in this sandbox** (`npx` not recognized). Statically reviewed: strict types kept, all new imports used, no unused locals, `JSX.Element` returns unchanged.
- **Status: `partially_verified`** — please run before Phase 3 re-QA:
  `npm install && npx tsc --noEmit && npm run dev`.

## Integration Fixes — FE-003 (post RV-001, `./specs/review-report.md` §a)

Scope: A1 (High) + A2/A3 (Medium) + A5 (Low). Only `src/renderer/` touched.
A4 (dead IPC: Users page / spot-status action / payments view) is **deferred** —
no new pages added. A6 needs no change. Guards untouched (no admin-guard relax).

| # | Item | Fix | Files |
| - | ---- | --- | ----- |
| A1 | Staff Dashboard hit admin-guarded `reports:revenue`/`reports:sessions-daily` | Dashboard loads single staff-safe `reports:dashboard` (availability + `active_sessions` + `revenue_today` + `passes_expiring_soon`); KPI occupied = `active_sessions`, revenue = `revenue_today`, expiring = server-filtered count. `revenue()` kept for RevenuePage only (admin-only, already staff-blocked in `App.tsx`) | `lib/api.ts` (+`dashboard`), `lib/mockApi.ts` (mock bundle), `pages/DashboardPage.tsx` |
| A2 | `sessions:preview-fee` never called (local-only preview) | On checkout select + discount change (350ms debounce) calls `previewFee(ticket, discount)` and renders the **server receipt** (pass/daily/hourly rows, discount, total, duration, sr announcer); `lib/fee.ts` stays as instant fallback with "tạm tính" note while loading / on error | `lib/api.ts` (+`previewFee`), `lib/mockApi.ts`, `pages/SessionsPage.tsx` |
| A3 | `CheckInInput` drift (missing `owner_name`/`owner_phone`) | Renderer type gains both optional fields (mirrors `shared/types.ts`); check-in form gains 2 optional inputs; payload sends them (empty → `undefined`); mock passes them through | `types.ts` (+`FeePreview`, `DashboardSummary`), `pages/SessionsPage.tsx` |
| A5 | Logout never clears main session; no rehydrate | `logout()` fire-and-forget `auth:logout` (renderer state clears regardless); boot `useEffect` calls `auth:me` and restores session (mock returns `null` → login screen as before) | `lib/api.ts` (+`logout`, `currentUser`), `lib/mockApi.ts`, `store/auth.tsx` |

## Verification (Round 3 — FE-003)

- `grep console\.` in `src/renderer/` → **0 matches**; `any` (`:\s*any\b|<any>|as any`) → 0; hex in `*.ts`/`*.tsx` → 0.
- `npx tsc --noEmit` → **PASS, zero errors** (ran via `npx.cmd` with Node on PATH).
- States: Dashboard keeps loading skeleton / error retry / empty; checkout receipt shows loading-fallback note, server receipt, and error-fallback note; check-in owner fields optional (no validation change).
- **Status: `verified`** (static + typecheck; runtime IPC still needs `npm run dev` per RV-001 R1).

## Blank-window fix — FE-004 (white screen under `file://`)

`vite.config.ts` gains `base: './'` so `vite build` emits relative `./assets/...`
paths; absolute `/assets/...` 404s under Electron `loadFile` (`file:///assets/...`)
leaving `#root` empty. Rebuilt renderer only (`npm run build:renderer`); main/IPC untouched.

## UI fixes — FE-005 (spec `./specs/ui-fixes-001.md`, DS-004)

Scope kept: only `src/renderer/*` + `package.json` (new dep) + `index.html`
(font URL). `src/main/*` untouched. No token/color/scale changes — all CSS
additions use `var(--…)` tokens only.

**Dep**: `lucide-react` pinned exact `"1.58.0"` in `package.json`
(`npm install lucide-react@1.58.0 --save-exact`).

| Spec | Fix | Files |
| ---- | --- | ----- |
| (a) 19 emoji + 3 glyph → 22 Lucide | `NAV` array `icon: string` → `LucideIcon` component; ChartColumn / SquareParking / Ticket / CreditCard / ChartLine / Map (nav 16px); logo SquareParking 20px; avatar CircleUserRound 16px Text/60; role-cards ShieldCheck / Briefcase / Eye 20px; toggle Eye/EyeOff 16px + dynamic `aria-label`; caps TriangleAlert 16px inline; guest logo SquareParking 20px; slot Wrench 14px `aria-hidden`; icon-btns Pencil / Lock·LockOpen / Trash2 16px; CTA Plus 16px; sort ChevronUp/Down 14px `aria-hidden`. All `aria-hidden="true"`, `strokeWidth={2}`, `currentColor` (no hex in JSX). Nav label wrapped in `.nav-label` span for collapse fallback. | `layout/AppShell.tsx`, `pages/LoginPage.tsx`, `pages/GuestPage.tsx`, `pages/ZonesPage.tsx`, `pages/PassesPage.tsx` |
| (c) scrollbar | `.table-wrap`: `overflow-x/y auto`, `max-height: calc(100vh - 320px)`, `overscroll-behavior: contain`; first column sticky-left (`th:first-child left:0 z:3`, `td:first-child sticky + surface bg z:1`); `border-collapse: separate; spacing 0` so sticky borders paint cleanly. `.dialog`/`.drawer`: `overflow-y auto + overflow-x hidden` (+ drawer `overscroll contain`). Styled scrollbar (tokens only) for `.table-wrap/.dialog/.drawer/.content` — Firefox `thin` + WebKit 10×8px thumb `border-strong`, hover `text-40`, transparent track. `body overflow-x: hidden` (page never scrolls ngang). `<1279px` fallback: `min-width: 0`, sidebar collapse 64px icon-only (logo font-size 0 keeps 20px svg, labels/role/brand hidden), content padding 16. Scroll-lock nền: `Dialog` (`components/ui.tsx`) + Passes drawer (`PassesPage.tsx`) set `body overflow hidden`, restore on unmount. GuestPage inline `minWidth: 1280` → `.guest-root` class (no min-width). Icon helpers: `.sidebar-logo` flex gap 8, `.nav-icon`, svg `flex-shrink: 0`, `.guest-logo`, `.caps-hint`. | `index.css`, `components/ui.tsx`, `pages/PassesPage.tsx`, `pages/GuestPage.tsx` |
| (b) font Việt | Fallback mở rộng: `--font-ui` + `'Be Vietnam Pro', 'Segoe UI'`; `--font-mono` + `'Be Vietnam Pro', Consolas, 'Segoe UI'`. `index.html` Google Fonts URL thêm `Be+Vietnam+Pro 400;500;600;700`. Không dùng weight 900 ở text Việt (grep 0). `.input-mono` uppercase giữ nguyên. | `index.css`, `index.html` |

### Checklist nghiệm thu (a)(b)(c)

- (a) Grep emoji/glyph trong `src/renderer` → **0 match — PASS**. `npx tsc --noEmit` PASS — icon-only buttons giữ `title` + `aria-label`, toggle password `aria-label` động. Keyboard-only + Accessibility-tree check cần runtime — **chưa chạy app (Leader giữ tiến trình dev, không restart) → PENDING, nhờ @designer Phase 3 QA trên app live**.
- (b) Chuỗi kiểm tra `Tiếng Việt có dấu: ă â đ ê ô ơ ư Ă Â Đ Ê Ô Ơ Ư — ĐỖ XE, Vé tháng, Báo cáo, Bảo trì, 51H-12345, 12.500₫, 01/10/2026 08:12` + offline reload + Network subset `vietnamese` + FOUT ≤300ms — **PENDING runtime** (cần app live; nhờ QA chụp screenshot). Static: fallback + URL + weight-900 grep 0 — PASS.
- (c) 1280×720 không scroll ngang page (`scrollWidth <= 1280`), Zones 50 rows chỉ `.table-wrap` scroll + sticky header, dialog/drawer `max-height: 90vh` + nền khóa, thumb Text/20 8–10px, zoom 200% — **PENDING runtime** (cần app live). Static: CSS rules + build output có mặt — PASS.

### Verification (FE-005)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24 via `C:\Program Files\nodejs`).
- `npm run build:renderer` → **PASS** (`dist/renderer/`, 1950 modules, js 238 kB / gzip 72 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `*.tsx`/`*.ts` → 0 (màu chỉ từ tokens).
- Không restart app theo hợp đồng (Leader giữ tiến trình dev).
- **Status: `partially_verified`** — static + typecheck + build xanh; checklist runtime (a-keyboard/tree, b-Việt/offline/Network, c-scroll/zoom) chờ Phase 3 QA trên app live sau khi Leader restart.

## Nút Trở lại Guest view — FE-006

**Vị trí đã chọn: header phải, đầu cụm action (trước clock + "Làm mới" + "Kiosk")** —
giữ logo + title trái nguyên vẹn, nút nằm cùng cụm thao tác nên dễ thấy mà
không phá layout slim header. Không thêm CSS (`.btn` đã inline-flex + gap 8;
icon Lucide `ArrowLeft` size 16, `strokeWidth={2}`, `aria-hidden`, currentColor,
không emoji — đúng quy ước ui-fixes-001).

**Hành vi 2 role** (`GuestPageProps.onBack?` + `useAuth`, không chế cơ chế mới):

| Path | Render | Bấm "Trở lại" |
| ---- | ------ | ------------- |
| role `guest` (chưa login, vào từ Login) | `<GuestPage />` (prop-less) | `logout()` → role null → màn Login/chọn vai trò |
| admin/staff mở "Sơ đồ chỗ trống" từ nav | `<GuestPage onBack={…} />` | `setPage('dashboard' \\| 'sessions')` — admin → Dashboard, staff → Check-in/out |

Nút là `<button>` native → keyboard-focusable, `aria-label="Trở lại giao diện chính"`.

**Files**: `src/renderer/pages/GuestPage.tsx` (import ArrowLeft + useAuth, prop
`onBack?`, `handleBack`, nút header), `src/renderer/App.tsx` (1 dòng: truyền
`onBack` ở nhánh `safePage === 'guest'` — nhánh role-guest giữ nguyên).
Lưu ý lệch scope: hợp đồng ghi "chỉ chạm GuestPage", nhưng hành vi
admin/staff→shell bắt buộc phải nối `setPage` từ `App.tsx` (state nav hiện có);
đây là diff 1 dòng, không đổi logic nào khác.

### Verification (FE-006)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24, PATH `C:\Program Files\nodejs`).
- `npm run build:renderer` → **PASS** (1950 modules, js 238.71 kB / gzip 72.24 kB).
- `console.*`/hex trong `GuestPage.tsx` → 0; không restart app (Leader restart).
- Nút hiện ở cả 2 role-path: kiểm tra runtime cần app live (Leader giữ tiến trình) → **PENDING QA live**.
- **Status: `partially_verified`** — static + typecheck + build xanh; nhờ QA xác nhận trên app live: (1) admin mở Sơ đồ → "Trở lại" về Dashboard; (2) staff → về Check-in/out; (3) guest thuần → về Login.

## Gỡ thẻ Admin khỏi Login — FE-007

**Phân tích routing (đã đọc `LoginPage.tsx` + `store/auth.tsx` + `App.tsx` trực tiếp):**
`loginAs(username, password)` KHÔNG gửi role-card đã chọn — role lấy từ
server (`res.data.role`, tức `UserDTO.role_name`) rồi `App.tsx` route theo
`role` thật (admin → Dashboard đầy đủ, staff bị chặn `zones`/`revenue`,
guest → chromeless `GuestPage`). State `role` trong `LoginPage` chỉ để
toggle UI guest/không-guest. Nên chỉ cần gỡ card, không sửa logic điều hướng.

**Thay đổi** (`src/renderer/pages/LoginPage.tsx` duy nhất):

- `ROLES`: xóa entry `{ id: 'admin', … }` → còn Nhân viên / Khách.
  Default `useState<RoleName>('staff')` giữ nguyên (vẫn hợp lệ).
- Xóa import `ShieldCheck` (grep 0 match còn lại) + text "Toàn quyền quản trị".
- Link "Vào xem chỗ trống (Khách)" + nhánh guest (`enterAsGuest`) giữ nguyên.

Không đụng `main/DB`, API login, auth store.

### Verification (FE-007)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24, PATH `C:\Program Files\nodejs`).
- `npm run build:renderer` → **PASS** (1950 modules, js 238.17 kB / gzip 72.04 kB).
- `console.log` trong `src/renderer/` → 0; `ShieldCheck`/`Toàn quyền quản trị` → 0.
- Không restart app (Leader restart).
- Runtime login admin/staff/guest cần app live → **PENDING QA live**.
- **Status: `partially_verified`** — static + typecheck + build xanh; nhờ QA xác nhận trên app live: (1) login tài khoản admin (không còn card Admin) vẫn vào Dashboard admin; (2) login staff vào Check-in; (3) guest link vẫn hoạt động.

## Màn Nhân viên — FE-008 (spec `./specs/users-page.md`, DS-006)

Scope giữ đúng hợp đồng: chỉ `src/renderer/*` + 1 rule CSS tokens. Không IPC mới
(dùng `users:list/create/toggle-active` có sẵn trong `ApiMap`), không nút xóa,
không màn sửa (V1: Khóa + tạo mới). Không đụng `main/DB`, không dep mới.

| File | Thay đổi |
| ---- | -------- |
| `pages/UsersPage.tsx` (mới, ~420 dòng) | Toolbar `role="search"` (search 240px + filter vai trò/trạng thái) · table username mono + badge Admin/Nhân viên + badge Hoạt động/Bị khóa + nút Khóa/Mở duy nhất (self-disabled + tag " (bạn)") · sort username/ngày tạo (`aria-sort`) · pager 10/20/50 · dialog tạo 480px (username ≥3/không dấu-khoảng trắng/dup-map, họ tên required ≤100, pw ≥6 + toggle `aria-pressed` + Caps-Lock + hint Yếu<8, confirm phải khớp mới submit, role seg mặc định staff, tạo Admin → warning inline + nút "Tạo tài khoản Admin", clear pw khỏi memory sau tạo, row flash 1s + sr `aria-live`) · dialog Khóa/Mở (guard tự-khóa + admin-cuối + `aria-describedby`, undo bar 5s) · skeleton/error-retry/empty + note "Khóa + tạo mới" · banner FORBIDDEN + "Đăng nhập lại" |
| `lib/api.ts` | `RendererApi` + backend adapter: `listUsers` / `createUser` / `toggleUserActive` |
| `lib/mockApi.ts` | Seed users (admin + staff01 active + staff02 locked) + 3 mock methods (dup → "Tên đăng nhập đã tồn tại.") |
| `layout/AppShell.tsx` | `PageKey 'users'`, nav "Nhân viên" (Lucide `Users`, admin-only, sau "Báo cáo" — cuối nhóm quản trị; repo chưa có nav "Lịch sử" riêng nên đây là vị trí tương đương), title "Nhân viên" |
| `App.tsx` | `'users'` vào `staffBlocked` (staff → Check-in/out) + toast Warning "Bạn không có quyền truy cập trang này." 4s; guest đã ép về Guest view |
| `index.css` | `.row-flash td` (token `primary-tint`, không hex mới) |

### Verification (FE-008)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24).
- `npm run build:renderer` → **PASS** (1951 modules, js 256.22 kB / gzip 76.55 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `UsersPage.tsx` → 0 (màu từ tokens).
- Logic guards đã review: tự-khóa disabled; admin-cuối disabled + Danger line; dup username map về field; FORBIDDEN → banner + logout.
- Không restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nhờ QA: (1) admin tạo staff mới + toast + row flash; (2) khóa/mở + undo 5s; (3) chặn tự-khóa + admin-cuối; (4) staff deep-link → Check-in + toast cảnh báo.

## Sửa user + đặt lại mật khẩu — FE-009 (nối BE-005 `users:update`)

Scope giữ đúng hợp đồng: chỉ `src/renderer/*`. Không đụng `main/DB`, không
hiện mật khẩu cũ (bcrypt — dialog chỉ có "Mật khẩu mới + xác nhận"), không
đổi role qua dialog này, không xóa user.

| File | Thay đổi |
| ---- | -------- |
| `lib/api.ts` | `RendererApi.updateUser(id, { username?, full_name?, new_password? })` + backend adapter gọi IPC `users:update` |
| `lib/mockApi.ts` | Mock `updateUser` tương ứng: tìm theo id, trim + check trùng username (loại trừ chính mình → "Tên đăng nhập đã tồn tại."), validate họ tên / pw ≥6, trả bản copy (không hash ở mock — login dùng seed cố định) |
| `store/auth.tsx` | Thêm `refreshProfile(fullName)` — đồng bộ tên hiển thị ở sidebar sau khi tự sửa, không bắt đăng nhập lại |
| `pages/UsersPage.tsx` | Cột Hành động thêm nút Sửa (Lucide `Pencil`, giữ Khóa/Mở) · dialog "Sửa tài khoản …" (Tên đăng nhập\* + Họ tên\* + khối "Đặt lại mật khẩu" gồm 2 ô mới/xác nhận, helper "Bỏ trống nếu không đổi — không thể xem lại mật khẩu cũ", mismatch → lỗi inline, nút Lưu disabled đến khi có field đổi + validate xanh) · chỉ gửi field đã đổi · lỗi UNIQUE map inline dưới ô username · FORBIDDEN → banner + toast · sau lưu: toast success + row flash 1s + `load()`; tự đổi username → toast ghi chú "Tên đăng nhập mới dùng từ lần đăng nhập sau" + `refreshProfile` họ tên mới; clear pw khỏi memory khi đóng/lưu · empty-state note rút gọn còn "Cần đổi vai trò? …" (đổi tên đã sửa được tại chỗ) |

### Verification (FE-009)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24, PATH `C:\Program Files\nodejs`).
- `npm run build:renderer` → **PASS** (1951 modules, js 261.50 kB / gzip 77.61 kB).
- `console.*` trong `src/renderer/` → 0; không hex mới trong JSX (màu từ tokens).
- Không restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nhờ QA: (1) Sửa họ tên → toast + row flash; (2) đổi username trùng → lỗi inline; (3) đặt mật khẩu mới + xác nhận lệch → lỗi inline, bỏ trống = giữ nguyên (login lại bằng pw mới); (4) tự đổi username → toast ghi chú + sidebar cập nhật họ tên.

## Fix ô nhập dialog Sửa tài khoản bị đơ — FE-010

**Nguyên nhân gốc**: `Dialog` (`components/ui.tsx`) có mount-effect với deps
`[onClose]`, mà mọi call-site đều truyền inline closure (identity mới mỗi
render). Mỗi ký tự gõ → `UsersPage` re-render → effect cleanup + chạy lại →
`panelRef.current?.focus()` giật focus khỏi ô input về panel → cảm giác "đơ",
không gõ/xóa được. Prefill `openEdit` vốn đã đúng (`username`/`full_name` hiện
tại); ô trống trong screenshot là do bundle `dist/renderer` cũ chưa chứa FE-009
— rebuild lần này đưa code mới vào. Lỗi "Họ tên là bắt buộc" render vô điều kiện
khi `full_name` trống nên hiện sẵn ngay khi mở dialog.

**Cách sửa** (chỉ `src/renderer/*`): (1) `Dialog` giữ `onClose` trong
`closeRef`, effect mount chạy 1 lần (`[]`) — chữa dứt điểm cho mọi dialog mà
không chạm call-site nào; (2) `UsersPage` thêm state `editTouched` (reset
`false` trong `openEdit`, set `true` ở `onBlur` ô Họ tên), span lỗi required chỉ
render khi `editTouched && editFullEmpty`. Giữ nguyên hành vi FE-009 (Lưu chỉ
gửi field đã đổi). Ghi chú cùng bệnh: dialog "Thêm nhân viên" có span required
tương tự hiện sẵn khi mở — để nguyên theo scope, sửa khi có task riêng.

### Verification (FE-010)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24, PATH `C:\Program Files\nodejs`).
- `npm run build:renderer` → **PASS** (1951 modules, js 261.59 kB / gzip 77.64 kB).
- `console.log` trong `src/renderer/` → 0; không restart app (Leader restart).
- Tự test logic (static walkthrough): mở dialog → `openEdit` prefill đúng
  username + họ tên, `editTouched=false` nên không có lỗi sẵn → gõ/xóa cập nhật
  `editForm` qua `onChange`, Dialog không còn refocus giữa chừng → xóa trắng Họ
  tên + blur → lỗi mới hiện; Lưu vẫn bị disabled đến khi dirty + validate xanh.
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime
  PENDING app live, nhờ QA: (1) mở Sửa cho `staff01` → prefill đúng 2 ô, không
  lỗi sẵn; (2) gõ/xóa bình thường cả 2 ô; (3) xóa trắng Họ tên → blur mới hiện
  lỗi; (4) Lưu khi đổi họ tên → toast + row flash như FE-009.

## Màn Nhật ký hoạt động — FE-011 (nối BE-006 `activity:list`, spec `./specs/activity-log.md`)

Scope giữ đúng hợp đồng: chỉ `src/renderer/*` (+ rebuild `dist/renderer`, không
restart app — Leader restart). Không thêm IPC, không sửa màn khác, không cột/bảng
mới. Phần lớn code lần 1 còn nguyên vẹn (page + mock + adapter + types); lần 2
nối **nav + route guard** còn thiếu, đổi export CSV → **Excel thật (.xls)**.

| File | Thay đổi |
| ---- | -------- |
| `pages/ActivityPage.tsx` (mới lần 1, sửa lần 2) | Toolbar: staff-filter (admin-only, 240px) + seg khoảng ngày (Hôm nay/7d/30d/Tùy chọn, date inputs khi custom) + action-filter (Tất cả/Check-in/Check-out/Bán vé tháng) + search 240px `role="search"` debounce 400ms (id `global-search` → `/` focus) + spacer + nút secondary "Xuất Excel" (progress % + `aria-busy`, fail → Danger toast + retry) · Table 5 cột (Thời gian mono 12 `dd/mm/yyyy HH:mm` sort `aria-sort` DESC↔ASC client-side + Nhân viên 16/medium + username mono + badge + Chi tiết vé/tiền + Ghi chú ellipsis+tooltip) · Badge 3 loại có text + icon `aria-hidden`: check-in Primary `LogIn`, check-out Success `LogOut`, pass_sale Secondary `Ticket` · Tiền/timestamp/mã mono, tiền `vi-VN ₫`, check-in vé tháng → "Vé tháng (0₫)" 12/Text-60 · Staff ép `staff_id = me.id` mọi request, **không render filter NV** · Xóa user → "— (tài khoản đã xóa)", `closed_by` null ở check-out → "— (không rõ)" · Pagination footer 20/50/100 (default 20) · Xuất Excel: **HTML-table `.xls` zero-dep** (BOM `﻿`, `application/vnd.ms-excel`), đúng filter hiện tại, limit 5000, warn >90 ngày, live region "Xuất xong: nhat_ky_YYYYMMDD.xls" · States: skeleton 8 rows `aria-busy` (giữ toolbar) / error retry + FORBIDDEN banner + "Đăng nhập lại" / 3 empty (chưa có + mở rộng 30d, không tìm thấy + xóa filter, staff-onboard) · Guard admin/staff, role khác → Danger + logout · Toasts max 3, bottom-right 4s |
| `layout/AppShell.tsx` | `PageKey 'activity'`, nav "Nhật ký" **giữa Báo cáo và Nhân viên** (cuối nhóm quản trị — repo chưa có nav "Lịch sử" riêng), roles `['admin','staff']`, title "Nhật ký hoạt động". Icon: spec `History` **không tồn tại** ở `lucide-react@1.58.0` (đã verify qua `.d.ts`) → dùng đúng fallback spec: `ScrollText` |
| `App.tsx` | Import + render `<ActivityPage/>`; `'activity'` **không** vào `staffBlocked` (staff xem mine_only) |
| `lib/api.ts` + `lib/mockApi.ts` + `types.ts` (có sẵn lần 1, giữ nguyên) | `RendererApi.listActivity` → IPC `activity:list`; mock seed 8 dòng (3 actions + user đã xóa + closer-null + monthly-session), filter staff/from/to/action/search + sort at DESC + limit/offset/total server-side |

### Verification (FE-011)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24).
- `npm run build:renderer` → **PASS** (1952 modules, js 276.84 kB / gzip 81.34 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `ActivityPage.tsx` → 0 (màu từ tokens).
- Không restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nhờ QA: (1) admin thấy nav Nhật ký giữa Báo cáo/Nhân viên, filter NV đủ 3 users; (2) staff thấy nav nhưng **không** có filter NV, chỉ thấy log mình; (3) 3 badges có text + icon; (4) Xuất Excel → mở được bằng Excel, đủ 10 cột, đúng filter; (5) empty/search/forbidden states; (6) sort Thời gian đảo ASC/DESC.

## Login/đăng ký mới — FE-012 (nối BE-007 `auth:register`, spec `./specs/auth-flow.md` DS-008)

Scope: viết lại màn Login 1 card 2 mode (link chuyển, không tabs/role-cards).
IPC login giữ nguyên; `auth:register` public (KHÔNG auto-login server —
client gọi `login(phone, password)` sau thành công). Không đụng `main/DB`,
không sửa màn khác ngoài nối routing customer tối thiểu.

| File | Thay đổi |
| ---- | -------- |
| `pages/LoginPage.tsx` (viết lại) | Xóa sạch `ROLES`/radio-cards + import `Briefcase` (grep 0); `mode: 'login'\|'register'` + link chuyển 2 chiều + `aria-live` thông báo + focus field đầu mode mới · login: Tên đăng nhập (placeholder + helper NV/SĐT) + Mật khẩu show/hide + Caps-Lock + copy lỗi spec §3 (trống/<3 ký tự/trống pw, giữ username khi lỗi server) + banner Danger `role="alert"` focus 3 case (sai pass / bị khóa phân biệt / mạng + nút Thử lại) · register: 4 fields required (`*` đỏ) — Họ tên (trim 2–50), SĐT `tel` rule `/^0\d{9}$/`, Mật khẩu ≥6 + hint, Xác nhận khớp; onBlur + onChange-xóa-lỗi; summary banner "Còn N mục cần sửa"; CTA 3 phase (Tạo → Đang tạo → Đang đăng nhập); 409 → lỗi inline dưới SĐT + nút "Đăng nhập ngay" (prefill SĐT sang login); thành công → toast Success inline "chào mừng {Tên}" + auto `loginAs(phone, pw)` → route theo role · guest link + helper giữ nguyên cả 2 mode |
| `lib/api.ts` | `AuthUser` (role +`'customer'`); `RendererApi.register({full_name, phone, password})` → IPC `auth:register` (backend adapter); `login`/`currentUser` widen role, giữ guard `guest` |
| `lib/mockApi.ts` | Mock `register` (validate SĐT/tên/pw; SĐT `0912345678` taken sẵn → 409 "SĐT đã được đăng ký — vui lòng đăng nhập"; tạo mới trả `{userId, fullName}`) + mock `login` hỗ trợ customer bằng SĐT (đúng pw → role `customer`, sai → sai-pass) |
| `types.ts` | `RoleName` +`'customer'` |
| `App.tsx` | `role === 'customer'` → chromeless `<GuestPage/>` như guest (customer không vào shell) |
| `pages/GuestPage.tsx` (tối thiểu) | `role === 'customer'` → header hiện tên khách (14/medium) + nút "Đăng xuất" (thay "Trở lại"; `logout()` về Login); guest ẩn danh + shell preview giữ nguyên |
| `layout/AppShell.tsx` | Badge +`'Khách hàng'` (exhaustive; customer không vào shell) |
| `index.css` | Xóa dead CSS `.role-cards`/`.role-card` |

### Verification (FE-012)

- `npx tsc --noEmit` → **PASS, zero errors**.
- `npm run build:renderer` → **PASS** (1952 modules, js 286.01 kB / gzip 83.50 kB).
- Grep `role-card|ROLES|Briefcase|ShieldCheck|radiogroup` trong `src/renderer/` → 0; `console.log` → 0.
- Không restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nhờ QA: (1) login staff/admin cũ + sai pass + `locked` + guest link; (2) register SĐT mới → toast chào mừng → tự vào Sơ đồ (header tên + Đăng xuất, không Trở lại); (3) register `0912345678` → lỗi inline + "Đăng nhập ngay" prefill SĐT; (4) keyboard-only + 200% zoom.

## Hồ sơ + Xe của tôi — FE-013 (nối BE-008 customer P1+P2, spec `./specs/customer-area.md`)

Scope giữ đúng hợp đồng: chỉ `src/renderer/*` (+ rebuild `dist/renderer`, không
restart app — Leader restart). Không đụng `main/DB`, không sửa flow login/register,
không màn admin/staff. P3/P4 không làm.

| File | Thay đổi |
| ---- | -------- |
| `types.ts` | `UserDTO` +`phone: string \| null` (mirror shared — SĐT read-only card); + Customer P2 types (`CustomerVehicle/VehiclesOutput`, `SessionsInput/Row/Output`) verbatim shared |
| `lib/api.ts` | `ApiResult` +`fields?: Record<string,string>` (map từ `IpcResult.errors` trong `toResult` — field error render inline, không banner); +4 methods: `myProfile` (auth:me raw), `updateProfile(id, {full_name?, new_password?, current_password?})` → IPC `users:update`, `customerVehicles()`, `customerSessions(input)` |
| `lib/mockApi.ts` | `phone: null` vào 3 seed users + `createUser`; `currentCustomerPhone` set khi login/register customer; mock `myProfile` / `updateProfile` (SĐT immutable, sai pass hiện tại → `{ok:false, fields:{current_password}}` như ValidationError BE-008) / `customerVehicles` + `customerSessions` (filter from/to/search + limit/offset/total + total_spent completed-only) + seeds: 2 xe + 7 lượt (1 đang đỗ, 1 vé tháng) cho `0912345678`, SĐT mới → trống (empty-state path) |
| `pages/ProfilePage.tsx` (mới, P1) | 2 cards dọc (max 640px, gap 24): (1) SĐT input **readOnly** mono 14 + badge "Dùng để đăng nhập" + helper "Muốn đổi số điện thoại — vui lòng ra quầy…"; họ tên validate trim ≥2/≤50 + "Lưu thay đổi" (primary); (2) 3 ô pass + show/hide `aria-pressed` + validate (≥6, khác pass hiện tại, xác nhận khớp) + summary "Còn N mục cần sửa" `role="alert"` + CTA secondary; sai pass hiện tại → inline dưới field (từ `fields.current_password`, không banner); FORBIDDEN → Danger + Đăng nhập lại; success → toast ("Đã cập nhật họ tên." / "Đổi mật khẩu thành công — phiên khác đã đăng xuất.") + `refreshProfile`; skeleton/error-retry; dirty báo cha qua `onDirtyChange` |
| `pages/MyVehiclesPage.tsx` (mới, P2 xe) | Toolbar search 240px `role="search"` (id `global-search`, `/` focus) + filter loại xe + spacer + tổng tiền mono; table 6 cột spec (Biển số mono uppercase / Loại / Khu gần nhất / Lượt gửi / Tổng tiền mono / badge Đang đỗ Primary vs Đang trống muted); row keyboard Enter/Space → drawer 360px (chi tiết + 5 lượt gần nhất, Esc + focus-return + scroll-lock); "Khu gần nhất" = frontend-join từ session mới nhất (backend P2 không trả zone — không phát minh cột); empty xe → hint SĐT + "Xem Sơ đồ" |
| `pages/MyHistoryPage.tsx` (mới, P2 lịch sử) | Reuse activity-log pattern: seg Hôm nay/7d/30d/Tùy chọn + date inputs + search debounce 400ms; table Thời gian/Mã vé/Biển số/Khu/Tiền (mono, vé tháng → "Vé tháng (0₫)", tooltip phương thức thu); footer "Tổng cộng: X lượt · Y ₫" theo đúng filter; pager 20/50/100 + warn >90 ngày; 2 empty (mở rộng 30d / xóa bộ lọc) |
| `pages/GuestPage.tsx` | Customer đăng nhập: tab row `<nav aria-label="Khu vực khách hàng">` dưới header 56px — Sơ đồ (Map) / Xe của tôi (Car) / Lịch sử (ScrollText) / Hồ sơ (CircleUserRound), `aria-current="page"` + `aria-selected`, keyboard ←/→/Home/End, guest ẩn danh + shell preview giữ nguyên (không tabs); dirty-guard rời tab Hồ sơ → Dialog "Thay đổi chưa lưu — Rời đi / Ở lại" |
| `index.css` | `.profile-col` (640px/gap 24) + `.tab[aria-current="page"]` (cùng visual selected) — tokens only |

Deviations (cho @designer QA): (1) badge xe không đỗ: spec ghi "Không có xe" — vô nghĩa trên row 1 xe → dùng **"Đang trống"** (muted); (2) "Khu gần nhất" join ở frontend từ `customer:sessions` (backend P2 không trả zone/vehicle); (3) LoginPage `classifyServerError` không map FORBIDDEN mới — ProfilePage tự check `/quyền|forbidden|đăng nhập/` tại chỗ.

### Verification (FE-013)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24).
- `npm run build:renderer` → **PASS** (1955 modules, js 315.60 kB / gzip 89.81 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `pages/*.tsx` mới → 0 (màu từ tokens).
- Icons `Map/Car/ScrollText/CircleUserRound` verify tồn tại trong `lucide-react@1.58.0` `.d.ts`.
- SĐT read-only thật (`readOnly` + `aria-readonly`, không input sửa); pass sai → inline (mock `fields.current_password` mirror BE-008 ValidationError).
- Không restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nhờ QA: (1) login `0912345678/123456` → 4 tabs, SĐT read-only + badge; (2) sửa họ tên → toast + header cập nhật tên; (3) đổi pass sai pass hiện tại → lỗi inline, đúng → toast; (4) Xe của tôi: 2 xe + chip tổng 225.000₫ + drawer; register SĐT mới → empty-state; (5) Lịch sử: filter ngày/search/pager + footer tổng; (6) rời tab Hồ sơ khi dirty → confirm dialog; (7) 200% zoom + keyboard ←/→.

## Mua vé tháng customer + duyệt pending staff — FE-014 (nối BE-009, spec `./specs/customer-area.md` P3)

Scope giữ đúng hợp đồng: chỉ `src/renderer/*` (+ rebuild `dist/renderer`, không
restart app — Leader restart). Không đụng `main/DB`, không sửa flow
`passes:create/renew/cancel` cũ, không thanh toán online. Không thêm tab "Vé tháng"
riêng (thu hẹp theo delegation: nút mua trong "Xe của tôi" + badge pending).

| File | Thay đổi |
| ---- | -------- |
| `types.ts` | `PassStatus` +`'pending'` (mirror shared — trước đó thiếu); +`CustomerPassRequestInput` / `PassConfirmInput` / `PassConfirmOutput` verbatim shared |
| `lib/api.ts` | `RendererApi` +3: `requestPass` → IPC `customer:pass-request` (thành công → lưu store local), `confirmPass` → IPC `passes:confirm` (thu `payment_method`, default cash), `myPendingPasses` (backend đọc store local — chưa có IPC list, xem deviation); + store localStorage `parking:my-pass-requests-v1` (`read/save/removeMyPassRequest`, cùng window nên staff confirm cũng dọn badge customer); `cancelPass` dọn store khi hủy pending |
| `lib/mockApi.ts` | Mock 2 IPC: `requestPass` (verify xe thuộc `currentCustomerPhone` + zone active/khớp loại + chống trùng pending/active overlap cùng scope zone + giá công thức staff `price_per_day×30`, all-zone 300k, 12T −10% + `pass_code MT-2026-03xx` + status pending) / `confirmPass` (chỉ pending: approve→active, reject→cancelled, dọn store) / `myPendingPasses` (lọc `customer_phone=me` + pending); `cancelPass` dọn store; helper `addMonths` |
| `pages/BuyPassDialog.tsx` (mới) | Dialog "Mua vé tháng — {biển số}": select khu (chỉ khu nhận đúng loại xe + "Mọi khu vực"), gói radio-cards 1/3/6/12 thật (`radiogroup`, giá mono từng gói, 12T −10%), ngày bắt đầu (default hôm nay), preview tạm tính `aria-live="polite"`, helper "Không thanh toán online — trả tiền mặt/chuyển khoản tại quầy" |
| `pages/MyVehiclesPage.tsx` | Cột 7 "Vé tháng": nút "Mua vé tháng" mỗi xe → dialog → toast "Đã gửi đăng ký {code} — mang {tiền} ra quầy…" + badge **Chờ xác nhận** (warning, có text); banner Warning info mỗi vé pending + "Hủy đăng ký" (confirm dialog → `cancelPass`); drawer thêm dòng Vé tháng (badge/Chưa có vé); `load()` thêm zones + pending (lỗi pending không chặn màn hình) |
| `pages/ProfilePage.tsx` | Card "Vé tháng đang chờ xác nhận" (list `pass_code` mono + badge + giá, read-only + hint sang tab Xe của tôi); load best-effort sau profile |
| `pages/PassesPage.tsx` | `passTone/Label`: pending → warning/**Chờ xác nhận**; toolbar select "Trạng thái" (Tất cả/Chờ xác nhận (+count)/Còn hạn/Hết hạn/Đã hủy/Tạm khóa); row pending → nút **Duyệt** (dialog xác nhận + chọn hình thức thu tiền cash/transfer/card/e_wallet → `confirmPass` approve) / **Từ chối** (dialog + lý do bắt buộc → reject); toast thu tiền số tiền; Gia hạn/Hủy giữ cho vé non-pending |

Deviations (cho @designer QA + backend follow-up): (1) không làm tab "Vé tháng" Section A/B full-spec — flow mua nằm trong "Xe của tôi" theo delegation; (2) `myPendingPasses` backend đọc store local (chưa có IPC `customer:passes` mine-only — **đề xuất BE follow-up**); (3) customer "Hủy đăng ký" gọi `passes:cancel` guard `staff` hiện tại → dưới backend thật có thể lỗi quyền (mock OK) — **đề xuất BE mở guard cho own-pending** đúng spec §P3.2; (4) badge dùng text + dot có sẵn, không thêm icon `Clock`.

### Verification (FE-014)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24).
- `npm run build:renderer` → **PASS** (1956 modules, js 329.62 kB / gzip 93.08 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `BuyPassDialog.tsx` → 0 (màu từ tokens).
- Không restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nhờ QA: (1) login `0912345678/123456` → Xe của tôi → "Mua vé tháng" xe 51H-12345 → chọn khu A + gói 3 → preview đúng `price_per_day×30×3` → Gửi → toast + badge Chờ xác nhận + banner; (2) đăng ký trùng xe → lỗi inline "đã có vé…"; (3) Hồ sơ → card vé pending; (4) staff PassesPage → lọc "Chờ xác nhận" → Duyệt (chọn Chuyển khoản) → toast thu tiền → vé thành Còn hạn; Từ chối cần lý do; (5) Hủy đăng ký customer → toast + badge mất.

## B? workaround localStorage pending passes � FE-015 (n?i BE-010 `customer:passes`)

Scope d�ng h?p d?ng: ch? `src/renderer/lib/api.ts` (+ rebuild `dist/renderer`, kh�ng restart app � Leader restart). Kh�ng d?ng `main/DB`, kh�ng s?a UI/m�n n�o, mock gi? nguy�n.

| Thay d?i | Chi ti?t |
| --- | --- |
| `backendApi.myPendingPasses` | G?i IPC th?t `customer:passes {status:'pending'}` (BE-010 mine-only) ? tr? `rows`; mock fallback (browser dev) gi? nguy�n l?c `passes[]` mine-only. Badge "Ch? x�c nh?n" ? Xe c?a t�i / H? so gi? d?c server, h?t l?ch khi staff duy?t t? m�y kh�c. |
| `requestPass` | B? `saveMyPassRequest` � kh�ng ghi store local n?a (v� m?i hi?n sau refetch `customer:passes`). |
| Store `parking:my-pass-requests-v1` | ��nh d?u DEPRECATED trong comment; helper export gi? l?i (mockApi v?n import + `cancelPass`/`confirmPass` d?n entry cu c�n s�t). H?y dang k� customer d� g?i `passes:cancel` th?t t? tru?c (BE-010 m? guard own-pending) � kh�ng d?i code. |

### Verification (FE-015)

- `npx tsc --noEmit` ? **PASS, zero errors** (Node v24).
- `npm run build:renderer` ? **PASS** (1956 modules, js 329.61 kB / gzip 93.10 kB).
- `console.*` trong `src/renderer/lib/api.ts` ? 0; kh�ng restart app (Leader restart).
- **Status: `partially_verified`** � static + typecheck + build xanh; runtime PENDING app live, nh? QA: (1) login customer ? Xe c?a t�i hi?n badge Ch? x�c nh?n t? server (kh�ng c?n dang k� m?i trong session); (2) staff duy?t ? m�n V� th�ng ? customer refetch h?t badge; (3) H?y dang k� ? toast + badge m?t (passes:cancel own-pending).

## Dat cho truoc P4 — FE-016 (noi BE-011, spec `./specs/customer-area.md` P4)

Scope giu dung hop dong: chi `src/renderer/*` (+ rebuild `dist/renderer`, KHONG restart app). KHONG dung `main/DB`, KHONG sua flow check-in cu ngoai them o ma, KHONG thanh toan/coc.

| File | Thay doi |
| ---- | -------- |
| `types.ts` | +`ReservationStatus` + `Reservation` / `CustomerReserveInput` (+alias time_from/time_to) / `CustomerReservationsInput` / `CustomerReservationRow` / `CustomerReservationsOutput` / `CustomerReserveCancelInput` (verbatim shared); `CheckInInput` +`reservation_code?` |
| `lib/api.ts` | `RendererApi` +3: `reserve` → IPC `customer:reserve`, `myReservations` → `customer:reservations`, `cancelReservation` → `customer:reserve-cancel`; `checkIn` truyen nguyen input (da gom `reservation_code`) |
| `lib/mockApi.ts` | Store `reservations[]` + 3 mock: `reserve` (validate bien so/khu/time 06-22/duration 1-4h, quota 2 pending, het cho theo khu, ma `R-YYYYMMDD-XXXX`, expires = start+20p), `myReservations` (mine-only + status/limit/offset), `cancelReservation` (chi pending); `checkIn`: ma sai → "Ma dat cho … khong dung", het hieu luc → "khong con hieu luc", sai khu → doi khu, dung → consume pending→completed; `spotMap`: 1 o demo `reserved` ngay sau day occupied |
| `pages/MyReservationsPage.tsx` (moi) | Form: Khu (chi active + disable het cho) + preview "Con X cho" live + Ngay read-only (helper V1) + Tu/Den `time` 06–22 + Bien so; validate inline tung field; quota client chan mem (disable CTA + Warning note) truoc server; success panel `role="status"` (ma mono 24 + focus + Copy + Huy) + toast; "Giu cho cua toi": cards (ma mono + khu + gio + countdown "Het han sau Np" tick 30s, `aria-live` off + text tinh "Het han luc HH:mm") + badge Giu cho Success / Sap het Warning ≤15p / Da dung-Het han-Da huy muted + Huy (Dialog confirm) / Dat lai (prefill); poll 60s; skeleton/error-retry/empty |
| `pages/GuestPage.tsx` | `reserved` → label "dang giu cho" + class `slot-reserved` (Warning) + legend "dang giu" (KHONG lan maintenance); tab moi "Dat cho" (`Bookmark`) + render `MyReservationsPage` |
| `pages/SessionsPage.tsx` | Check-in form + o "Ma dat cho (neu co)" mono optional (hint dung o giu) → truyen `reservation_code` (trong → `undefined`); loi ma sai hien inline tu server (`inError` Alert co san); clear sau success |
| `index.css` | `.slot-reserved` (Warning tokens) — khong hex moi |

Deviations (cho @designer QA): (1) badge card pending dung text + dot co san (khong icon Clock rieng — nhat quan P3); (2) countdown tick 30s (spec goi y 60s) cho muot, poll refetch van 60s; (3) mock `spot_number: null` (giu theo khu, backend that auto-pick o).

### Verification (FE-016)

- `npx tsc --noEmit` → **PASS, zero errors** (Node v24).
- `npm run build:renderer` → **PASS** (1957 modules, js 343.68 kB / gzip 97.29 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `MyReservationsPage.tsx` → 0.
- Icon `Bookmark` verify ton tai trong `lucide-react@1.58.0` `.d.ts`.
- Khong restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nho QA: (1) login `0912345678/123456` → tab Dat cho: chon khu + gio + bien so → Giu → success panel ma R-… + Copy + toast; (2) giu den 2 ve → CTA disable + note quota; (3) Huy → Dialog → toast + badge mat; (4) So do: o `reserved` Vang "dang giu" + legend 4 muc, khong lan bao tri; (5) staff Check-in nhap ma R-… sai → loi inline, dung → thanh cong + ve giu → Da dung; (6) countdown + poll 60s; (7) 200% zoom + keyboard-only.

## Ho so nhan vien S1 — FE-017 (noi BE-012, spec `./specs/staff-area.md` S1)

Scope dung hop dong: chi `src/renderer/*` (+ rebuild `dist/renderer`, KHONG restart app). KHONG dung main/DB, KHONG S2/S3/S4, KHONG sua flow khac.

| File | Thay doi |
| ---- | -------- |
| `types.ts` | `UserDTO` +`address/start_date` (required `\| null`) + `notes?` (optional — admin-only, session/login khong bao gio co); +`StaffSelfProfile` (KHONG notes) + `StaffProfileUpdateInput` (`phone?/address?`) verbatim shared |
| `lib/api.ts` | `updateUser` patch +`phone/address/start_date/notes`; +`staffProfile()` → IPC `users:profile`, `updateStaffProfile()` → `users:profile:update` |
| `lib/mockApi.ts` | Seed 3 users co S1 fields (admin co notes; staff01 co phone/address/start_date; staff02 null); `updateUser` validate S1 (SĐT `^0\d{9}$` + unique → inline `fields.phone`, address ≤255, start_date `YYYY-MM-DD` ≤ today, notes ≤500, rong → NULL); mock `staffProfile` (strip notes) + `updateStaffProfile` (chi 2 field, trung SĐT → inline, rong → "Khong co gi de cap nhat"); `createUser`/`customerProfile` them field moi |
| `pages/UsersPage.tsx` | + cot SDT (mono 14, null → "—") sau Ho ten; click row / nut Eye → drawer; dialog Sua mo rong 520%-style (wide 640px reuse): 2-col grid SDT + Ngay vao lam (`date` + `max=today`) + Dia chi + Ghi chu (`textarea` 3 rows + counter `/500`); validate inline + SĐT trung → inline duoi o SDT; chi gui field doi |
| `pages/StaffDrawer.tsx` (moi) | Drawer ho so 400px phai (`drawer-400`): header Ho ten 20 + badge Vai tro/Trang thai + "(ban)"; sections Lien he (username mono, SDT mono + `tel:` link + `aria-label`, dia chi) / Cong viec (ngay vao lam `dd/mm/yyyy`, tham nien auto, trang thai) / Ghi chu noi bo (**chi khi `showNotes` — staff an ca section**); footer Sua ho so + Khoa/Mo (admin) / note "lien he quan ly" (staff); Esc + focus-return + scroll-lock; `inline` mode render card tinh (khong overlay) cho trang Ho so cua toi |
| `pages/StaffProfilePage.tsx` (moi) | Route "Ho so cua toi" (admin + staff, role khac → Danger + Dang nhap lai): card ho so inline read-only (KHONG field notes) + card "Tu cap nhat SDT / Dia chi" (validate nhu admin, trung SDT → inline); note V1 "doi ho ten/username/start_date → lien he quan ly"; skeleton/error-retry/FORBIDDEN states; success → toast |
| `layout/AppShell.tsx` | `PageKey 'profile'`, nav "Ho so cua toi" (Lucide `IdCard`, roles admin+staff, sau Nhan vien), title |
| `App.tsx` | `'profile'` KHONG vao `staffBlocked` (staff duoc xem); render `<StaffProfilePage/>` |
| `index.css` | `.drawer-400 { width: 400px }` — tokens only |

Deviations (cho @designer QA): (1) dialog edit dung `dialog-wide` 640px san co thay vi 520px spec (1 pattern dialog, tranh them class); (2) row click mo drawer + nut Eye (them keyboard: hien chi Eye focusable — row khong tabIndex); (3) mock `staffProfile` lay staff01 (id 2) co dinh (browser dev khong co session).

### Verification (FE-017)

- `npx tsc --noEmit` → **PASS, zero errors**.
- `npm run build:renderer` → **PASS** (1959 modules, js 360.42 kB / gzip 101.52 kB).
- `console.*` trong 5 file cham → 0; hex trong `StaffDrawer/StaffProfilePage.tsx` → 0.
- Staff UI khong co field notes: `StaffProfilePage` chi match `showNotes={false}` + comment (grep `notes` → 2 dong, khong render); `StaffSelfProfile` type khong co notes.
- Khong restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nho QA: (1) admin Nhan vien thay cot SDT + click row/Eye → drawer 400px du Lien he/Cong viec/Ghi chu + footer Sua/Khoa; (2) dialog Sua: doi SDT sai → inline, trung SDT staff khac → inline "SĐT đã được dùng", start_date tuong lai → chan, notes counter /500; (3) staff nav "Ho so cua toi" → khong thay section Ghi chu, tu sua SDT/dia chi → toast, doi field khac → note lien he quan ly; (4) 200% zoom drawer scroll + Esc dong + focus-return.

## Tab Hieu suat — FE-018 (spec `./specs/staff-area.md` S2)

Scope dung hop dong: chi `src/renderer/*` (+ rebuild `dist/renderer`, KHONG restart app). KHONG API moi, KHONG rank staff cheo (V1 staff chi thay so minh), KHONG sua tab Nhat ky hien tai (detail giu nguyen 100% — chi an/hien theo tab).

| File | Thay doi |
| ---- | -------- |
| `pages/ActivityPerf.tsx` (moi) | `aggregateActivity(rows)` (group theo `user_id`, null → key `deleted` gom 1 dong cuoi; doanh thu = `SUM(amount ?? 0)` — check-in null/0 tu nhien khong double-count) + component `ActivityPerf`: fetch `listActivity({staff_id, from, to, limit: 5000})` 1 lan (KHONG action/search — chi dung filter khoang ngay + nhan vien dung chung) → 3 cards (doanh thu mono 24 `vi-VN ₫` / check-in / ve thang) + admin: bang xep hang (rank `#N` text + badge "Top 1" + Secondary tint khi sort Doanh thu DESC, sort moi cot `aria-sort`, user xoa gom dong cuoi khong rank, note `*Tỉ lệ chốt vé = pass_sale / check_in`) + mini bar CSS-only (track `primary-tint`, fill `primary`, `aria-hidden`, gia tri van la text day du) + staff: chi 3 cards + note "V1 chua co xep hang"; cap: `total > rows.length` → Warning tran 5000 + thu hep khoang; `from > to` → Danger inline, khong fetch; states skeleton 3 cards + 5 rows / error-retry / empty + "Mo rong 30 ngay" |
| `pages/ActivityPage.tsx` | Tabs `Chi tiết`/`Hiệu suất` (`role=tablist/tab` + `aria-selected` + arrow-key ←/→, reuse `.tabs/.tab`) tren toolbar; toolbar hien tai giu nguyen — staff-filter + range dung chung 2 tab, action/search/Xuat Excel + warn >90d chi hien tab Chi tiet; detail load skip khi tab perf (khong request thua); perf render trong `role=tabpanel` voi `staffId` ep mine_only cho staff nhu tab cu |
| `lib/mockApi.ts` | `listActivity` tran `min(limit,100)` → `min(limit,5000)` (backend that co the gioi han thap hon — component da hien note khi `total > rows.length`) |

Deviations (cho @designer QA): (1) tab Perf KHONG ke thua action-filter/search (delegation chi yeu cau "filter khoang ngay dung chung" — giu action/search o tab Chi tiet de tranh so lieu 0 mot cach kho hieu); (2) bar chart la list rieng duoi bang thay vi cot trong bang (doc + responsive tot hon, SR doc table day du); (3) `onExpandRange` cua empty perf luon goi `applyRange('30d')`.

### Verification (FE-018)

- `npx tsc --noEmit` → **PASS, zero errors**.
- `npm run build:renderer` → **PASS** (1960 modules, js 369.04 kB / gzip 103.49 kB).
- `console.*` trong `src/renderer/` → 0; hex trong `ActivityPerf.tsx` → 0 (mau tu tokens).
- Staff khong thay so nguoi khac: tab perf staff khong render table/rank, fetch ep `staff_id = me.id` (backend mine_only enforce them); mock filter `staff_id` nen staff chi nhan rows cua minh.
- Khong restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nho QA: (1) admin tab Hieu suat: 3 cards dung so + bang rank sort Doanh thu DESC + Top-1 highlight + bar ti le + note ti le chot ve; (2) staff tab Hieu suat: chi 3 cards so cua minh + note, KHONG thay table/rank/so nguoi khac; (3) tabs keyboard ←/→ + `aria-selected`; (4) doi khoang ngay/date custom → ca 2 tab cung cap nhat; (5) sort tung cot + dong "tai khoan da xoa" cuoi; (6) 200% zoom cards xep doc khong vo.

## Man Cham cong S3 � FE-019 (noi BE-013, spec `./specs/staff-area.md` S3)

Scope dung hop dong: chi `src/renderer/*` (+ rebuild `dist/renderer`, KHONG restart app). KHONG dung main/DB, KHONG sua man khac, KHONG cham ho (UI khong gui `staff_id` o check-in/out), KHONG ep overlap ca (Warning only).

Quyetchon nav (ghi ro theo hop dong): nav rieng "Cham cong" (Lucide `CalendarClock`, sau Nhat ky, truoc Nhan vien � cuoi nhom quan tri), staff + admin thay; KHONG dat card trong Dashboard staff (ca truc la luong doc lap, can khong gian table + dialog + tab admin).

| File | Thay doi |
| ---- | -------- |
| `types.ts` | + S3 types verbatim shared: `ShiftCode/AttendanceStatus/Shift/Attendance/AttendanceRow/AttendanceCheckInInput/AttendanceCheckOutInput/AttendanceListInput/AttendanceListOutput/AttendanceCheckOutOutput/AttendanceTodayOutput/ShiftUpdateInput` |
| `lib/api.ts` | `RendererApi` +6 + backend adapter: `listShifts/updateShift/attendanceToday/checkInShift/checkOutShift/listAttendance` (check-in/out KHONG gui `staff_id` � comment tai cho) |
| `lib/mockApi.ts` | `currentStaffId` (set luc mock login admin?1/staff?2, default 2) + seeds shifts 3 ca + 3 rows (1 ca dem qua con treo ? demo banner "chot bu") + 6 mock mirror BE-013: auto ca theo gio tuong, `work_date` = ngay bat dau (dem + t<end ? hom qua), UNIQUE(user,shift,date) ? "Ban da vao ca nay.", status late >10p, chot ca treo gan nhat, revenue mock = 0 (variance demo = closing - opening); `updateShift` validate HH:mm + start?end (overlap backend tra trong message � `ApiResult` khong co kenh message nen page tu tinh Warning client-side, mock chi luu) |
| `lib/attendance.ts` (moi, 39 dong) | Helpers dung chung page + table: `attendanceShiftDate/fmtHM/elapsedHM/fmtSigned/isForbiddenError` |
| `pages/AttendancePage.tsx` (moi, 399 dong) | The ca hien tai (ten + khung gio + ngay work_date, badge Chua vao ca / Dang truc `Xh Ym` live tick 60s `aria-live` / Da chot ca, nut Vao/Ra context, dong "Da chot ca" disabled) + banner pending_close ("chot bu" mo dialog checkout � backend tu chot row treo) + banner ket qua chot ca (revenue + variance: khop Success / lech Warning �X? + "da ghi nhan, khong chan" / chua nhap closing Warning) + `AttendanceTable` + dialogs; staff ep `staff_id = me.id` moi request, admin filter optional; FORBIDDEN ? Danger + Dang nhap lai; skeleton/error-retry/empty |
| `pages/AttendanceTable.tsx` (moi) | Toolbar (staff-filter admin-only + seg H�m nay/7d/30d/Tuy chon + date custom + filter present/late/missing client-side) + table Ngay\|NV(admin)\|Ca\|Vao\|Ra\|Gio truc\|Dau ca\|Cuoi ca\|Chenh lech\|Trang thai (tien/timestamp mono, chenh lech = cuoi-dau: `khop` Success khi 0, so signed con lai + footnote "doi soat tru thu trong ca hien ngay sau khi chot ca") + pager 10/20/50 + note tran 200 + user xoa "� (tai khoan da xoa)" |
| `pages/AttendanceDialogs.tsx` (moi) | `CheckInDialog` (opening_cash, trong = 0, note "Ket ban giao: X?" prefill closing ca truoc gan nhat, validate integer =0) + `CheckOutDialog` (closing_cash trong = NULL + note "chot gio ra, tien NULL", handover `textarea` counter /500, tam tinh cuoi-dau live + note "chua tru thu trong ca") |
| `pages/AttendanceShifts.tsx` (moi, admin tab "Dinh nghia ca") | Table 3 ca (ten/gio/badge Mo/Tat + note "ca dem cho phep end<start") + dialog edit (ten/start/end `time` + checkbox mo ca): validate HH:mm + start?end, overlap vs ca dang mo khac ? Warning "khung gio trung voi {name} � van luu duoc, khong chan" (mirror BE-013 Warning khong chan) |
| `layout/AppShell.tsx` | `PageKey 'attendance'`, nav "Cham cong" (`CalendarClock`, roles admin+staff, sau Nhat ky), title |
| `App.tsx` | Render `<AttendancePage/>`; `'attendance'` KHONG vao `staffBlocked` (staff mine_only) |

Deviations (cho @designer QA + backend follow-up): (1) table "Chenh lech" = cuoi - dau (tien ket), KHONG phai variance that (can revenue/window server-side � backend chi tra revenue+variance trong response check-out, `attendance:list` khong co) ? doi soat that hien o banner ket qua + toast; neu muon cot variance that can BE bo sung revenue per row; (2) chenh lech ?0 hien text mono thuong (KHONG Danger) vi closing>opening la binh thuong khi thu tien mat � Danger chi dung cho doi soat lech that o banner; (3) dialog Vao ca luon auto ca hien tai (khong chon ca khac � dung quy uoc BE-013); (4) mock `updateShift` khong echo message overlap (ApiResult khong co kenh message) � page tu tinh Warning client-side, backend that message day du hon.

### Verification (FE-019)

- `npx tsc --noEmit` ? **PASS, zero errors**.
- `npm run build:renderer` ? **PASS** (1965 modules, js 398.17 kB / gzip 110.68 kB).
- `console.*` trong `src/renderer/` ? 0; hex trong `Attendance*.tsx` ? 0 (mau tu tokens).
- Staff khong cham ho: grep `checkInShift(`/`checkOutShift(` chi truyen `{opening_cash}` / `{closing_cash, handover_note}` � KHONG `staff_id`; `staff_id` chi xuat hien o `listAttendance` (filter mine_only/admin, dung contract) + comments.
- Moi file <400 dong (Page 399 / Table 230 / Dialogs 138 / Shifts 238 / lib 39).
- Khong restart app (Leader restart).
- **Status: `partially_verified`** � static + typecheck + build xanh; runtime PENDING app live, nho QA: (1) staff nav "Cham cong": the ca hien tai + Vao ca (prefill ket ban giao) ? badge Dang truc live; Ra ca (nhap closing + note) ? banner doi soat khop/lech Warning; (2) mo lai app khi con ca treo ? banner "chot bu"; (3) trung ca (Vao 2 lan) ? loi inline "Ban da vao ca nay."; (4) admin: filter NV + loc trang thai + tab Dinh nghia ca ? sua gio trung ? Warning van luu; (5) staff KHONG thay filter NV / tab Dinh nghia ca / so nguoi khac; (6) 200% zoom + keyboard-only + Esc dong dialog. Xem FE-020.

## Phan quyen chi tiet S4 — FE-020 (noi BE-014, spec `./specs/staff-area.md` S4)

Scope dung hop dong: chi `src/renderer/*` (+ rebuild `dist/renderer`, KHONG restart app, KHONG dung main/DB, KHONG doi guard, KHONG sua flow khac).

| File | Thay doi |
| ---- | -------- |
| `types.ts` | + S4 verbatim shared: `StaffPermissionKey/StaffPermissions/STAFF_DEFAULTS/StaffPermissionsInput`; `UserDTO` +`permissions: string\|null` (raw) + `perms: StaffPermissions` (resolved — frontend chi dung `perms`) |
| `lib/perms.ts` (moi) | `PERM_KEYS/META` (5 label + mo ta VN) + 3 presets (Full / Thu ngan co ban / Chi xem) + `parsePermRaw` + `resolvePerms` + `hasNoPerms` + `friendlyPermError` (strip `(NO_PERMISSION:<key>)` → cau Viet than thien) |
| `lib/api.ts` | `AuthUser` +`perms`; `updateUser` patch +`permissions?`; `login/currentUser` map `perms`; `toResult` map moi message qua `friendlyPermError`; +`meFull()` (auth:me raw → refresh sau khi admin sua quyen) |
| `lib/mockApi.ts` | Seed +`permissions:null/perms:full`; `login` tra perms; `updateUser` mirror BE-014 (whitelist, null → reset NULL, admin bo qua); guards `mockRequirePerm` cho checkIn/checkOut/previewFee / passes* / listActivity/dashboard / updateStaffProfile; +`meFull` mock |
| `store/auth.tsx` | `AuthState` +`perms` (null → hien nhu full); `loginAs`/rehydrate set perms; +`refreshMe()` |
| `layout/AppShell.tsx` | NAV +`perm?`: sessions→checkin, passes→pass_sale, activity→report_self; staff mat flag → mat menu; admin thay het |
| `App.tsx` | `PAGE_PERM` deep-link guard → bounce + toast dung label; staff mat HET quyen → empty-state S4.4 |
| `pages/UsersPage.tsx` | Dialog Sua: section "Quyen han" chi khi sua staff khac; 5 switch + badge "Mac dinh full" + presets + "Khoi phuc mac dinh" (reset NULL) + Warning khi tat + `aria-live` + loi inline; toast "Da cap nhat quyen cho {username}."; `updated.id===userId` → `refreshMe()` |
| `pages/StaffProfilePage.tsx` | Mat `profile_self` → khoa card Tu cap nhat (xem GET luon duoc) |
| `pages/SessionsPage.tsx` | Mat `reservation` → an o ma giu cho + Warning (khong gui code) |
| `index.css` | `.switch` + `.perm-row` — tokens only |

Deviations (cho @designer QA): (1) `report_self` an ca Nhat ky (BE-014 guard chung activity:list); `attendance` khong an (giu guard cu); `reservation` an o ma trong Check-in (khong nav rieng); `profile_self` chi khoa card sua. (2) Preset "Thu ngan co ban" = checkin+pass_sale+reservation+profile_self; "Chi xem" = chi report_self.

### Verification (FE-020)

- `npx tsc --noEmit` → **PASS, zero errors**.
- `npm run build:renderer` → **PASS** (1967 modules, js 406.71 kB / gzip 113.36 kB).
- `console.*` trong `src/renderer/` → 0; hex trong JSX moi → 0.
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nho QA: (1) admin Sua staff → 5 switch + badge Mac dinh full → tat pass_sale → Warning + Luu → toast quyen; (2) staff login lai → mat menu Ve thang, deep-link bounce + toast; (3) 403 Viet khong raw key; (4) tat het flags → empty-state; (5) Ho so khoa card khi mat profile_self; Check-in an o ma khi mat reservation; (6) keyboard switch + zoom 200%.

## Quan ly M1-M3 — FE-021 (noi BE-015, spec `./specs/management-area.md`)

Scope dung hop dong: chi `src/renderer/*` (+ rebuild `dist/renderer`, KHONG restart app). KHONG dung main/DB, KHONG sua man khac ngoai mo rong can thiet (gia inline-edit o Khu vuc), KHONG bang audit (P2).

Quyetchon nav (ghi ro theo hop dong): nav rieng "Quan ly" (Lucide `Settings2`, sau Bao cao, truoc Nhat ky — cuoi nhom quan tri), admin-only; staff KHONG thay nav (App bounce ve Check-in/Dashboard + toast "Ban khong co quyen truy cap trang nay." 4s, cung pattern Nhan vien DS-006). Tab state trong URL query (`?tab=reports|config|safety`, `history.replaceState`) cho deep-link + back-button.

| File | Thay doi |
| ---- | -------- |
| `types.ts` | + M1/M2/M3 verbatim shared: `TxKind/TxListInput/TxRow/TxListOutput`, `ParkingSettings/AppConfigSetInput`, `BackupNowInput/Output`, `RestoreFromFileInput/Output` |
| `lib/management.ts` (moi, 149 dong) | `shiftDate/daySpanDays/defaultPrevPeriod` (ky B = lien truoc cung do dai) + `periodsOverlap` + `deltaPct` + `composeAggregate/summarizeAgg` (tai dung 2 views §10 + pass sales, cung rule RevenuePage) + settings cache `parking.settings.v1`/`parking:last-backup-v1` (`DEFAULT_SETTINGS` grace 30/threshold 12) + `downloadXls` zero-dep + `TX_KIND_LABEL` |
| `lib/management-export.ts` (moi, 85 dong) | `exportTransactionsXls` (loop offset chunk 200, cap 10.000 dong, progress that) + `openSummaryPrint` (print window KPI + aggregate + phu luc toi da 500 dong + note "xem Excel de du N dong") + `METHOD_LABEL` |
| `lib/api.ts` | `RendererApi` +5 + backend adapter: `listTransactions/getAppConfig/setAppConfig/backupNow/restoreFromFile` (restore KHONG nhan binary — main mo open-dialog) |
| `lib/mockApi.ts` | 5 mock mirror BE-015: `listTransactions` (seed ~180 rows Oct-2026 casual/monthly/adjust × zones A/B/C, filter ngay/zone/kind/method/search, ORDER DESC, limit 50/max 200 + summary; `from>to` → chan) + `get/setAppConfig` (validate lot_name/address/phone/logo PNG-JPG ≤512KB/grace 0–120/threshold 1–24 + cross-rule threshold×60>grace + ma INVALID_PHONE/LOGO_TOO_LARGE/INVALID_FEE_RULE) + `backupNow` (path + size gia) + `restoreFromFile` (chan HAS_PARKED_VEHICLES khi con xe do → needRestart:true); seed settings lot "Bai giu xe Nga Tu" |
| `pages/ManagementReports.tsx` (386) + `ManagementReportDetail.tsx` (109) | M1: seg granularity Ngay/Tuan/Thang/Nam + period kep (ky A presets + custom, toggle So sanh + ky B default lien truoc) + multi-select khu (fieldset checkboxes, bo chon het = tat ca + note) + loai ve/phuong thuc/search + seg Tong hop/Chi tiet · 5 KPI (tong DT + 3 Δ% vs ky B badge Success/Danger + mui ten + sub-line "Ky B: X" + ty trong ve luot/thang) + chart grouped A dac/B nhat 240px + legend 4 muc + sr-label tom tat · Detail table 9 cot spec (TG mono + sort DESC/ASC `aria-sort` + GD-XXXXXX + badge loai + NV + "(da xoa)" + note ellipsis) + pager 50/100 · Validation: from>to → Danger + disable xuat; B overlap A → Warning; granularity Nam + span>3 nam → Warning; xuat disable khi total=0 · Partial: ky B fail → chart A + badge Warning "Khong tai duoc ky so sanh — Thu lai" (retry B) · Excel/PDf nhu lib · States skeleton/error-retry/empty + "Xoa bo loc" |
| `pages/ManagementConfig.tsx` (317) + `ManagementConfigPrices.tsx` (127) | M2: 4 cards max-width 720 — (1) Gia theo khu: click gia → input mono + Enter luu/Esc huy, PD<PH → confirm lan 2; (2) Khung ca: read-only 3 ca + "Quan ly khung ca →" deep-link sang Cham cong tab Dinh nghia ca; (3) Quy tac phi: 2 number inputs + preview dong + note Warning scope + confirm + "Khoi phuc mac dinh" + dirty-guard; (4) Thong tin bai: ten*/dia chi (counter /255)/SDT + logo PNG-JPG ≤512KB (preview 96px + xoa) + preview header hoa don mini + luu + saved_at · Success toast neu ro scope "ap dung ve moi tu bay gio" · Dirty-guard roi tab → Dialog confirm |
| `pages/ManagementSafety.tsx` (338) | M3: (1) Sao luu: trang thai last + badge Auto-03:00/Chua sao luu + progress + note USB + Warning banner khi chua backup lan nao + live region; (2) Khoi phuc danger-zone: file picker `.db` → metadata mono + checkbox ghi de + type-to-confirm ten bai (case-sensitive) + chan khi con xe do (`dashboard.active_sessions`, khong ngoai le) + confirm 2 buoc + overlay `alertdialog` khong-Esc + restart-required (nut duy nhat "Khoi dong lai ngay") + map loi NOT_SQLITE/INTEGRITY_FAIL/SCHEMA_MISMATCH; (3) Nhat ky he thong: reuse `activity:list` table 4 cot + badge + "(tai khoan da xoa)" + pager 20 + empty + FORBIDDEN → banner + Dang nhap lai |
| `pages/ManagementPage.tsx` (126) | Shell: guard admin-only (lop 2 sau App bounce) + tabs `role=tablist` + arrow-key + `?tab=` + dirty-guard roi tab Config |
| `pages/ZonesPage.tsx` | M2.1 mo rong: cot Gia gio/Gia ngay thanh nut inline-edit (Enter/Esc, PD<PH → Dialog confirm, toast scope "ap dung ve moi tu bay gio") — tai dung `updateZone` hien co, khong IPC moi |
| `layout/AppShell.tsx` | `PageKey 'management'`, nav "Quan ly" (`Settings2`, admin-only, sau Bao cao truoc Nhat ky), title |
| `App.tsx` | `PAGE_PERM.management = null` + `'management'` vao `staffBlocked` + render `<ManagementPage onNavigate={setPage}/>` |

Deviations (cho @designer QA): (1) Excel 1 sheet (summary title + detail rows) thay vi 2 sheets — .xls zero-dep HTML-table khong tao multi-sheet sach; du lieu du (summary trong title + full detail). (2) PDF mo print-window thay vi render PDF nhi phan — zero-dep, user chon "Luu thanh PDF". (3) Confirm ghi de gom checkbox + type-ten-bai trong 1 dialog 2 buoc (tom tat → restoring overlay), khong tach 2 dialog rieng. (4) `granularity` gui len IPC (accepted) nhung tab Tong hop van dung 2 views §10 (backend luon tra detail — dung contract BE-015). (5) Row-click drawer o tab Chi tiet bo qua (spec cho phep PASS).

### Verification (FE-021)

- `npx tsc --noEmit` → **PASS, zero errors**.
- `npm run build:renderer` → **PASS** (1975 modules, js 455.52 kB / gzip 127.05 kB).
- `console.*` trong `src/renderer/` → 0; hex trong pages/lib moi → 0 (mau tu tokens).
- Moi file <400 dong (Reports 386 / Config 317 / Safety 338 / Page 126 / Detail 109 / export 85 / management 149 / Prices 127); ZonesPage diff ~70 dong.
- Restore confirm ghi de ro rang: checkbox bat buoc + type-to-confirm khop case-sensitive + block khi con xe do + overlay khong-Esc + loi tieng Viet theo ma BE-015.
- Khong restart app (Leader restart).
- **Status: `partially_verified`** — static + typecheck + build xanh; runtime PENDING app live, nho QA: (1) admin nav Quan ly giua Bao cao/Nhat ky, 3 tabs + `?tab=` deep-link + arrow-key; (2) staff khong thay nav, deep-link → Check-in + toast; (3) M1: doi ky B → chi chart + Δ skeleton, tat server ky B → badge Thu lai giu ky A; xuat Excel 10k cap + PDF phu luc 500; (4) M2: inline gia Enter/Esc + confirm PD<PH + deep-link ca + luu quy tac/site + logo >512KB bi tu choi + dirty-guard; (5) M3: backup → last update + toast; restore thieu checkbox/type sai → disable, con xe do → chan, xong → man restart; (6) 200% zoom + keyboard-only.
