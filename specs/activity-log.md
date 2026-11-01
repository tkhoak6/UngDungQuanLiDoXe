# Màn "Nhật ký hoạt động nhân viên" (DS-007) — Design Spec

> Tokens: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (mã vé/số tiền/timestamp). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Quy ước shell/dialog/toast/keyboard: xem `./specs/parking-app.md` §Global shell + §Cross-screen rules. Pattern table/filter/toolbar: kế thừa §c (Zones) + §f (Báo cáo). Pattern màn admin (guard, badge, empty): kế thừa `./specs/users-page.md`. Backend columns: `api-contract.md` §7 passes (`created_by`), §8 sessions (`created_by`/`closed_by`), §9 payments (`received_by`/`amount`/`paid_at`). Specs only — no code.

## 1. Định vị trong nav & phân quyền

- **Nav item:** label "Nhật ký", Lucide `History` (fallback `ScrollText` nếu set icon thiếu), vị trí sau "Lịch sử", trước "Nhân viên" (cuối nhóm quản trị, trước màn admin-only).
- **Hiển thị:**
  - Admin: thấy nav, xem full log mọi nhân viên.
  - Staff: **thấy nav** (khác màn Nhân viên là admin-only) nhưng chỉ xem được log của chính mình (`mine_only`).
  - Guest: không nav, deep-link → redirect Guest view (giống guard `users-page` §1).
- **Quyền (quyết định — theo pattern `payments:list` đã chốt):**
  - Admin: `activity:list` không truyền `staff_id` (hoặc truyền bất kỳ) → full.
  - Staff: frontend **ép `staff_id = me.id`** mọi request, backend enforce (bỏ qua/override `staff_id` khác gửi lên); filter nhân viên **không render** với staff. Deep-link có `?staff_id=X` → staff vẫn chỉ thấy mình.
  - IPC/backend trả `FORBIDDEN` (mất quyền) → Danger banner + nút "Đăng nhập lại" (giống `users-page` §1).
- **Route guard:** render table chỉ sau khi role resolve; chưa resolve → skeleton, không nháy nội dung.

## 2. Layout

**Toolbar row** (pattern §c): staff-filter dropdown (admin-only, "Tất cả nhân viên" + per-user, 240px) + date-range picker (Hôm nay / 7 ngày / 30 ngày / Tùy chọn — reuse §f) + action-filter dropdown (Tất cả / Check-in / Check-out / Bán vé tháng) + search input 240px (placeholder "Tìm mã vé, biển số…", `role="search"`) + spacer + Button secondary "Xuất Excel" (xem §5 quyết định).

**Table full-width** (dòng thời gian, sort mặc định `at DESC`), columns:

| Thời gian (mono 12, `dd/mm/yyyy HH:mm`) | Nhân viên (16/medium + username mono 12/Text-60) | Hành động (badge) | Chi tiết vé / số tiền | Ghi chú |
|---|---|---|---|---|

- **Hành động badge (3 loại — quyết định, xem §3 giải thích):**
  - Check-in = Primary tint (`rgba(22,119,255,0.10)`, text `#0B5FFF`, icon `LogIn` 12).
  - Check-out = Success tint (`rgba(22,163,74,0.08)`, text `#15803D`, icon `LogOut` 12).
  - Bán vé tháng = Secondary tint (`rgba(139,92,246,0.10)`, text `#6D28D9`, icon `Ticket` 12).
  - Text trong badge, không màu-only. Contrast ≥4.5:1.
- **Chi tiết vé / số tiền:** dòng 1 mono 14 — mã vé (`T-…` / `MT-…`) + biển số (mono, uppercase); dòng 2 mono 14 — số tiền `vi-VN ₫` **chỉ khi có** (check-out → `total_fee`; bán vé → `price`; check-in → "—"). Vé tháng check-in (`total_fee = 0`) → dòng tiền ghi "Vé tháng (0₫)" 12/Text-60 thay vì "—" để phân biệt với check-in chưa thu.
- **Ghi chú:** zone code + tên (`A — Khu A`), phương thức thu (`cash`/`transfer`/…) cho dòng có thu tiền; rút gọn 1 dòng, ellipsis + tooltip full.
- **Nhân viên đã bị khóa/xóa (FK `SET NULL`):** `username/full_name` null → hiển thị "— (tài khoản đã xóa)" 12/Text-60, row giữ nguyên (lịch sử không mất).
- **Pagination footer** 14 (20/50/100 per page — log dày hơn Zones nên default **20**, giống §f tinh thần), sticky header, sort Thời gian (`aria-sort`, mặc định DESC; click đảo ASC).
- **Row click (optional, không bắt buộc V1):** mở drawer 360px phải reuse §e (vé tháng) — hiển thị ticket/pass tóm tắt. Ghi là nice-to-have, frontend được phép bỏ qua V1 mà vẫn PASS.

