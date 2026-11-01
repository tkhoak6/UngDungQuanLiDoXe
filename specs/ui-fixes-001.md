# UI Fixes 001 — Icon / Font tiếng Việt / Scrollbar (spec cho @frontend)

> Phạm vi: fix 3 items theo yêu cầu user 16/10. Menu Electron KHÔNG thuộc spec này (task khác).
> Đọc cùng: `DESIGN.md` (§2 tokens, §10 mapping), `./specs/parking-app.md` (7 màn hình, không sửa file đó).
> Stack icon: `lucide-react` (chưa có trong `package.json` — frontend cài thêm, pin version).
> Nguyên tắc chung: spec-only, không đổi token màu/type/scale; mọi thay đổi nằm trong `index.css` + component/page liệt kê dưới đây.

---

## (a) Emoji → Lucide: bảng mapping (quét `src/renderer` ngày 16/10)

Tổng 19 điểm emoji + 3 điểm text-glyph. Quy tắc thay thế duy nhất: **text-glyph/emoji bị xóa, Lucide `<Icon/>` + text label giữ nguyên**.

### A1. Bảng mapping (file:line là vị trí hiện tại của ký tự cần thay)

| # | File:line | Ngữ cảnh | Emoji/glyph hiện tại | Lucide icon | Ghi chú |
|---|-----------|----------|----------------------|-------------|---------|
| 1 | `layout/AppShell.tsx:8` | Nav Dashboard | 📊 | `ChartColumn` (alias `BarChart3`) | nav icon |
| 2 | `layout/AppShell.tsx:9` | Nav Khu vực | 🅿️ | `SquareParking` | nav icon |
| 3 | `layout/AppShell.tsx:10` | Nav Check-in/out | 🎫 | `Ticket` | nav icon |
| 4 | `layout/AppShell.tsx:11` | Nav Vé tháng | 💳 | `CreditCard` | nav icon |
| 5 | `layout/AppShell.tsx:12` | Nav Báo cáo | 📈 | `ChartLine` (alias `TrendingUp`) | nav icon |
| 6 | `layout/AppShell.tsx:13` | Nav Sơ đồ chỗ trống | 🗺️ | `Map` | nav icon |
| 7 | `layout/AppShell.tsx:38` | Logo sidebar "BãiXe" | 🅿️ | `SquareParking` | size 20, màu Primary |
| 8 | `layout/AppShell.tsx:71` | Avatar topbar | 👤 | `CircleUserRound` | màu Text/60 |
| 9 | `pages/LoginPage.tsx:7` | Role card Admin | 🛡️ | `ShieldCheck` | size 20 |
| 10 | `pages/LoginPage.tsx:8` | Role card Nhân viên | 🧑‍💼 | `Briefcase` | size 20 |
| 11 | `pages/LoginPage.tsx:9` | Role card Khách | 👁️ | `Eye` | size 20 |
| 12 | `pages/LoginPage.tsx:95` | Toggle hiện/ẩn mật khẩu | 👁️ / 🙈 | `Eye` / `EyeOff` | toggle theo `showPw`; giữ `aria-pressed`, thêm `aria-label="Hiện mật khẩu"/"Ẩn mật khẩu"` |
| 13 | `pages/LoginPage.tsx:98` | Cảnh báo Caps-Lock | ⚠️ | `TriangleAlert` | màu Warning-strong, size 16, inline với text |
| 14 | `pages/GuestPage.tsx:95` | Logo header guest | 🅿️ | `SquareParking` | size 20, màu Primary |
| 15 | `pages/GuestPage.tsx:168` | Slot bảo trì trong grid | 🔧 | `Wrench` | size 14, màu Text/40, `aria-hidden`, slot đã có `aria-label` đầy đủ ("A1-023: bảo trì") nên icon thuần trang trí |
| 16 | `pages/ZonesPage.tsx:294` | Nút Sửa (icon-btn) | ✏️ | `Pencil` | giữ `title` + `aria-label` hiện tại |
| 17 | `pages/ZonesPage.tsx:295` | Nút Khóa/Mở (icon-btn) | 🔒 / 🔓 | `Lock` / `LockOpen` | toggle theo `is_active`; giữ `title` + `aria-label` hiện tại |
| 18 | `pages/ZonesPage.tsx:296` | Nút Xóa (icon-btn) | 🗑️ | `Trash2` | giữ `title` + `aria-label` hiện tại |
| 19 | `pages/PassesPage.tsx:266` | Nút Hủy vé (icon-btn) | 🗑️ | `Trash2` | giữ `title` + `aria-label` hiện tại |
| 20 | `pages/ZonesPage.tsx:225` | CTA "＋ Thêm khu vực" | ＋ fullwidth U+FF0B | `Plus` | icon + text "Thêm khu vực" (bỏ ký tự ＋) |
| 21 | `pages/PassesPage.tsx:215` | CTA "＋ Đăng ký vé mới" | ＋ fullwidth U+FF0B | `Plus` | icon + text "Đăng ký vé mới" (bỏ ký tự ＋) |
| 22 | `pages/ZonesPage.tsx:249,263` | Sort ▲/▼ ở header table | ▲ U+25B2 / ▼ U+25BC | `ChevronUp` / `ChevronDown` | size 14, `aria-hidden`, header đã có `aria-sort` nên icon thuần trang trí |

