# Auth Flow — Đăng nhập / Đăng ký mới (Spec)

> Tokens: Primary `#1677FF`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (SĐT/timestamp nếu cần). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Focus-visible 2px solid Primary, offset 2px. Spec only — no code. Thay thế §a cũ trong `specs/parking-app.md` (bỏ role cards).

## 1. Quyết định layout: 2 form chuyển đổi bằng link (KHÔNG dùng tabs)

**Quyết định: 1 card — 2 mode (`login` ↔ `register`) chuyển qua link text, không dùng Tabs.**

Lý do (ghi rõ để @frontend không tự chế):
- Đăng nhập là path chính (staff + customer cũ); Đăng ký là path phụ (customer mới lần đầu). Tabs cho cảm giác 2 path ngang hàng → sai trọng số.
- Link "Chưa có tài khoản? Đăng ký" / "Đã có tài khoản? Đăng nhập" giữ CTA chính luôn là 1 nút duy nhất mỗi mode → giảm nhầm lẫn, dễ Tab-order, dễ `aria-live` thông báo đổi mode.
- Anonymous guest link luôn hiện dưới cùng cả 2 mode → không bị ẩn trong tab.

## 2. Layout chung (giữ khung cũ)

- Centered split giữ nguyên: left brand panel 480px (Primary `#1677FF` solid, white 32/bold "Bãi xe thông minh" + 16 feature bullets + version 12), right form panel 400px (Surface). Single window, no sidebar/topbar.
- Card form: Surface, radius 12, padding 24. Title 20/semibold + description 14/Text-60 thay đổi theo mode (xem §5 copy).
- Dưới CTA chính: divider 12/Text-40 "hoặc" + row link chuyển mode + row link ẩn danh (xem §4).
- Min 1280: fixed two-column; windowed <1280: brand panel collapse thành header bar 64px (giữ logic cũ).

## 3. Mode LOGIN (default)

**Fields (2):**
1. `Tên đăng nhập` — text input, height 40, radius 8, border Text/20, focus border Primary + ring `rgba(22,119,255,0.18)`. Label 14/medium phía trên (`<label for>`). `autocomplete="username"`. Placeholder: "VD: nv_an hoặc 0912345678". Helper 12/Text-60 dưới field: "Nhân viên nhập username · Khách hàng nhập số điện thoại".
2. `Mật khẩu` — password input + nút show/hide (Eye/EyeOff, `aria-pressed`, `aria-label="Hiện/Ẩn mật khẩu"`). `autocomplete="current-password"`, `aria-describedby="pw-hint"`. Hint 12: "Mật khẩu phân biệt chữ hoa/thường." Caps-Lock warning 12/Warning + icon khi `getModifierState('CapsLock')`.

**CTA:** Button primary full-width height 44 "Đăng nhập". Loading → spinner + "Đang đăng nhập…" + disabled + `aria-busy="true"` (cả form `aria-busy`).

**Validation inline (từng field, 12/Danger dưới field, `aria-describedby` + `aria-invalid="true"`):**
- Tên đăng nhập trống → "Vui lòng nhập tên đăng nhập."
- Tên đăng nhập <3 ký tự → "Tên đăng nhập phải ≥3 ký tự." (áp cho cả username lẫn SĐT — SĐT 10 số luôn pass rule này, rule SĐT chặt chỉ áp ở register)
- Mật khẩu trống → "Vui lòng nhập mật khẩu."
- Submit bị chặn cho tới khi 2 field pass client-rule; giữ lại tên đăng nhập khi lỗi server (không xóa).

**States lỗi server (banner Danger 14 + icon, `role="alert"`, trên form, dưới title):**
- Sai tài khoản/mật khẩu → "Sai tên đăng nhập hoặc mật khẩu. Vui lòng thử lại."
- Tài khoản bị khóa → "Tài khoản đã bị khóa — vui lòng liên hệ Admin." (phân biệt rõ với sai pass; không gợi ý thử lại)
- Lỗi mạng/server → "Không thể kết nối máy chủ. Vui lòng thử lại." + nút "Thử lại" trong banner (focus vào banner khi hiện).

