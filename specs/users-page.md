# Màn "Nhân viên & tài khoản" (admin-only) — Design Spec (DS-006)

> Tokens: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (username/timestamp). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Status mapping: xem `DESIGN.md` §10. Quy ước shell/dialog/toast/keyboard: xem `./specs/parking-app.md` §Global shell + §Cross-screen rules. Backend: IPC `users:list/create/toggle-active`, bcrypt.hash(10) — xem `api-contract.md` §3 + `./specs/backend-summary.md`. Specs only — no code.

## 1. Định vị trong nav & phân quyền

- **Nav item:** label "Nhân viên", Lucide `Users`, vị trí sau "Lịch sử" (cuối nhóm quản trị), **chỉ render khi `role === 'admin'`**.
- **Route guard:** staff/guest truy cập trực tiếp (deep-link) → redirect về landing của role (staff → Check-in/out, guest → Guest view) + Warning toast "Bạn không có quyền truy cập trang này." Không render skeleton/table trước khi guard xong (tránh nháy nội dung).
- **IPC guard:** mọi action gọi channel `users:*` — backend đã chặn non-admin; frontend coi lỗi `FORBIDDEN` là retry-không-ích → hiển thị Danger banner "Phiên của bạn không còn quyền Admin — đăng nhập lại." + nút "Đăng nhập lại".

## 2. Layout

**Toolbar row** (giống pattern §c Zones): search input 240px (placeholder "Tìm tên đăng nhập, họ tên…", `role="search"`) + filter dropdown Vai trò (Tất cả / Admin / Nhân viên) + filter dropdown Trạng thái (Tất cả / Hoạt động / Bị khóa) + spacer + Button primary "＋ Thêm nhân viên".

**Table full-width**, columns:

| Tên đăng nhập (mono 14, `JetBrains Mono`) | Họ tên (16/medium) | Vai trò (badge) | Trạng thái (badge) | Ngày tạo (mono 12, `dd/mm/yyyy`) | Hành động |
|---|---|---|---|---|---|

- **Vai trò badge:** admin = Primary tint (`rgba(22,119,255,0.10)`, text `#0B5FFF`-darkened ≥4.5:1, label "Admin"); staff = Secondary tint (`rgba(139,92,246,0.10)`, text `#6D28D9`, label "Nhân viên"). Text trong badge, không màu-trơ-trọi.
- **Trạng thái badge:** Hoạt động = Success tint (`rgba(22,163,74,0.08)`, text `#15803D`, dot Success); Bị khóa = Danger tint (`rgba(220,38,38,0.08)`, text `#B91C1C`, icon `Lock` 12).
- **Hành động:** 1 icon-button 32px duy nhất — `Lock` (khóa) khi đang hoạt động / `LockOpen` (mở khóa) khi bị khóa, tooltip "Khóa tài khoản" / "Mở khóa tài khoản". **KHÔNG có nút Xóa** (xóa cứng bị cấm — xem §5).
- Dòng của chính mình (`me.id`): thêm tag 12/Text-60 " (bạn)" sau họ tên + disable nút Khóa của chính mình (tooltip "Không thể tự khóa chính mình").
- Pagination footer 14 (10/20/50 per page), giống §c.
- Sort: sortable header Tên đăng nhập + Ngày tạo (`aria-sort`).

## 3. Form dialog "Thêm nhân viên" (480px)

Mở từ CTA. Panel Surface radius 12, overlay `rgba(17,24,39,0.45)`, Esc đóng, focus trap, return focus về CTA.

**Fields** (label 14/medium phía trên, input height 40, radius 8, focus ring như §a):

1. **Tên đăng nhập\*** — text, `autocomplete="username"`, helper 12 "≥3 ký tự, duy nhất, không dấu (vd `staff02`)". Validate inline: <3 ký tự / có dấu-cách → Danger 12; trùng → Danger "Tên đăng nhập đã tồn tại." (server check sau submit cũng map về field này).
2. **Họ tên\*** — text, `autocomplete="name"`, required, trim, max 100.
3. **Mật khẩu\*** — password, ≥6 ký tự, show/hide toggle (`aria-pressed`), strength hint 12 (Yếu khi <8, không chặn). Helper "≥6 ký tự — cấp cho nhân viên và yêu cầu đổi sau bàn giao."
4. **Xác nhận mật khẩu\*** — password, phải khớp; mismatch → Danger "Mật khẩu xác nhận chưa khớp." Submit disabled cho đến khi khớp.
5. **Vai trò** — segmented radio 2 options (Nhân viên / Admin), **mặc định = Nhân viên**.
   - **Quyết định (ghi rõ): CHO PHÉP tạo thêm Admin.** Lý do: cần admin dự phòng / bàn giao ca quản trị; backend `UserDTO.role_name` đã hỗ trợ `admin|staff`.
   - Chọn **Admin** → hiện Warning inline 12 trong dialog: "Tài khoản Admin có toàn quyền (giá, báo cáo, khóa tài khoản). Chỉ cấp cho người quản lý." + footer nút Lưu đổi label thành "Tạo tài khoản Admin" (vẫn Primary, không Danger — vì là hành động có chủ ý, không phải destructive).