### A2. Quy tắc dùng icon (bắt buộc, áp cho cả 22 điểm)

1. **Package**: `lucide-react`. Import theo tên ở cột "Lucide icon".
2. **Size**: nav + button + inline text = **16px**; logo sidebar/header + role-card = **20px**; slot bảo trì + sort header = **14px**.
3. **Stroke**: `strokeWidth={2}` (mặc định Lucide, không đổi).
4. **Màu**: `currentColor` (kế thừa text) — logo/nav-active kế thừa Primary qua CSS hiện tại. KHÔNG hardcode hex trong JSX; màu chỉ từ tokens `index.css`.
5. **A11y**: mọi icon `aria-hidden="true"`. Icon KHÔNG bao giờ đứng một mình:
   - Có text kề bên → text là label (nav, CTA, role-card, caps-lock) — đủ.
   - Icon-only button (16–19, toggle password) → giữ `title` + `aria-label` đã có; toggle password bổ sung `aria-label` động theo trạng thái.
6. **Layout**: icon + label dùng `inline-flex, align-items:center, gap:6–8px`. Nav giữ cấu trúc `<span aria-hidden>{icon}</span> {label}` hiện tại ở `AppShell.tsx:47`.
7. **Cấm**: emoji mới, text-glyph thay icon (▲▼＋✓✕⋯), `font-size` để sizing icon (dùng prop `size`).
8. **Ưu tiên 2**: `NAV` array trong `AppShell.tsx:7-14` đổi field `icon: string` → component Lucide (không render string nữa).

### A3. Nghiệm thu (a)
- [ ] Grep `src/renderer` với pattern emoji không còn match (trừ comment nếu có — xóa luôn).
- [ ] 7 màn hình render đủ icon, keyboard-only pass, icon-only buttons có accessible name (check DevTools Accessibility tree).
- [ ] Không thêm màu/token mới; `npx tsc --noEmit` pass.

---

## (b) Fix font tiếng Việt mất dấu

### B1. Chẩn đoán (theo thứ tự khả năng)
1. **Fallback stack quá ngắn** (`index.css:29-30`): `--font-ui` rớt từ Plus Jakarta Sans thẳng xuống `system-ui`; `--font-mono` rớt thẳng xuống `ui-monospace, monospace`. Khi glyph dấu (ă â đ ê ô ơ ư, ộ ễ ữ…) thiếu ở font chính *ở weight đang dùng*, trình duyệt rớt sang font hệ thống không đồng bộ → cảm nhận "mất dấu / dấu xấu / lệch dòng", rõ nhất ở text mono (biển số, mã vé, tiền, timestamp — `DESIGN.md` §10.3 bắt mono cho 4 loại này).
2. **Google Fonts URL** (`index.html:9-12`): `css2?family=...&display=swap` — API tự tách `unicode-range` (kể cả `vietnamese`) theo User-Agent. Electron Chromium nhận đủ subset, **nhưng** nếu build offline/mất mạng lần đầu, font rớt hoàn toàn về fallback → lỗi chỉ tái hiện trên máy không mạng. Cần tự-host hoặc chịu fallback đẹp.
3. **Weight**: URL chỉ tải `Plus Jakarta Sans 400–800`, `JetBrains Mono 400;500;700`. Chỗ nào CSS đòi weight 900 (`.sidebar-logo` dùng 800 — đủ; kiểm tra không dùng 900 ở text Việt).

