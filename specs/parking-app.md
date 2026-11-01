# Parking App — Design Spec (Desktop / Electron, min 1280px)

> Tokens: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (plate/money/time). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Status mapping: see `DESIGN.md` §10. Specs only — no code.

**Global shell (Admin + Nhân viên):** sidebar 240px fixed (logo 24 + nav 14/medium + role badge 12 at bottom), topbar 56px (page title 20/semibold left; search 14 + shift info + avatar right), content max 1200px with 24px gutters, page title 24/semibold + description 14 + primary CTA right-aligned. Focus-visible everywhere: 2px solid Primary, offset 2px. All dialogs: overlay `rgba(17,24,39,0.45)`, panel Surface radius 12, width 480 (form) / 640 (confirm+preview), Esc closes, focus trap, return focus to trigger.

---

## (a) Login + chọn vai trò

**Layout:** centered split — left brand panel 480px (Primary `#1677FF` solid bg, white 32/bold app name + 16 feature bullets + version 12), right form panel 400px (Surface). Single window, no sidebar/topbar.
**Components:** username + password inputs (label 14/medium above, height 40, radius 8, border Text/20, focus border Primary + 3px ring `rgba(22,119,255,0.18)`); role radio-cards (3 options: Admin / Nhân viên / Khách — icon + 16/semibold + 12 description, selected = 2px Primary border + tint bg); Button primary full-width height 44 "Đăng nhập"; "Vào xem chỗ trống (Khách)" text-button below.
**States:** loading → button spinner + disabled + `aria-busy`; error → Danger banner 14 with icon ("Sai tài khoản hoặc mật khẩu", `role="alert"`, keep typed username); empty → inline hints under fields 12/Danger; Caps-Lock warning 12/Warning on password; Guest path skips password (button "Tiếp tục với vai trò Khách").
**Copy:** labels "Tên đăng nhập", "Mật khẩu", "Vai trò". Errors actionable: "Tài khoản bị khóa — liên hệ Admin."
**Responsive:** min 1280 — fixed two-column; below 1280 (windowed) stack brand panel to 64px header bar. No mobile target.
**A11y:** `<label for>` each input; `aria-describedby` for hints; radio-cards as real `radiogroup`; password show/hide toggle with `aria-pressed`; full keyboard flow Tab/Enter; contrast Text-on-Surface 16.7:1, white-on-Primary 4.6:1 (bold ≥14 only).

## (b) Dashboard tổng quan

**Layout:** row 1 — 4 KPI cards (Chỗ trống hiện tại, Xe đang đỗ, Doanh thu hôm nay, Vé tháng sắp hết hạn): card Surface, radius 12, padding 16, label 12/uppercase-ish (13/medium, Text/60), value 32/bold (mono for money), delta 12 with Success/Danger dot. Row 2 — grid 2:1: left zone occupancy cards per khu (name 16/semibold + progress bar + "còn X/Y" 14/mono + status banner if ≥85% Warning / 100% Danger), right revenue mini-chart panel + recent activity list (8 rows, time mono 12). Legend row (Success=trống, Primary=đang đỗ, Warning=sắp hết, Danger=đầy) above zone grid, 12px.
**Components:** KPI Card, Zone Card (click → Khu vực detail), Bar/Line chart (revenue by hour, Primary line, grid Text/10), Activity item (dot + text 14 + time 12/mono).
**States:** loading → skeleton cards (shimmer, `aria-busy`, no layout shift — fixed heights); error → panel-level retry card with Danger icon + "Tải lại" button; empty (new install, no zones) → onboard empty-state (illustration-free, 20/semibold "Chưa có khu vực nào" + CTA "Tạo khu vực đầu tiên" → opens (c) form).
**Responsive:** 1280: KPI 4-col (each ~270px); <1280 not supported — horizontal scroll locked, sidebar collapses to 64px icons with tooltips as fallback.
**A11y:** KPI values as `<dl>`; progress bars `role="progressbar"` + `aria-valuenow` + text fallback "còn X/Y"; chart has adjacent visually-hidden data table + `aria-label` summary ("Doanh thu hôm nay 4,2 triệu, cao điểm 8–9h"); auto-refresh 60s paused when tab hidden, announced via `aria-live="polite"` only on threshold cross (sắp hết/đầy).

## (c) Quản lý khu vực (CRUD table + form)