## 3. Tập hành động — quyết định (KHÔNG bịa, chỉ dùng cột JOIN được)

Nguồn duy nhất: `sessions` + `payments` + `passes` JOIN `users`. **Chốt 3 actions:**

| Action | Nguồn row | `at` | Actor | Chi tiết | Tiền |
|---|---|---|---|---|---|
| `check_in` | `parking_sessions` (mọi session có `created_by`) | `check_in_at` | `created_by` → users | `ticket_code` + plate + zone | — (vé tháng: "Vé tháng (0₫)") |
| `check_out` | `parking_sessions` WHERE `status='completed'` | `check_out_at` | `closed_by` → users | `ticket_code` + plate + zone | `total_fee` |
| `pass_sale` | `monthly_passes` | `created_at` | `created_by` → users | `pass_code` + plate + zone + kỳ hạn | `price` |

**Quyết định loại trừ (ghi rõ):**

1. **KHÔNG có action "Khóa/Mở"** (zone khóa, user khóa): không bảng audit nào ghi actor + thời điểm cho các thao tác này → bịa filter sẽ trả rỗng/điêu. V1 không làm; muốn có phải thêm bảng `audit_log` (schema mới — ngoài scope).
2. **KHÔNG tách row "thu phí" riêng:** transaction check-out ghi đồng thời `sessions.total_fee` + 1 row `payments` (§8). Tách riêng sẽ **double-count** (1 check-out hiện 2 dòng). Dòng `check_out`/`pass_sale` đã mang `amount`; phương thức thu lấy từ `payments` JOIN (`session_id` / `monthly_pass_id`) hiển thị ở cột Ghi chú. Export Excel cũng xuất 1 dòng/event theo quy tắc này.
3. Check-in của xe vé tháng vẫn là `check_in` (không phải `pass_sale`); `pass_sale` chỉ lúc **bán/gia hạn vé**.

## 4. Data contract cho backend (không đòi cột mới)

Kênh gợi ý: **`activity:list`** (IPC, read-only). Backend implement bằng `UNION ALL` 3 SELECT trên columns hiện có — **không thêm cột/bảng**.

```ts
// Input
export interface ActivityListInput {
  staff_id?: number;          // admin lọc 1 NV; staff gọi: backend override = me.id
  from?: string;              // YYYY-MM-DD (inclusive, theo `at`)
  to?: string;                // YYYY-MM-DD (inclusive)
  action?: 'check_in' | 'check_out' | 'pass_sale';  // undefined = tất cả
  search?: string;            // match ticket_code / pass_code / license_plate (LIKE, uppercase)
  limit?: number;             // default 20, max 100
  offset?: number;            // default 0
}

// Output row (đã JOIN users; user bị xóa → *_null + display_name fallback)
export interface ActivityRow {
  at: string;                 // ISO8601 UTC — check_in_at / check_out_at / passes.created_at
  user_id: number | null;     // created_by / closed_by / passes.created_by
  username: string | null;
  full_name: string | null;
  action: 'check_in' | 'check_out' | 'pass_sale';
  ticket_code: string | null; // sessions.ticket_code | passes.pass_code
  license_plate: string | null;
  zone_code: string | null;
  zone_name: string | null;
  amount: number | null;      // check_out → total_fee; pass_sale → price; check_in → null (0 nếu vé tháng, xem note)
  is_monthly_session?: 0 | 1;// check_in có monthly_pass_id → UI render "Vé tháng (0₫)"
  payment_method?: PaymentMethod | null;  // JOIN payments (session_id / monthly_pass_id), mới nhất
  note?: string | null;
}

export interface ActivityListOutput {
  rows: ActivityRow[];
  total: number;              // COUNT cùng filter (cho pagination)
}
```