### B2. Spec fix (frontend thực hiện)
1. `index.html`: giữ URL Google Fonts, thêm `&subset=vietnamese` là **không cần** (css2 không dùng param này) — thay vào đó **xác minh** bằng DevTools → Network → font: phải thấy file `...-vietnamese-....woff2` được tải. Nếu team muốn offline-first (Electron local-first): **tự-host** 2 family (woff2 vietnamese+latin, weight như hiện tại) trong `src/renderer/assets/fonts/` + `@font-face` với `font-display: swap` và `unicode-range` đầy đủ.
2. `index.css:29-30` — mở rộng fallback (giữ font chính, thêm font phủ Việt tốt trên Win/macOS):
   - `--font-ui: 'Plus Jakarta Sans', 'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, sans-serif;`
   - `--font-mono: 'JetBrains Mono', 'Be Vietnam Pro', Consolas, 'Segoe UI', ui-monospace, monospace;`
   - (`Be Vietnam Pro` chỉ phát huy khi đã thêm vào URL Google Fonts hoặc tự-host; nếu không tự-host thì `Segoe UI`/`Consolas` của Windows đã phủ dấu Việt.)
3. Không dùng `font-weight: 900` cho text tiếng Việt trừ khi weight đó được tải/host.
4. `.input-mono` (`index.css:108`): giữ `text-transform: uppercase` — kiểm tra `Đ/đ` sau uppercase vẫn đúng (Đ → Đ, không rớt glyph).

### B3. Nghiệm thu (b) — đo được
- [ ] Chuỗi kiểm tra (paste vào 7 màn hình, zoom 100% và 200%): `Tiếng Việt có dấu: ă â đ ê ô ơ ư Ă Â Đ Ê Ô Ơ Ư — ĐỖ XE, Vé tháng, Báo cáo, Bảo trì, 51H-12345, 12.500₫, 01/10/2026 08:12` — **0 ký tự tofu (□), 0 dấu lệch/hụt**, chụp screenshot làm bằng chứng.
- [ ] Tắt mạng → reload app: text Việt vẫn đủ dấu bằng fallback (kiểm tra case offline-first).
- [ ] DevTools Network: subset vietnamese (hoặc font tự-host) được tải; không có FOUT > 300ms gây layout shift ở topbar/sidebar.

---

## (c) Fix thanh scroll ngang/dọc

### C1. Chẩn đoán (đối chiếu `index.css` + pages)
1. `.shell` và `.login-wrap` đặt `min-width: 1280px` (`index.css:140,282`) + `GuestPage.tsx:93` inline `minWidth: 1280` → cửa sổ < 1280px **page scroll ngang toàn app** thay vì co lại/collapse theo spec (`parking-app.md` §b: sidebar collapse 64px fallback).
2. `.table-wrap` có `overflow-x: auto` nhưng **không có styled scrollbar, không giới hạn chiều dọc** → table dài đẩy page scroll dọc chung với content; `th { position: sticky; top: 0 }` (`index.css:179`) dính vào viewport page thay vì khung table.
3. `.dialog` dùng `overflow: auto` 2 chiều (`index.css:197`) → dialog form dài có thể scroll ngang; `.drawer` (`index.css:292`) `overflow: auto` tương tự.
4. `.content` không có quy tắc scroll riêng → scroll page + scroll khung lồng nhau (double-scrollbar) ở Zones/Revenue (table) và Sessions (preview stack).

