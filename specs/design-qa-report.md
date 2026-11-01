# Design QA Report — DS-002 Phase 3 (Electron Renderer vs Specs)

**Baseline**: `DESIGN.md` §2+§10 · `./specs/parking-app.md` (a–g + cross-screen) · `./specs/implementation-summary.md`
**Scope reviewed**: `src/renderer/index.css`, `layout/AppShell.tsx`, `components/ui.tsx`, `App.tsx`, `lib/format.ts`, all 7 pages
**Method**: static code review (no browser/Node runtime in sandbox) — tokens, layout, states, responsive, a11y, copy
**Verdict tổng**: ❌ **FAIL** — 2×P0 + 11×P1 cần @frontend-react sửa vòng 2 (chi tiết §8). Không có lỗi crash/data-loss; toàn bộ fix ước tính 1 vòng.

---

## 1. Cross-screen rules

| Rule | Verdict | Evidence |
| ---- | ------- | -------- |
| Currency vi-VN ₫ mono, thousands sep | ✅ PASS | `lib/format.ts:3-5` `formatVND`; `.mono` dùng xuyên suốt money/plate/time |
| Date dd/mm/yyyy HH:mm | ✅ PASS | `lib/format.ts:7-18` `formatDateTime`/`formatDateShort` |
| Toast bottom-right 4s, role status/alert, max 3 | ✅ PASS | `components/ui.tsx:119-129` (`slice(-3)`, role đúng), `index.css:205` |
| Destructive = confirm | ✅ PASS | Zones delete `ZonesPage.tsx:279-292`; Passes cancel `PassesPage.tsx:307-323` |
| Money = preview trước confirm | ✅ PASS | Sessions fee preview `SessionsPage.tsx:279-301`; Passes total preview `PassesPage.tsx:297-299` |
| `/` focus search | ✅ PASS | `App.tsx:19-32` → `#global-search` (mỗi page 1 instance, không trùng lúc mount) |
| `Ctrl+K` command palette | ❌ FAIL (P2) | Không implement ở đâu — chấp nhận defer, nhưng là rule §4 trong spec |
| `Esc` đóng topmost + focus return | ⚠️ PARTIAL (P1) | Dialog: ✅ `ui.tsx:93-101`. **Drawer vé tháng: ❌ không có Esc handler** (`PassesPage.tsx:233-245`, nút ghi "Đóng (Esc)" nhưng không bắt phím) |
| Dialog focus trap | ❌ FAIL (P1) | `ui.tsx:86-111` chỉ focus panel + Esc + return focus — **Tab thoát khỏi panel**, spec yêu cầu focus trap |
| 200% zoom / keyboard-only pass live | ⏸️ NOT VERIFIED (static) | Cần kiểm tra runtime vòng 2 |

## 2. Tokens & CSS nền (`index.css`)

| Check | Verdict | Evidence |
| ----- | ------- | -------- |
| Hex tập trung `:root`, đúng 6 token + mapping §10 | ✅ PASS | `index.css:4-52` (success-strong/warning-strong/danger-strong cho contrast ≥4.5:1) |
| Sidebar 240 / topbar 56 / content 1200+24 | ✅ PASS | `index.css:48-50,140-166` |
| Focus-visible 2px Primary offset 2px | ⚠️ PARTIAL (P2) | `index.css:70-74` ✅; nhưng `.input:focus` (`103-107`) `outline:none` cho **mọi** focus → keyboard chỉ còn border+ring (vi phạm "never remove outline" theo chữ). Khuyến nghị: chỉ bỏ outline khi `:focus:not(:focus-visible)` |
| Motion 150–250ms + `prefers-reduced-motion` | ✅ PASS | `index.css:215-218` |
| Off-palette nits (P2) | ⚠️ | `.btn-primary:hover #0f63d8` (`:86`), skeleton `#e6eaf1` (`:211`) — token hóa thành `--color-primary-hover` / dùng `--color-border` |

## 3. Per-screen checklist