6. Footer: Hủy (neutral) + "Tạo tài khoản" (primary, loading spinner + `aria-busy` khi gọi IPC).

**Sau tạo thành công:** toast Success "Đã tạo tài khoản `staff02`." + đóng dialog + refresh table (row mới highlight 1s, `aria-live="polite"`). **Không bao giờ hiển thị lại mật khẩu / password_hash** — dialog đóng là xóa field khỏi memory (clear state).

## 4. Confirm dialog Khóa / Mở khóa (480px)

- **Khóa** (Danger title "Khóa tài khoản `staff02`?"): body 14 — "Tài khoản bị khóa sẽ không đăng nhập được nữa. Lịch sử check-in/thu phí của tài khoản được giữ nguyên (SET NULL)." + Warning line: "Nếu tài khoản đang đăng nhập trên máy khác, phiên của họ sẽ hết hiệu lực ở thao tác tiếp theo." (Ghi chú: backend hiện không expose phiên đang online → UI không biết ai đang online, nên dùng cảnh báo chung này thay vì tên máy cụ thể.) + checkbox/btn require? Không — 2 nút Hủy / "Khóa tài khoản" (Danger). Undo toast 5s "Đã khóa — Hoàn tác" (gọi `toggle-active` ngược).
- **Mở khóa** (neutral title "Mở khóa tài khoản `staff02`?"): body 1 dòng + nút "Mở khóa" (Primary).
- **Guards (frontend chặn trước khi gọi IPC):**
  - Tự khóa chính mình → nút disabled (xem §2), kể cả gọi tay IPC cũng bị backend từ chối — hiển thị lỗi thân thiện.
  - Khóa **admin cuối cùng đang hoạt động** → chặn ngay trong confirm: Danger line "Không thể khóa — đây là tài khoản Admin hoạt động cuối cùng." + disable nút Khóa. (Đếm từ `users:list`: `role_name==='admin' && is_active===1`.)

## 5. Quy tắc bất biến

1. **KHÔNG bao giờ hiển thị `password_hash`** — table/dialog/toast/log đều không có; `UserDTO` đã lược bỏ ở contract.
2. **KHÔNG nút xóa cứng** — xóa user thật chỉ là `toggle-active` (khóa); lịch sử sessions/payments giữ qua FK `SET NULL` (xem `api-contract.md` §3). V1 không có chức năng sửa (backend chưa có `users:update`) — đổi họ tên/vai trò muốn sửa thì Khóa + tạo mới; ghi vào empty-state note cho admin biết.

## 6. States

- **Loading:** table skeleton 8 rows (cố định chiều cao, `aria-busy`, không shift-layout); dialog submit → spinner + disable toàn form.
- **Error:** banner Danger + "Tải lại" (IPC fail); tạo trùng username → inline field error (không banner); `FORBIDDEN` → xem §1.
- **Empty:** chưa có nhân viên nào (ngoài admin hiện tại) → "Chưa có tài khoản nhân viên nào" + CTA "Thêm nhân viên đầu tiên"; empty-search → "Không tìm thấy tài khoản" + "Xóa bộ lọc". Note 12 trong empty-state: "Cần đổi tên/vai trò? Hiện chỉ hỗ trợ Khóa + tạo mới."

## 7. Responsive & A11y (theo chuẩn các màn cũ)

- **Responsive:** min 1280 — table min-width 960, scroll ngang trong content, sticky header + sticky cột đầu; dialog max-height 90vh scroll. Không target mobile.
- **A11y:** table `<th scope>` + `aria-sort`; search `role="search"` + `<label>`; password toggle `aria-pressed` + Caps-Lock warning 12/Warning (kế thừa §a); confirm destructive có `aria-describedby` guard text; Esc đóng + focus return; badge luôn có text (không màu-only); contrast badge-text ≥4.5:1 (Success `#15803D`, Danger `#B91C1C`, Admin `#0B5FFF`, staff `#6D28D9` trên tint); toasts `role="status"`/`role="alert"`; `/` focus search, `Esc` đóng lớp trên cùng.
- **Handoff check:** demo loading/error/empty + keyboard-only pass + zoom 200% không chồng lấn (như §Cross-screen rule 5).

**Status: verified** (đủ layout/nav-guard/table/badges/2 dialogs/guards/states/a11y; khớp IPC `users:*` hiện có; không phát sinh API mới).