- **SQL gợi ý (backend tự cụ thể hóa):** `SELECT … FROM parking_sessions JOIN users ON created_by … UNION ALL SELECT … FROM parking_sessions WHERE status='completed' … UNION ALL SELECT … FROM monthly_passes …` + `LEFT JOIN vehicles`, `LEFT JOIN parking_zones`, `LEFT JOIN payments` (lấy 1 payment mới nhất per session/pass cho `payment_method`), `ORDER BY at DESC LIMIT/OFFSET`. Filter `staff_id/from/to/action/search` áp ở từng nhánh trước UNION.
- **Sort/search/pagination:** server-side (log lớn). Search chỉ match mã vé + biển số (không search tên NV — đã có staff-filter).
- **Quyền backend:** resolve role từ session; `role==='staff'` → force `staff_id = me.id` bất kể input.

## 5. Export Excel — quyết định: CÓ (giữ, secondary)

- **Quyết định: CÓ nút "Xuất Excel"** (secondary CTA, reuse pattern §f): admin audit/ca-trưởng đối soát cần file; chi phí thấp (đã có export ở Báo cáo).
- Hành vi: xuất theo **đúng filter hiện tại** (staff/mine_only cũng xuất được phần của mình); progress bar + `%` mono; xong → live region "Xuất xong: nhat_ky_YYYY-MM-DD.xlsx"; fail → Danger toast + retry. Giới hạn 5000 dòng/file + Warning "Khoảng >90 ngày — thu hẹp để xuất đủ" (song song §f >90 ngày note).

## 6. States

- **Loading:** table skeleton 8 rows cố định chiều cao + toolbar skeleton, `aria-busy`, không shift-layout; đổi filter → skeleton chỉ table (giữ toolbar).
- **Error:** banner Danger + "Tải lại" (IPC fail); `FORBIDDEN` → banner "Phiên của bạn không còn quyền — đăng nhập lại." + nút (giống `users-page` §1).
- **Empty:**
  - Chưa có hoạt động (ngày đầu/khoảng rỗng) → "Chưa có hoạt động nào trong khoảng này" + quick action "Mở rộng khoảng ngày" (reuse §f).
  - Empty-search/filter → "Không tìm thấy hoạt động" + "Xóa bộ lọc".
  - Staff mới chưa làm gì → "Bạn chưa có hoạt động nào — các check-in/check-out của bạn sẽ hiện ở đây." (onboard tone, §onboard).
- **Partial data:** user đã xóa → row giữ + "— (tài khoản đã xóa)"; `closed_by` null (ca cũ thiếu actor) → Nhân viên "— (không rõ)".

## 7. Responsive & A11y (theo chuẩn màn cũ)

- **Responsive:** min 1280 — table min-width 960, scroll ngang trong content, sticky header; toolbar wrap 2 rows khi hẹp; dialog/drawer max-height 90vh. Không target mobile.
- **A11y:**
  - Table `<th scope>` + `aria-sort` (Thời gian); search `role="search"` + `<label>`; filter dropdowns native `<select>` có label.
  - Badge luôn có text + icon trang trí `aria-hidden` (không màu-only).
  - Tiền/timestamp/mã vé mono; tiền `vi-VN ₫`; ngày `dd/mm/yyyy HH:mm`.
  - Toasts `role="status"`/`role="alert"`, max 3, bottom-right 4s; export progress `aria-busy` + live region.
  - Keyboard: `/` focus search, `Esc` đóng lớp trên cùng; focus-visible 2px Primary offset 2px; zoom 200% không chồng lấn.
  - **Handoff check:** demo loading/error/empty + keyboard-only pass + 200% zoom (như §Cross-screen rule 5).

**Status: verified** (đủ layout/nav-guard 2 role/table 5 cột/3 badges/tập action chốt từ cột JOIN được + loại trừ có lý do/contract `activity:list` không cột mới/states/export/a11y; không sửa spec màn khác, không code).