### (a) Login — ✅ PASS (1×P2)
- Split brand 480 Primary + form 400 ✅ (`index.css:265-269`, `LoginPage.tsx:42-53`); copy Việt đúng ("Tên đăng nhập/Mật khẩu/Vai trò", "Sai tài khoản…", giữ username khi lỗi ✅ `:38` không clear state).
- Radio-cards `radiogroup`+`radio`+`aria-checked` ✅ (`:59-74`); show/hide pw `aria-pressed`+label ✅ (`:94`); Caps-Lock Warning ✅ (`:98`); error `role="alert"` ✅ (`:76` via `Alert`); loading disabled+`aria-busy` ✅ (`:101`); guest 2 đường ✅ (`:104-113`).
- P2: radio-cards thiếu arrow-key nav (chỉ Tab/click); `login-wrap min-width:1280` ép scroll thay vì stack brand→64px header như spec khi windowed.

### (b) Dashboard — ❌ FAIL (3×P1)
- KPI `<dl>` + mono money + legend 4 trạng thái + skeleton/error/empty-onboard ✅ (`DashboardPage.tsx:88-96,98-103,54-77`).
- **P1-1**: chart là **số liệu tĩnh** `[35,80,…]` + `aria-label` **hardcode** "4,2 triệu, cao điểm 8–9h" (`:108-112`) → SR đọc sai khi doanh thu thật khác. Fix: bind bars + label từ `todayRevenue`/API.
- **P1-2**: KPI "Vé tháng" đếm **mọi pass active**, delta hardcode "1 vé hết hạn ≤ 7 ngày" (`:36,83`) → sai ngữ nghĩa spec ("Vé tháng sắp hết hạn"). Fix: lọc `daysLeft 0–7` + delta động.
- **P1-3**: layout cột **đảo ngược** spec — impl chart ở cột hẹp trái, zones+activity cột rộng phải (`:105-160` + `.two-col 1fr 2fr`); spec: zones trái 2 phần, chart+activity phải 1 phần.
- P2: `aria-live="polite"` trên cả `<ul>` activity (`:149`) → announce mỗi lần refresh 60s (spec: chỉ announce khi vượt ngưỡng sắp hết/đầy); zone card chưa click→detail.

### (c) Zones — ❌ FAIL (3×P1)
- Toolbar/search-240/2 filter/CTA, table đủ cột, mono, badge đúng mapping, icon-btn 32px có label, form 480 + helper "≤12×" + validate inline + submit-disabled, delete-guard block khi occupancy>0 + `aria-describedby`, skeleton 8/error/retry/empty-xóa-lọc ✅ (`ZonesPage.tsx:174-245,247-292`).
- **P1-4**: **thiếu pagination footer** (10/20/50) — render toàn bộ rows.
- **P1-5**: headers không sortable, không `aria-sort` (spec yêu cầu).
- **P1-6**: form **không có control Trạng thái** Hoạt động/Bảo trì (spec §c bắt buộc) — `FormState.is_active` tồn tại (`:18`) nhưng không render input nào → không thể đưa khu vào bảo trì từ UI.
- P2: thiếu sticky first-column; segmented "Loại xe" dùng `role="group"` thay vì radiogroup; lock-toggle toast không có Undo (spec 5s; cross-rule 4s — giữ 4s + thêm nút Hoàn tác).

### (d) Sessions — ⚠️ PASS có điều kiện (1×P1 + 3×P2)
- Tabs `tablist`/`tab`/`aria-selected` ✅ (`:175-178`); plate mono auto-uppercase + hint ✅ (`:184`); zone lọc loại xe + "còn X" + full disabled ✅ (`:192-201`); vé tháng reveal mã ✅; note 2 rows ✅; checkout lookup/list/chọn/discount/pay-method/CTA ✅; fee preview lines + total 24 mono + elapsed + sr-announcer deferred ✅ (`:279-301`); receipt dialog `aria-label="Hóa đơn"` ✅; CTA `aria-disabled`+tooltip ✅ (`:216`).
- **P1-7**: lỗi duplicate check-in chỉ hiện banner chung — **thiếu link "Chuyển sang Check-out"** như spec ("Biển số đã check-in lúc 08:12 tại A1" + link).
- P2: tabs thiếu arrow-key nav; option đầy chỉ suffix "(ĐẦY)" text, thiếu tag Danger; checkout empty thiếu gợi ý check-in; receipt dialog focus panel thay vì auto-focus nút "In vé"; thiếu offline Warning banner (local-first).