**Layout:** toolbar row (search input 240px + filter dropdown loại xe + filter dropdown trạng thái + spacer + Button primary "＋ Thêm khu vực"). Table full-width: columns Tên khu (16/medium) | Sức chứa (mono, "120") | Loại xe (badge: ô tô=Primary tint, xe máy=Secondary tint) | Giá giờ (mono) | Giá ngày (mono) | Trạng thái (badge Success/Warning/Danger/Text per §10) | Hành động (Sửa / Khóa-Mở / Xóa icon-buttons 32px). Pagination footer 14 (10/20/50 per page).
**Form (dialog 480px):** fields Tên khu* (text), Sức chứa* (number stepper, min 1 max 2000), Loại xe* (segmented radio ô tô/xe máy), Giá giờ* + Giá ngày* (currency inputs, mono, suffix "₫", helper 12 "Giá ngày nên ≤ 12× giá giờ"), Trạng thái (select: Hoạt động/Bảo trì). Footer: Hủy (neutral) + Lưu (primary). Delete → confirm dialog 480px (Danger title "Xóa khu A1?", body shows active-vehicle guard: if occupancy >0, block delete with Warning "Còn 12 xe đang đỗ — chuyển xe trước khi xóa").
**States:** loading → table skeleton 8 rows; error → inline row banner + retry; empty search → empty-state "Không tìm thấy khu vực" + "Xóa bộ lọc" button; form validation inline 12/Danger under field, submit disabled until valid; optimistic lock toggle with undo toast 5s.
**Responsive:** table min-width 960, horizontal scroll inside content (sticky first column + sticky header); dialog centered, max-height 90vh scroll.
**A11y:** table uses `<th scope>` + sortable headers with `aria-sort`; search has `role="search"` + label; number/currency inputs `inputmode="numeric"` + `<label>`; destructive action requires confirm + `aria-describedby` guard text; Esc cancels, focus returns to row action.

## (d) Check-in / Check-out (form biển số + chọn khu + tính phí preview)

**Layout (Nhân viên default landing):** two-column: left form 480px, right live preview receipt 360px (Surface, radius 12, dashed separator, mono amounts). Tabs at top: [Check-in | Check-out] segmented 16 (role default tab = Check-in). Left fields: Biển số* (mono, uppercase auto, mask hint "VD 51H-12345", 12 helper + duplicate guard), Khu vực* (select filtered to compatible loại xe + còn chỗ; shows "còn X" per option; full zones disabled with Danger tag), Loại vé (radio: Vé lượt / Vé tháng — vé tháng reveals Mã vé input with lookup), Ghi chú (optional textarea 2 rows). Right preview: zone, entry time (auto now, mono), elapsed (live ticking), fee breakdown (giờ × đơn giá + ngày cap), total 24/bold mono, "Thu phí & Check-out" primary CTA disabled until valid.
**Fee logic display:** rule line 12 — "≤30 phút đầu: làm tròn 1 giờ. Qua đêm: áp giá ngày." Overtime beyond ngày cap rolls to next tier; shown as line items.
**States:** loading → preview skeleton + CTA spinner; error → Danger banner (e.g. "Biển số đã check-in lúc 08:12 tại A1" with link "Chuyển sang Check-out"); empty checkout search → "Không tìm thấy xe đang đỗ" + suggest check-in; print success → toast Success + "In vé" secondary action (dialog receipt, auto-focus Print button); offline (Electron local-first) → Warning banner "Mất kết nối — giao dịch lưu本地, sẽ đồng bộ" with queued count.
**Responsive:** 1280: side-by-side; narrower window: preview stacks below form (single column scroll).
**A11y:** tabs as `tablist` with arrow-key nav; plate input `autocomplete="off"`, `aria-describedby` format hint; fee total `aria-live="polite"` (announce only on change, debounced 1s to avoid chatter); CTA shows disabled reason via `aria-disabled` + tooltip; receipt dialog `role="dialog"` + `aria-label="Hóa đơn"`.

## (e) Vé tháng (CRUD + gia hạn)

**Layout:** toolbar (search by plate/name + filter Hết hạn ≤7 ngày + CTA "＋ Đăng ký vé mới"). Table: Mã vé (mono) | Chủ xe 16 | Biển số (mono) | Khu vực | Hiệu lực (date range mono 12, "01/10 → 31/10") | Trạng thái badge (Còn hạn=Success, Sắp hết=Warning, Hết hạn=Danger) | Hành động (Gia hạn / Sửa / Hủy). Row click → detail drawer 360px right (info + payment history + "Gia hạn" CTA).
**Form (dialog 480px):** Chủ xe*, SĐT* (pattern VN, `inputmode="tel"`), Biển số*, Khu vực* (monthly-enabled only), Gói (1/3/6/12 tháng segmented — shows total with discount line "Gói 12 tháng −10%"), Ngày bắt đầu* (date picker, default today), preview total 20/bold mono. Gia hạn = same dialog prefilled, start = max(today, current expiry+1day), note line "Nối tiếp từ 01/11".
**States:** loading skeleton; error banner; empty → "Chưa có vé tháng nào" + CTA; duplicate plate+zone guard → Warning inline "Biển số này đã có vé hiệu lực đến 31/10" blocking submit; cancel confirm (Danger, requires reason select).
**Responsive:** drawer overlays content (fixed right 360px, full height), table shrinks; dialog same as (c).
**A11y:** dates as native `<input type="date">` with text fallback format "dd/mm/yyyy"; phone errors 12/Danger with example; drawer `role="complementary"` + Esc close + focus return; status badges include text (never color-only).