## 4. Mode REGISTER (khách hàng mới)

Mở bằng link "Chưa có tài khoản? Đăng ký" dưới nút Đăng nhập. Chuyển mode: thay title/desc/fields/CTA, focus chuyển vào field Họ tên, thông báo `aria-live="polite"` "Đã chuyển sang form đăng ký tài khoản khách hàng". Link ngược: "Đã có tài khoản? Đăng nhập".

**Fields (4, tất cả required, `*` đỏ Danger sau label):**
1. `Họ và tên *` — text, `autocomplete="name"`. Rule: trim ≥2 ký tự, tối đa 50. Lỗi: trống → "Vui lòng nhập họ và tên."; <2 → "Họ tên phải ≥2 ký tự."
2. `Số điện thoại *` — tel, `inputmode="tel"`, `autocomplete="tel"`, placeholder "VD: 0912345678". Rule VN: `/^0\d{9}$/` (bắt đầu 0, đúng 10 số). Lỗi: trống → "Vui lòng nhập số điện thoại."; sai pattern → "Số điện thoại phải 10 số, bắt đầu bằng 0 (VD: 0912345678)."
3. `Mật khẩu *` — password + show/hide, `autocomplete="new-password"`. Rule: ≥6 ký tự. Lỗi: trống → "Vui lòng đặt mật khẩu."; <6 → "Mật khẩu phải ≥6 ký tự." Strength hint 12/Text-60 (không chặn): "Nên ≥8 ký tự, có số và chữ hoa."
4. `Xác nhận mật khẩu *` — password + show/hide, `autocomplete="new-password"`. Rule: khớp field 3. Lỗi: trống → "Vui lòng xác nhận mật khẩu."; lệch → "Mật khẩu xác nhận chưa khớp."

Validate onBlur + onSubmit; khi user sửa field thì xóa lỗi field đó ngay (không đợi submit lại). Submit disabled khi loading; không disable cứng khi invalid (để screen-reader vẫn submit và nghe lỗi tổng hợp) — banner tổng hợp trên cùng khi submit fail: "Còn X mục cần sửa — kiểm tra các dòng đỏ." (`role="alert"`).

**CTA:** Button primary full-width height 44 "Đăng ký". Loading → "Đang tạo tài khoản…" + spinner + disabled + `aria-busy`.

**States lỗi server:**
- SĐT đã tồn tại (409) → inline lỗi dưới field SĐT (12/Danger): "Số điện thoại đã được đăng ký — hãy Đăng nhập hoặc dùng số khác." + tự hiện link "Đăng nhập ngay" cạnh lỗi. Không dùng banner chung cho case này (user cần biết đúng field).
- Lỗi mạng/server → banner Danger + "Thử lại" (như login).
- Thành công → **tự đăng nhập luôn** (không bắt login lại): loading CTA chuyển "Đang đăng nhập…" 1 nhịp, toast Success "Đăng ký thành công — chào mừng {Tên}!" + routing theo §6 (customer → Sơ đồ chỗ trống).

## 5. Copy tiếng Việt (chốt — dùng đúng)

- Login title: "Đăng nhập" / desc: "Nhập tên đăng nhập và mật khẩu để tiếp tục."
- Register title: "Đăng ký tài khoản khách" / desc: "Tạo tài khoản để gửi xe nhanh và theo dõi lịch sử."
- Link dưới login CTA: "Chưa có tài khoản? **Đăng ký**" — dưới register CTA: "Đã có tài khoản? **Đăng nhập**".
- Guest ẩn danh (giữ nguyên cả 2 mode, text-button ghost full-width, dưới divider): "Vào xem chỗ trống (Khách)" — helper 12/Text-60: "Không cần tài khoản — chỉ xem, không gửi xe."
- Không dùng từ "role/vai trò" ở UI mới (đã bỏ role cards).

## 6. Routing sau login (theo role server trả về — KHÔNG cho user tự chọn)