### C2. Spec fix (tokens hiện tại, không màu mới)
1. **Page không bao giờ scroll ngang ở ≥1280px**: giữ `min-width: 1280px` trên `.shell` (đúng spec desktop-first) NHƯNG body `overflow-x: hidden` ở breakpoint fallback; dưới 1280px sidebar collapse 64px (đã có spec §b) thay vì ép min-width. GuestPage: `minWidth: 1280` inline → chuyển vào CSS class, cùng luật collapse.
2. **Table scroll trong content, không scroll page**:
   - `.table-wrap`: `overflow-x: auto; overflow-y: auto; max-height: calc(100vh - 320px);` (trừ topbar 56 + page-head + toolbar + pager), `overscroll-behavior: contain;`
   - `th` sticky giữ nguyên (`top: 0`) nhưng sticky **trong `.table-wrap`** (có max-height thì sticky đúng khung); cột đầu sticky-left khi scroll ngang (spec §c đã yêu cầu sticky first column — frontend thêm `position: sticky; left: 0` cho cột Tên khu).
3. **Dialog/drawer**: `.dialog` → `overflow-y: auto; overflow-x: hidden;` (giữ `max-height: 90vh`); `.drawer` tương tự `overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;`.
4. **Styled scrollbar theo tokens** (áp cho `.table-wrap`, `.dialog`, `.drawer`, `.content` khi scroll):
   - `scrollbar-width: thin; scrollbar-color: var(--color-border-strong) transparent;` (Firefox)
   - Webkit: `::-webkit-scrollbar { width: 10px; height: 8px; }` `::-webkit-scrollbar-thumb { background: var(--color-border-strong); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }` `::-webkit-scrollbar-track { background: transparent; }`
   - Chỉ dùng token border/text — không màu mới. Thumb hover: `var(--color-text-40)`.
5. **Chống double-scrollbar**: tại một thời điểm, một vùng scroll duy nhất — table-scroll HOẶC page-scroll. `.content` page có table thì page không scroll dọc (table-wrap chịu); dialog/drawer mở thì body `overflow: hidden` (khóa scroll nền, đã có focus-trap trong `ui.tsx:86-135` — bổ sung scroll-lock).
6. Giữ `prefers-reduced-motion` hiện tại; scrollbar không animation nên không ảnh hưởng.

### C3. Nghiệm thu (c) — đo được
- [ ] Viewport **1280×720**: 7 màn hình **không scroll ngang page** (`document.documentElement.scrollWidth <= 1280`).
- [ ] Zones/Revenue với 50+ rows: chỉ `.table-wrap` scroll (dọc + ngang), header sticky, page đứng yên; không xuất hiện 2 scrollbar dọc cùng lúc.
- [ ] Dialog form/drawer khi content dài: scroll trong panel, `max-height: 90vh` tôn trọng, nền khóa scroll.
- [ ] Scrollbar nhìn thấy khi scroll (thumb Text/20, 8–10px), track trong suốt, đồng nhất Chrome/Electron + Firefox.
- [ ] Zoom 200%: không overlap, không scroll ngang ở content chính (table được phép scroll ngang trong khung).

---

## Ghi chú handoff cho @leader → @frontend
- Cài `lucide-react` (pin version trong `package.json`).
- Thứ tự làm: (a) icon → (c) scrollbar → (b) font (font cần verify mạng/offline cuối cùng).
- Verification tối thiểu: `npx tsc --noEmit` + checklist nghiệm thu (a)(b)(c) ở trên + screenshot chuỗi Việt + video/screenshot scroll Zones 50 rows.
- **Status: partially_verified** (spec hoàn chỉnh từ quét code thật 19 emoji + CSS hiện tại; chưa chạy app nên chẩn đoán font/scroll là từ đọc code — frontend xác nhận bằng checklist khi implement).

<!--
@designer DS-004 — verification: partially_verified
- Cover 3/3 items: (a) 19 emoji + 3 glyph → 22 mapping có file:line; (b) font: chẩn đoán 3 nguyên nhân + fix + chuỗi nghiệm thu; (c) scroll: 6 quy tắc + 5 tiêu chí đo được.
- Chưa chạy runtime (không có dev server) nên font/scroll là chẩn đoán từ code — cần frontend đối chiếu checklist.
-->