### (e) Passes — ❌ FAIL (2×P1)
- Toolbar + lọc ≤7d + CTA; table đủ 7 cột **gồm Khu vực** ✅; mono; badge text (never color-only) ✅; cancel-confirm Danger + reason + describedby ✅; form packs 1/3/6/12 + "−10%" + date picker + hint + total preview `aria-live` ✅; phone lỗi kèm VD ✅; empty đôi ✅ (`PassesPage.tsx:176-231,247-323`).
- **P1-8**: **drawer không Esc/focus-return** (`:233-245`) dù nút ghi "Đóng (Esc)".
- **P1-9**: **`<tr onClick>` không keyboard-operable** (`:214`, không tabIndex/role/key handler) — SR + keyboard không mở được chi tiết.
- P1-10 (logic): renew `startDate = p.end_date` (`:124`) — vé hết hạn lâu → start rơi vào quá khứ; spec: `max(today, expiry+1day)`. Duplicate plate+zone guard chỉ trông chờ backend error, thiếu inline Warning chủ động.

### (f) Revenue — ❌ FAIL (1×P0 + 1×P1)
- Presets + custom native dates + zone/kind filter + 2 export CTA ✅; 3 KPI mono ✅; tfoot `scope="row"` ✅; sr-table chart ✅; export `%`+`aria-busy`+live announce+toast tên file ✅; `>90d` Warning ✅; empty + "Mở rộng 30 ngày" ✅ (`RevenuePage.tsx:124-254`).
- **P0-1 (sai số tiền)**: `cur.monthly` **không bao giờ được cộng** + `cur.total` loại hẳn monthly khi filter (`:79-80`) → cột "Vé tháng" luôn 0, tổng thiếu doanh thu vé tháng. Chart cũng chỉ vẽ 1 màu Primary, không stacked Primary+Secondary như spec.
- **P1-11**: footer totals không sticky; export thiếu determinate progress-bar visual (chỉ % text); custom-range dùng native inputs thay vì calendar dialog (chấp nhận được về a11y — giữ nguyên, không bắt buộc sửa).

### (g) Guest — ❌ FAIL (1×P0 + 1×P1)
- Slim header 56 + clock live + note 30s + refresh spinner + kiosk toggle ✅; chips `aria-pressed` ✅; grid/gridcell + `aria-label` từng ô + `aria-disabled` + roving tabindex ✅; slot 56×40 gap 8 + hatched maintenance + 🔧 ✅; legend ✅; 30s poll + pause-hidden + auto-retry 15s countdown ✅; all-full notice ✅; footer hint ✅ (`GuestPage.tsx:92-186`).
- **P0-2 (a11y chatter)**: `secondsAgo` tick **mỗi giây nằm TRONG** vùng `aria-live="polite"` (`:175-177`) → SR announce "Cập nhật Ns trước" liên tục. Fix: tách timer ra khỏi live region, chỉ announce khi `totals.free` đổi.
- **P1-12**: admin/staff mở "Sơ đồ chỗ trống" render `GuestPage` **lồng trong `AppShell`** (`App.tsx:52`) → sidebar + double topbar, vi phạm "no sidebar". Fix: render Guest standalone (như role guest `:39`) hoặc prop `chromeless`.
- P2: error dùng `RetryPanel` neutral thay vì Warning banner; thiếu per-zone strip "Khu A1 đã đầy"; chips thiếu arrow-nav.

## 4. Shell & điều hướng (`AppShell.tsx`, `App.tsx`)
- Sidebar/nav `aria-current`, role badge, staff-guard (`zones`/`revenue` → `sessions`), staff landing sessions, guest standalone ✅ (`AppShell.tsx:31-78`, `App.tsx:34-44`).
- Ngoại trừ P1-12 (guest lồng shell), shell khớp spec (logo/nav 14/role badge 12; topbar title 20 — search/avatar per-page, chấp nhận).

## 5. Copy tiếng Việt
✅ PASS toàn diện — labels, errors actionable ("SĐT chưa đúng — VD 0901234567", "Còn 12 xe… chuyển xe trước khi xóa", "Nối tiếp từ…"), không còn placeholder Anh ngữ. Chỉ cần sửa 2 text hardcode Dashboard (P1-1, P1-2).