| Role server | Landing | Shell |
| --- | --- | --- |
| `admin` | Dashboard (`/dashboard`) | Sidebar + topbar đầy đủ |
| `staff` | Check-in (`/checkin`, tab Check-in default) | Sidebar + topbar (Dashboard compact, Check-in/out, Vé tháng gia hạn, Lịch sử ca trực) |
| `customer` (gồm vừa đăng ký xong) | Sơ đồ chỗ trống (`/guest`, reuse Guest view §g) nhưng ở **chế độ đã đăng nhập** | Không sidebar; header 56px: logo + "Sơ đồ chỗ trống" + tên khách (14/medium, `Họ tên`) + nút "Đăng xuất" (neutral 32px). Clock live + auto-refresh 30s + legend giữ nguyên §g. |

**Nút "Trở lại" — quyết định rõ (theo hợp đồng):**
- Admin/Staff: giữ logic cũ ( nút Trở lại trong header/content về màn trước đó trong app shell, không đăng xuất).
- Customer đã đăng nhập: **KHÔNG có nút "Trở lại" riêng — nút "Đăng xuất" đóng vai trò quay về Login** (click → clear session → về `/login`, toast neutral "Đã đăng xuất."). Lý do: customer chỉ có 1 màn, nút Trở lại thừa và gây nhầm với Back của trình duyệt; gộp thành Đăng xuất là 1 hành động duy nhất, dễ hiểu, dễ a11y.
- Guest ẩn danh: không có tên, không có Đăng xuất — nút duy nhất là "Đăng nhập" (về `/login`).

## 7. A11y (bắt buộc — @frontend checklist)

- Mỗi input có `<label for>` thật; hint/lỗi nối bằng `aria-describedby` (id duy nhất mỗi field); lỗi → `aria-invalid="true"`.
- Banner lỗi server: `role="alert"` + focus programmatically vào banner khi hiện (để SR đọc ngay), Esc không đóng banner (chỉ đóng dialog — màn này không có dialog).
- Show/hide password: `aria-pressed` + `aria-label` động.
- Chuyển mode login↔register: focus vào field đầu tiên của mode mới + `aria-live="polite"` region thông báo; Tab-order không kẹt (link chuyển mode là `<button type="button">` trong tab sequence tự nhiên).
- Full keyboard: Tab/Shift+Tab qua hết fields → CTA → links; Enter submit từ bất kỳ field nào.
- Contrast: Text-on-Surface 16.7:1; white-on-Primary 4.6:1 (chỉ dùng cho text bold ≥14 hoặc nút 16/semibold); placeholder ≥4.5:1 (không dùng Text/40 cho placeholder — dùng Text/60 tối thiểu); lỗi Danger 12 phải 500+ weight để đạt 4.5:1 trên Surface.
- Reduced motion: tắt spinner animation → thay bằng text "…" nhấp nháy none (instant); không crossfade khi đổi mode.
- 200% zoom: form scroll dọc trong cột, không tràn brand panel.

## 8. Handoff cho @frontend

- File sửa: `src/renderer/pages/LoginPage.tsx` (xóa `ROLES` radio-cards, thêm `mode: 'login'|'register'` state), reuse `Button, Alert, Field` từ `../components/ui`. Không đụng màn khác.
- API giả định (backend xác nhận): `POST /api/auth/login {identifier, password} → {role, name}`; `POST /api/auth/register {name, phone, password} → auto-login {role:'customer', name}`; lỗi chuẩn `{code: 'INVALID_CREDENTIALS'|'ACCOUNT_LOCKED'|'PHONE_EXISTS'|'SERVER_ERROR'}`. Frontend map code → copy §3/§4 (không hardcode string server).
- Demo bắt buộc: loading / sai pass / SĐT đã tồn tại / tài khoản bị khóa / register-thành-công-tự-login + keyboard-only pass + 200% zoom.

**Status: verified** (đủ layout 1 quyết định + validation từng field + states loading/error 4 case + routing 3 role + nút Trở lại + copy VN + a11y checklist).