---

## QA Round 1 — @designer DS-005 (static, 16/10)

> Phương pháp: đọc `index.html` + `src/renderer/index.css` + `AppShell.tsx` + `LoginPage.tsx` + `GuestPage.tsx` + `ZonesPage.tsx` + `PassesPage.tsx` + `components/ui.tsx` + `package.json` trực tiếp; grep emoji/glyph toàn `src/renderer` (0 match). Không sửa code. Runtime (screenshot, offline, scroll 1280, zoom, keyboard) để user + Leader kiểm bằng mắt.

### (a) Icon 22 điểm — PASS ✅ (22/22)

| # | Spec mapping | Evidence | Kết quả |
|---|--------------|----------|---------|
| 1–6 | Nav Dashboard/Khu vực/Check-in/Vé tháng/Báo cáo/Sơ đồ | `AppShell.tsx:17-23` (`ChartColumn, SquareParking, Ticket, CreditCard, ChartLine, Map`), render `AppShell.tsx:59` `size={16} strokeWidth={2} aria-hidden` | PASS |
| 7 | Logo sidebar | `AppShell.tsx:49` `SquareParking size={20}` + `.sidebar-logo` màu Primary (`index.css:147`) | PASS |
| 8 | Avatar topbar | `AppShell.tsx:84` `CircleUserRound size={16}` + `color: var(--color-text-60)` | PASS |
| 9–11 | Role cards Admin/NV/Khách | `LoginPage.tsx:8-11` (`ShieldCheck, Briefcase, Eye`), render `:72` `size={20}` | PASS |
| 12 | Toggle password | `LoginPage.tsx:98-99` `Eye`/`EyeOff size={16}`, `aria-pressed={showPw}` + `aria-label` động "Hiện/Ẩn mật khẩu" | PASS |
| 13 | Caps-Lock | `LoginPage.tsx:102` `TriangleAlert size={16}` inline trong `.caps-hint` (Warning-strong, `index.css:302`) | PASS |
| 14 | Logo guest | `GuestPage.tsx:96` `SquareParking size={20}` trong `.guest-logo` (Primary, `index.css:301`) | PASS |
| 15 | Slot bảo trì | `GuestPage.tsx:169` `Wrench size={14} aria-hidden`, cell có `aria-label` đầy đủ (`:162`), màu kế thừa `.slot-maintenance` Text/40 | PASS |
| 16–18 | Zones Sửa/Khóa-Mở/Xóa | `ZonesPage.tsx:295-297` (`Pencil` / `Lock`+`LockOpen` toggle theo `is_active` / `Trash2`), giữ `title` + `aria-label` | PASS |
| 19 | Passes Hủy vé | `PassesPage.tsx:271` `Trash2`, giữ `title` + `aria-label` | PASS |
| 20–21 | CTA ＋ → Plus | `ZonesPage.tsx:226` + `PassesPage.tsx:220` `Plus size={16}` + text label, ký tự ＋ đã xóa | PASS |
| 22 | Sort ▲▼ → Chevron | `ZonesPage.tsx:250,264` `ChevronUp`/`ChevronDown size={14} aria-hidden`, `th` có `aria-sort` (`:248,262`) | PASS |

Quy tắc A2: `lucide-react` pinned exact (`package.json:21` `"1.58.0"`); size 16/20/14 đúng; `strokeWidth={2}` toàn bộ; màu `currentColor`/tokens (không hex trong JSX); mọi icon `aria-hidden="true"`; icon-only buttons có accessible name; NAV field đã đổi `string` → `LucideIcon` (`AppShell.tsx:17`); grep emoji/glyph toàn `src/renderer` = **0 match**.

### (b) Font tiếng Việt — PASS (static) ✅, runtime pending ⏳