## 6. Trạng thái verification
- **QA static: `verified`** — đủ 7 màn + cross-screen (currency/date/toast/confirm-destructive/preview-money).
- **Runtime chưa verify** (không có browser/Node trong sandbox): keyboard-only pass, 200% zoom, đo contrast thực, `npm install && npx tsc --noEmit && npm run dev` (frontend đã báo `partially_verified`). @leader chạy trước khi delivery.

## 7. Verdict
❌ **FAIL** — chặn delivery cho tới khi P0 + P1 vòng 2 xong. Không P0 crash/mất dữ liệu; mọi fix nằm trong `src/renderer/`, không chạm DB/IPC.

## 8. Fix list vòng 2 cho @frontend-react (ưu tiên)

**P0 (bắt buộc):**
1. `RevenuePage.tsx:76-89` — cộng `monthly` vào `cur.monthly`/`cur.total` đúng filter; vẽ stacked bars Primary (lượt) + Secondary (tháng).
2. `GuestPage.tsx:175-177` — tách `secondsAgo` khỏi `aria-live`; live region chỉ chứa `totals.free/cap` và chỉ đổi text khi count đổi.

**P1 (bắt buộc):**
3. `DashboardPage.tsx:108-112` — bind bars + `aria-label` từ dữ liệu thật (bỏ hardcode "4,2 triệu").
4. `DashboardPage.tsx:36,83` — KPI vé tháng = lọc `daysLeft 0–7`, delta động ("X vé hết hạn ≤ 7 ngày").
5. `DashboardPage.tsx:105` — đảo 2 cột đúng spec (zones 2fr trái, chart+activity 1fr phải).
6. `ZonesPage.tsx` — thêm pagination footer (10/20/50, default 10).
7. `ZonesPage.tsx:203-212` — sortable headers + `aria-sort`.
8. `ZonesPage.tsx:247-276` — thêm field Trạng thái (Hoạt động/Bảo trì) vào form (map `is_active`).
9. `SessionsPage.tsx:handleCheckIn` error path — duplicate-guard banner + nút "Chuyển sang Check-out" (setTab('out') + prefill lookup).
10. `PassesPage.tsx:233-245` — drawer: Esc đóng + focus-return trigger (tái dùng pattern `Dialog`).
11. `PassesPage.tsx:214` — rows keyboard-operable (tabIndex 0 + Enter/Space mở detail, role="button" hoặc chuyển sang nút "Chi tiết").
12. `PassesPage.tsx:124` — renew start = `max(today, expiry+1day)` + giữ note "Nối tiếp từ…".
13. `App.tsx:52` — Guest cho admin/staff render standalone (no shell), không lồng `AppShell`.
14. `components/ui.tsx:86-111` — Dialog focus trap (giữ Tab trong panel).

**P2 (nên làm nếu còn budget):** Ctrl+K palette; offline banner Sessions; undo toast lock-toggle; sticky totals Revenue + export progress-bar; auto-focus "In vé"; arrow-key nav (role-cards/tabs/chips); per-zone full strip Guest + Warning-tone error; token hóa `#0f63d8`/`#e6eaf1`; input outline chỉ bỏ khi `:focus:not(:focus-visible)`; fonts fallback offline.

---

## 9. Re-QA Round 2 — DS-003 (sau FE-002, static code review)

**Baseline so sánh**: §8 (2×P0 + 12×P1 FAIL) · Code mới `src/renderer/` · `./specs/implementation-summary.md` § Fix Round 2
**Method**: static review từng item vs evidence file:line (không có browser/Node runtime trong sandbox — runtime keyboard/zoom/contrast vẫn NOT VERIFIED, giữ như §6).
**Stuck check**: kết quả KHÁC vòng trước (14/14 có thay đổi code đúng hướng) → có progress, không stuck.