## (f) Báo cáo doanh thu (table + filter ngày)

**Layout:** filter bar (date-range picker: Hôm nay / 7 ngày / 30 ngày / Tùy chọn + Khu vực multi-select + Loại vé select + Xuất Excel CTA secondary + Xuất PDF CTA neutral). Summary row: 3 KPI (Tổng doanh thu 24/bold mono, Tổng lượt xe, Trung bình/lượt). Main: revenue table grouped by day (Ngày mono | Lượt vào | Lượt ra | Vé lượt | Vé tháng | Tổng, footer totals row sticky) + stacked bar chart above table (Primary=vượt lượt, Secondary=vé tháng).
**Components:** DateRange picker dialog (calendar 2-month, 14px, keyboard navigable), Export buttons with progress (determinate bar + % mono).
**States:** loading → chart + table skeletons; error → retry panel; empty range (no data) → empty-state "Không có giao dịch trong khoảng này" + "Mở rộng khoảng ngày" quick action; export fail → Danger toast + retry; large ranges (>90 ngày) → Warning "Khoảng >90 ngày — hiển thị theo tuần" auto-aggregate note.
**Responsive:** filter bar wraps to 2 rows; table horizontal scroll with sticky total column; chart height 240 fixed.
**A11y:** date inputs labeled + `aria-describedby` format; chart has data table alternative (visually-hidden toggle "Xem dạng bảng"); export buttons `aria-busy` + live region announces "Xuất xong: bao_cao_10-2026.xlsx"; totals row `scope="row"` + bold.

## (g) Guest view (sơ đồ chỗ trống read-only)

**Layout (no sidebar):** slim header 56px (logo + "Sơ đồ chỗ trống" 20/semibold + clock mono live + auto-refresh note 12). Zone selector chips row (Tất cả + per-zone, 14, selected Primary fill). Main: per-zone grid map — slot cells 56×40 radius 8, gap 8: free = Success outline + tint, occupied = Primary solid (white plate mono 11 inside if known, else dot), maintenance = hatched Text/40 + "🔧" + `aria-disabled`. Right/below: summary strip ("Còn 34/120 — Cập nhật 10s trước" 14 + legend chips 12). Footer hint 12: "Màn hình chỉ xem — vui lòng liên hệ quầy để gửi xe."
**States:** loading → grid skeleton preserving layout; error → Warning banner + "Thử lại" (auto-retry 15s countdown shown); full zone → Danger header strip "Khu A1 đã đầy — vui lòng chọn khu khác"; all-full → page-level notice + nearest-alternative suggestion.
**Refresh:** 30s polling, subtle cell crossfade 200ms, no full-page flash; pause when window hidden; manual "Làm mới" button with spinner.
**Responsive:** min 1280 grid ~14 cols; narrower → fewer cols + vertical scroll (cells fixed size, never shrink below 48×36); high-contrast kiosk mode toggle (thicker borders, larger 16 labels).
**A11y:** grid `role="grid"` + each slot `role="gridcell"` with full label "A1-023: trống" (`aria-label`); occupied slots `aria-disabled="true"` (not focusable); summary `aria-live="polite"` announces only count changes; reduced-motion → no crossfade; keyboard: zone chips arrow-nav, grid roving tabindex on free slots for screen-reader exploration (read-only, no action on Enter — announces detail); contrast: slot text ≥4.5:1, legend text 12 minimum with 500 weight.

---

## Cross-screen rules (for @frontend)

1. Currency: `vi-VN`, "₫" suffix, mono, thousands separator. Dates: `dd/mm/yyyy HH:mm`.
2. Toasts bottom-right, 4s, `role="status"` (success) / `role="alert"` (error), max 3 stacked.
3. Every destructive action = confirm dialog. Every money action = preview before confirm.
4. Keyboard: `/` focuses search, `Ctrl+K` command palette (Admin/NV), `Esc` closes topmost layer.
5. Verification for frontend handoff: each screen must demo loading/error/empty + keyboard-only pass + 200% zoom no overlap.

**Status: verified** (all 7 screens specify layout/components/states/responsive-1280/a11y; tokens preserved from DESIGN.md).