| Kiểm tra | Evidence | Kết quả |
|----------|----------|---------|
| Fallback stack mở rộng | `index.css:29-30` khớp spec từng ký tự (`Be Vietnam Pro`, `Segoe UI`/`Consolas` xen giữa) | PASS |
| Google Fonts URL giữ + thêm Be Vietnam Pro | `index.html:10` 3 family (`Plus Jakarta Sans 400-800`, `JetBrains Mono 400;500;700`, `Be Vietnam Pro 400-700`), `display=swap` | PASS |
| Không `font-weight: 900` cho text Việt | grep `900` = 0 match; `.sidebar-logo` dùng 800 (trong dải đã tải) | PASS |
| `.input-mono` giữ uppercase | `index.css:109` | PASS |
| Chuỗi tofu / dấu lệch, zoom 100/200% | cần render thật | ⏳ user verify bằng mắt + screenshot |
| Offline reload (fallback phủ dấu) | cần tắt mạng test | ⏳ user verify bằng mắt |
| Network subset vietnamese + FOUT ≤300ms | cần DevTools | ⏳ user verify bằng mắt |

### (c) Scrollbar — PASS (static) ✅, runtime pending ⏳

| Kiểm tra | Evidence | Kết quả |
|----------|----------|---------|
| `body overflow-x: hidden`, giữ `min-width: 1280px` desktop-first | `index.css:65`, `:141` (`.shell`) | PASS |
| Collapse <1280px thay vì ép scroll ngang | `@media (max-width:1279px)` `index.css:356-365` (sidebar 64px icon-only, ẩn role/brand, `min-width: 0`) | PASS |
| Guest minWidth inline → CSS class | `GuestPage.tsx:94` dùng `.guest-root` (`index.css:300`, không min-width) | PASS |
| `.table-wrap` scroll 2 chiều + max-height + contain | `index.css:176-181` (`overflow-x/y: auto`, `max-height: calc(100vh - 320px)`, `overscroll-behavior: contain`) | PASS |
| Sticky header + sticky cột đầu trong khung | `index.css:187` (`th sticky top:0`), `:190-194` (cột đầu `sticky left:0`) | PASS |
| Dialog/drawer scroll dọc, khóa ngang, `max-height: 90vh` | `index.css:209-214` (dialog), `:311` (drawer + `overscroll-behavior: contain`) | PASS |
| Styled scrollbar tokens-only | `index.css:323-352` (Firefox `thin` + `border-strong/transparent`; Webkit 10×8px, thumb `border-strong`→hover `text-40`, track transparent) | PASS |
| Scroll-lock nền khi dialog/drawer mở | `ui.tsx:94-95,126` (Dialog), `PassesPage.tsx:92-93,100` (drawer) | PASS |
| `prefers-reduced-motion` giữ nguyên | `index.css:230-233` | PASS |
| 1280×720 không scroll ngang page; table 50 rows sticky; dialog `90vh`; thumb đồng nhất; zoom 200% | cần runtime | ⏳ user verify bằng mắt |

### Ghi chú nhỏ (không tính FAIL, ngoài scope spec)

- `DashboardPage.tsx:170` dùng ký tự `●` làm legend dot (có `aria-hidden`, thuần trang trí) — không nằm trong danh sách glyph cấm của spec (▲▼＋✓✕⋯). Đề xuất tương lai: thay bằng CSS dot như `.badge .dot`.
- `ZonesPage.tsx:318,320` dùng `‹ ›` trong label phân trang (có `aria-label` đầy đủ nên AT đọc đúng). Ngoài scope, giữ nguyên.
- `.th-sort` dùng `gap: 4px` (`index.css:260`) so với spec A2.6 `6–8px` — icon sort 14px nên 4px hợp lý về mặt thị giác, giữ nguyên.
- `npx tsc --noEmit` chưa chạy được (môi trường QA không có node/npx) — @leader/@frontend chạy khi verify FE-005.

### Verdict: PASS ✅ (static) — verification: verified

- Static 3/3 checklist: (a) 22/22 + grep 0 match; (b) 4/4 static; (c) 9/9 static.
- Residual runtime → user verify bằng mắt: screenshot chuỗi Việt (§B3), reload offline, DevTools font vietnamese, scroll Zones 50 rows ở 1280×720, dialog/drawer dài, zoom 200%, keyboard tree 7 màn hình.