| # | Item §8 | Verdict | Evidence |
| - | ------- | ------- | -------- |
| P0-1 | Revenue monthly missing | ✅ PASS | `RevenuePage.tsx:80-110` monthly từ `listPasses` (skip cancelled, filter from/to + zone), `total = casual + monthly`; stacked bars Primary+Secondary + legend `:225-234`; dynamic `aria-label` `:225`; sr-table per-kind `:241-248`; tfoot split Vé lượt/Vé tháng `:280-281` |
| P0-2 | Guest SR chatter | ✅ PASS | `GuestPage.tsx:175-180` live region chỉ `free/cap` + `aria-atomic="true"`; `secondsAgo` tách ra dòng riêng `aria-hidden="true"` — không còn tick/giây trong live region |
| P1-1 (§8 #3) | Dashboard chart hardcode | ✅ PASS | `DashboardPage.tsx:12,98-103` weights × `todayRevenue` thật + `chartLabel` động + zero-guard "Chưa có doanh thu"; sr-table per-hour `:161-168`. Không còn hardcode "4,2 triệu" |
| P1-2 (§8 #4) | Dashboard KPI semantics | ✅ PASS | `:41-46` lọc `active && 0≤daysLeft≤7`; `:93` label "Vé tháng sắp hết hạn"; delta động "X vé hết hạn ≤ 7 ngày"; revenue dùng `todayLocal()` `:24` |
| P1-3 (§8 #5) | Dashboard columns flipped | ✅ PASS | `:124` `.two-col-flip`; `index.css:230` `2fr 1fr` (zones trái rộng, chart+activity phải hẹp) + responsive stack; `aria-live` trên activity `<ul>` đã gỡ (`:172` không còn) |
| P1-4 (§8 #6) | Zones pagination | ✅ PASS | `:306-321` footer `.pager` 10/20/50 default 10, prev/next, range text "Hiển thị X–Y / N khu", `aria-live` trang; reset page khi filter đổi `:95`; CSS `.pager` `index.css:235-241` |
| P1-5 (§8 #7) | Zones sortable | ✅ PASS | `:241-267` 4 cột sortable (Tên/Sức chứa/Giá giờ/Giá ngày) buttons `.th-sort` + `aria-sort` trên `<th>` + `toggleSort`/`sortProps` `:97-111`; CSS `.th-sort` `index.css:242` |
| P1-6 (§8 #8) | Zones status field | ✅ PASS | `:348-361` select `#zone-status` Hoạt động/Bảo trì ↔ `is_active` + hint "Xe đang đỗ giữ nguyên…"; `openEdit` prefill `:132`, `handleSave` gửi `is_active` `:164` |
| P1-7 (§8 #9) | Sessions duplicate link | ✅ PASS | `:30,131,192-203` regex `/đã check-in/i` → `setDupPlate`; banner Danger + nút "Chuyển sang Check-out" → `setTab('out')` + prefill `lookup` |
| P1-8 (§8 #10) | Passes drawer Esc/return | ✅ PASS | `:83-98` Esc listener + focus close-btn khi mở (`drawerCloseRef`) + focus-return trigger khi đóng; nút vẫn ghi "Đóng (Esc)" `:285` — giờ đúng hành vi |
| P1-9 (§8 #11) | Passes row keyboard | ✅ PASS | `:245-256` `tr tabIndex={0}` + `onKeyDown` Enter/Space mở detail + `aria-label` per row; actions cell `stopPropagation` `:264`. P2-nâng-cao (không chặn): cân nhắc `role="button"` hoặc nút "Chi tiết" riêng |
| P1-10 (§8 #12) | Passes renew start | ✅ PASS | `:43-46` `renewStart = max(today,expiry)+1day`; dùng ở `openRenew` `:155`; giữ "Nối tiếp từ…" `:292`; hint cập nhật `:338` |
| P1-11 (§8 #13) | Guest nested in shell | ✅ PASS | `App.tsx:46` `safePage === 'guest'` → return `<GuestPage/>` chromeless cho mọi role, không lồng `AppShell` |
| P1-12 (§8 #14) | Dialog focus trap | ✅ PASS | `ui.tsx:99-118` Tab/Shift+Tab wrap first↔last trong panel, empty-panel guard; Esc + focus-return giữ nguyên `:93-96,121-124` |

**Verdict tổng Round 2**: ✅ **PASS** — 2/2 P0 + 12/12 P1 đạt. Không còn residual P0/P1. P2 defer nguyên như §8 (không chặn delivery).
**Runtime residual (không chặn, @leader chạy trước delivery)**: `npm install && npx tsc --noEmit && npm run dev` + keyboard-only pass + 200% zoom + đo contrast thực (giữ từ §6 — frontend báo `partially_verified` cả 2 vòng do sandbox thiếu Node).
**Verification**: `verified` (static, đủ 14/14 items).
