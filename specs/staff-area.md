# Khu vực Nhân viên mở rộng — Design Spec (DS-010)

> Tokens: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (username/SĐT/tiền/timestamp). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Quy ước shell/dialog/toast/keyboard/`/`-focus/Esc: xem `./specs/parking-app.md` §Global shell + §Cross-screen rules. Pattern màn admin (guard/badge/toolbar/table): kế thừa `./specs/users-page.md` (DS-006). Log hiệu suất: kế thừa `./specs/activity-log.md` (DS-007, `activity:list` + staff `mine_only`). Backend columns + ma trận quyền: `api-contract.md` §3/§11. Code hiện tại: `src/renderer/pages/UsersPage.tsx` (đã có create + edit `users:update` FE-009 + toggle-active + self/last-admin guards). Specs only — no code.
>
> **Phạm vi 4 pha (user chốt cả 4):** S1 Hồ sơ chi tiết → S2 Hiệu suất từng người → S3 Ca + chấm công → S4 Phân quyền chi tiết. Thứ tự triển khai và mục cần DB mới: xem §5.

---

## S1 — Hồ sơ chi tiết nhân viên

### S1.1 Quyết định field (chốt)

| Field | Nguồn | Quyết định |
|---|---|---|
| `phone` (SĐT) | **Đã có** trong `users.phone` (contract §3, `auth.ts` SELECT đã lấy) — UI hiện tại chưa hiển thị/nhập | **Hiện + cho nhập.** Validate SĐT VN `^0\d{9}$` (reuse pattern `customer-register`, nhưng staff KHÔNG ép `username = phone`) |
| `address` (địa chỉ) | Chưa có | **Thêm**, `TEXT NULL`, max 255, optional |
| `start_date` (ngày vào làm) | Chưa có | **Thêm**, `TEXT NULL` (`YYYY-MM-DD`), optional, không được là ngày tương lai |
| `notes` (ghi chú) | Chưa có | **Thêm**, `TEXT NULL`, max 500, optional — chỉ admin thấy/sửa (ghi chú nội bộ: kỷ luật, bàn giao…) |

**DB mới (S1): KHÔNG bảng mới — chỉ 3 cột nullable vào `users`** (migration-005, xem §5). Nullable = tương thích ngược hoàn toàn, staff cũ không cần backfill. `phone` không cần migration.

### S1.2 Layout

**S1a — Mở rộng table Nhân viên hiện tại (admin-only, DS-006 giữ nguyên guard/nav):** thêm 1 cột **SĐT** (mono 14) sau Họ tên. `address`/`start_date`/`notes` KHÔNG lên table (table đã 6 cột, tránh loãng) — xem ở drawer chi tiết.

**S1b — Drawer "Hồ sơ nhân viên" 400px phải (mới, reuse pattern drawer §e vé tháng):** click row (hoặc icon-button `Eye` thêm vào cột Hành động) mở drawer:
- Header: Họ tên 20 + badge Vai trò + badge Trạng thái + "(bạn)" nếu self.
- Body sections: **Liên hệ** (username mono, SĐT mono + `tel:` link, địa chỉ) / **Công việc** (ngày vào làm `dd/mm/yyyy`, thâm niên auto "2 năm 3 tháng" tính từ `start_date`, trạng thái) / **Ghi chú nội bộ** (chỉ admin — staff tự xem bị ẩn cả section, xem S1.4).
- Footer: nút "Sửa hồ sơ" (primary, mở dialog edit mở rộng) + nút Khóa/Mở khóa (reuse confirm DS-006 §4).

**S1c — Dialog edit mở rộng:** form edit hiện tại (username/full_name/password — FE-009 giữ nguyên) + thêm 4 fields mới: SĐT, Địa chỉ, Ngày vào làm (native `<input type="date">`), Ghi chú (`textarea` 3 rows, max 500 + counter). Layout 520px (rộng hơn dialog tạo 480px vì nhiều field), 2-column grid cho SĐT + Ngày vào làm, full-width cho Địa chỉ + Ghi chú.

**S1d — "Hồ sơ của tôi" cho staff (mới, nav staff):** nav item "Hồ sơ của tôi" (Lucide `IdCard`/`CircleUserRound`), render với cả admin + staff (guest redirect). Staff xem drawer layout S1b ở chế độ read-only nhưng **ẩn section Ghi chú nội bộ**, + nút "Đề xuất sửa đổi" (không tự sửa — gửi yêu cầu, xem S1.4). Admin mở cùng route với `?id=` xem bất kỳ ai (full + notes + nút Sửa).

### S1.3 Contract API (tái dùng + mới)

- **Tái dùng:** `users:list` (thêm 4 cột vào SELECT — backend 1 dòng, DTO mở rộng), `users:update` (mở rộng patch cho phép `phone/address/start_date/notes` — BE-005 pattern `editPatch` giữ nguyên), `users:toggle-active` (không đổi).
- **Mới (1 kênh):** `users:profile` — staff lấy/sửa hồ sơ chính mình:
```ts
// users:profile GET → { data: StaffSelfProfile }  (backend ép id = me.id, role bất kỳ ≥ staff)
export interface StaffSelfProfile {
  id: number; username: string; full_name: string; phone: string | null;
  address: string | null; start_date: string | null; // KHÔNG có notes
  role_name: RoleName; is_active: 0 | 1; created_at: string;
}
// users:profile:update { phone?, address? } — CHỈ 2 field staff được tự sửa (xem S1.4)
```
Backend: staff gọi `users:update` với id ≠ me → `FORBIDDEN` (kể cả trước S4, chặn tay ngay).

### S1.4 Phân quyền xem/sửa hồ sơ (chốt — gợi ý user được chấp nhận)

- **Staff xem được hồ sơ mình** (S1d read-only, trừ notes). **Sửa hạn chế:** chỉ `phone` + `address` của chính mình (qua `users:profile:update`); `full_name/username/start_date` muốn đổi → nút "Đề xuất sửa đổi" tạo yêu cầu inline (lưu ở đâu? V1 KHÔNG bảng mới — gửi qua `notes`? KHÔNG. **V1: nút mở dialog pre-fill gửi... không backend → V1 chỉ là `mailto:`-style note "Liên hệ quản lý để cập nhật" + toast info.** Ghi rõ để frontend không bịa API. Nếu cần workflow duyệt → để S4+.)
- **`notes`:** admin-only tuyệt đối — SELECT loại khỏi DTO khi `role==='staff'` (kể cả xem chính mình), `users:profile:update` không nhận field này.
- **Admin:** full CRUD hồ sơ mọi user qua dialog edit mở rộng.

### S1.5 Validation

- SĐT: `^0\d{9}$`, trống được (NULL); trùng → Danger inline "SĐT đã được dùng." (bắt `SQLITE_CONSTRAINT_UNIQUE` như username).
- Địa chỉ: trim, max 255, trống được.
- Ngày vào làm: `YYYY-MM-DD`, ≤ today (tương lai → Danger "Ngày vào làm không thể là tương lai."); trống được.
- Ghi chú: max 500 + counter `123/500`, trống được.
- Các rule cũ (username ≥3 không dấu, họ tên required ≤100, pw ≥6) giữ nguyên FE-009.

### S1.6 States & A11y

- States: drawer loading skeleton 4 rows (`aria-busy`); SĐT/address null → "—" 12/Text-60 (không để trống khó hiểu); `FORBIDDEN` → Danger banner + "Đăng nhập lại" (pattern DS-006 §1); thâm niên chỉ hiện khi có `start_date`.
- A11y: drawer `role="dialog"` Esc đóng + focus trap + return focus về row đã click (pattern §e); `tel:` link có `aria-label "Gọi {phone}"`; date input native (keyboard/AT miễn phí); textarea có counter `aria-describedby`; badge/text contrast ≥4.5:1 (Success `#15803D`, Danger `#B91C1C`); zoom 200% drawer scroll được.

---

## S2 — Hiệu suất từng nhân viên

### S2.1 Quyết định (chốt): TÁI DÙNG 100%, KHÔNG API mới

Nguồn số liệu = **`activity:list` (DS-007 §4) + `payments`**. Mọi metric S2 suy ra được từ `ActivityRow[]` client-side hoặc cùng UNION query với `GROUP BY user_id`:
- **Lượt check-in** = count `action='check_in'`; **lượt check-out** = count `'check_out'`; **vé tháng bán** = count `'pass_sale'`.
- **Doanh thu** = `SUM(amount)` (check-out `total_fee` + pass_sale `price`; check-in null/0 bỏ qua — đúng quy tắc DS-007 §3 không double-count vì mỗi event 1 dòng).
- Khoảng ngày: `from/to` của `activity:list` đã có → date-range picker reuse §f. Staff `mine_only` backend ép sẵn → staff chỉ thấy số của mình, không thấy compare (xem S2.2).

**KHÔNG API mới.** Nếu log > vài nghìn rows và aggregate client-side chậm → backend thêm `activity:summary {staff_id?, from, to}` sau (ghi là optional P2, V1 frontend aggregate từ rows đã fetch cho table — cùng 1 request, không request thêm).

### S2.2 Layout

**Tab mới trong màn Nhật ký (DS-007):** segmented control 2 tabs "Chi tiết" (table hiện tại giữ nguyên) | "Hiệu suất" (mới). Không tách màn mới — chung filter toolbar (staff/date/action/search) + chung guard/nav.

**Tab Hiệu suất (admin):**
- **Top cards (3):** Tổng doanh thu kỳ (mono 24 + `vi-VN ₫`) / Tổng lượt check-in / Tổng vé tháng bán — tính trên filter hiện tại.
- **Bảng xếp hạng NV:** columns | # (rank mono) | Nhân viên (16/medium + username mono 12) | Check-in (mono, right) | Check-out | Vé bán | Doanh thu (mono right, bold top-1) | Tỉ lệ chốt vé* |. Sort default Doanh thu DESC (`aria-sort`), click header đổi. Top-1 row highlight Secondary tint + badge "Top 1" (text, không màu-only). User đã xóa → "— (tài khoản đã xóa)" gom 1 dòng cuối (không rank).
  - \*Tỉ lệ chốt vé = `pass_sale / check_in` (% 1 decimal) — định nghĩa ngay dưới table 12/Text-60 để khỏi hiểu lầm.
- **Mini bar chart CSS-only** (KHÔNG lib chart): mỗi NV 1 bar ngang tỉ lệ theo doanh thu max, màu Primary, track Text-10. Giá trị vẫn là text đầy đủ bên cạnh (chart trang trí, screen reader đọc table).

**Tab Hiệu suất (staff):** chỉ 3 top cards của chính mình + dòng "Xếp hạng của bạn: #2/8 (doanh thu)" (backend trả rank kèm khi `mine_only`? V1 KHÔNG API mới → **frontend không biết rank** → V1 staff chỉ thấy số của mình, không rank. Ghi rõ để khỏi bịa. Rank staff → cần `activity:summary`, để P2.)

### S2.3 Contract API

- **Tái dùng duy nhất:** `activity:list` với `staff_id/from/to/action/search/limit` hiện có. Pagination 20 giữ cho tab Chi tiết; tab Hiệu suất fetch `limit=5000` (trần export DS-007 §5) 1 lần rồi aggregate client-side + memo.
- **Validation:** khoảng ngày ≤90 ngày (reuse note §f) else Warning; `from > to` → Danger inline + disable fetch.

### S2.4 States & A11y

- Loading: skeleton 3 cards + 5 table rows; Error: banner + "Tải lại" (pattern DS-007 §6); Empty: "Chưa có hoạt động nào trong khoảng này" + "Mở rộng khoảng ngày" (reuse §f).
- A11y: tabs `role="tablist"` + `aria-selected` + arrow-key nav; table `<th scope>` + `aria-sort`; bar `aria-hidden="true"` (số liệu đã có text); tiền mono + `vi-VN ₫`; rank dùng text "#1" không màu-only.

---

## S3 — Ca làm việc + chấm công + bàn giao

### S3.1 Quyết định V1 tối thiểu (chốt): BẢNG MỚI, nhưng gọn

Tái dùng không đủ: `parking_sessions`/`payments` ghi nhận *việc* theo actor nhưng không có khái niệm *ca* (giờ cố định, tiền đầu/cuối ca, bàn giao). **V1 cần bảng mới — 2 bảng (không 3):**

| Bảng | Vì sao cần |
|---|---|
| `shifts` (định nghĩa ca: Sáng/Chiều/Tối + khung giờ cấu hình được) | Giờ ca phải config (user yêu cầu "giờ cố định cấu hình?") → seed 3 ca mặc định + admin sửa được |
| `attendance` (chấm công vào-ra + tiền đầu/cuối ca + bàn giao) | Gộp chấm công + bàn giao 1 bảng (1 row = 1 lượt trực của 1 NV trong 1 ca 1 ngày) — tránh join 3 bảng cho V1 |

**KHÔNG bảng `handover` riêng V1** (tiền đầu/cuối + note bàn giao nằm luôn trong `attendance` — ca sau đọc row ca trước). Tách sau nếu cần duyệt/ký bàn giao 2 chiều.

### S3.2 Schema đề xuất cho @database (migration-006)

```sql
CREATE TABLE shifts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,          -- 'MORNING' | 'AFTERNOON' | 'NIGHT'
  name TEXT NOT NULL,                 -- 'Ca sáng' ...
  start_time TEXT NOT NULL,           -- 'HH:mm' '06:00'
  end_time TEXT NOT NULL,             -- 'HH:mm' '14:00'
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Seed: MORNING 06:00–14:00 / AFTERNOON 14:00–22:00 / NIGHT 22:00–06:00(+1).

CREATE TABLE attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),   -- RESTRICT: còn chấm công không xóa user
  shift_id INTEGER NOT NULL REFERENCES shifts(id), -- RESTRICT
  work_date TEXT NOT NULL,                          -- YYYY-MM-DD (ngày bắt đầu ca)
  check_in_at TEXT NULL,    -- ISO8601 thực tế bấm vào
  check_out_at TEXT NULL,   -- ISO8601 thực tế bấm ra (NULL = đang trực)
  opening_cash INTEGER NOT NULL DEFAULT 0,   -- tiền đầu ca (VND, két/quầy bàn giao)
  closing_cash INTEGER NULL,                 -- tiền cuối ca (NULL = chưa chốt)
  handover_note TEXT NULL,                   -- ghi chú bàn giao, max 500
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, shift_id, work_date)      -- 1 NV 1 ca 1 ngày 1 row
);
CREATE INDEX idx_att_date ON attendance(work_date);
CREATE INDEX idx_att_user ON attendance(user_id, work_date);
```

IPC gợi ý (cho @node-developer, frontend gọi): `shifts:list/update` (admin config giờ), `attendance:check-in` (ép `user_id=me`, chặn check-in 2 lần cùng ca/ngày → `ALREADY_CHECKED_IN`), `attendance:check-out {closing_cash, handover_note?}` (ép me, chặn khi chưa check-in → `NOT_CHECKED_IN`), `attendance:list {from,to,staff_id?}` (staff ép me — pattern `mine_only`), `attendance:today` (row ca hiện tại của me để render nút Vào/Ra).

### S3.3 Layout

**Nav:** item "Chấm công" (Lucide `CalendarClock`), staff + admin thấy; guest không.

**Màn chính (staff view = default):**
- **Thẻ ca hiện tại (top):** "Ca chiều · 14:00–22:00" + trạng thái badge (Chưa vào ca / Đang trực `Xh Ym` live / Đã chốt ca) + 2 nút context: "Vào ca" (primary, kèm nhập `opening_cash` — prefill từ `closing_cash` ca trước gần nhất + note "Két bàn giao: 1.200.000₫") / "Ra ca" (primary, dialog nhập `closing_cash` + `handover_note` + auto-chênh lệch `closing - opening - revenue_trong_ca` — revenue lấy từ S2/`activity:list` cùng khoảng ca, hiển thị "Đối soát: khớp/lệch ±X₫" Warning khi lệch).
- **Table "Ca của tôi":** Ngày (`dd/mm/yyyy`) | Ca | Vào (HH:mm) | Ra | Giờ trực | Đầu ca | Cuối ca | Chênh lệch (mono, Success khớp/`0₫`, Danger lệch ≠0) — 7 ngày gần nhất default, date-range reuse §f.
- **Admin view:** thêm staff-filter (pattern DS-007) + tab "Định nghĩa ca" (table 3 ca + edit giờ start/end inline dialog, validate `start ≠ end`, overlap Warning không chặn) — config giờ ca theo yêu cầu user.

### S3.4 Validation

- `opening_cash/closing_cash` ≥ 0 nguyên VND; check-in khi đã có row cùng (user,shift,date) → Danger "Bạn đã vào ca này."; check-out khi chưa check-in → block; `work_date` = today theo ca (ca đêm 22:00–06:00 tính ngày bắt đầu); giờ ca edit: `HH:mm` hợp lệ, ca đêm cho phép `end < start` (= qua ngày, ghi chú rõ).
- Đối soát lệch: Warning không chặn chốt ca (ghi nhận thực tế, admin đối soát sau).

### S3.5 States & A11y

- Loading skeleton thẻ ca + 7 rows; quên chốt ca hôm trước → Warning banner "Bạn chưa chốt ca sáng hôm qua" + nút "Chốt bù" (cho `check_out_at` + note, gắn flag muộn — backend cho, UI gắn badge "Chốt bù"); offline/Electron lỗi IPC → banner + "Thử lại".
- A11y: nút Vào/Ra `aria-live` trạng thái trực; tiền mono + `vi-VN ₫`; dialog chốt ca focus trap + Esc; chênh lệch luôn có text "khớp"/"lệch +X₫" (không màu-only); keyboard `/` search, `Esc` đóng.

---

## S4 — Phân quyền chi tiết (permission flags)

### S4.1 Quyết định (chốt): flags per-user, tương thích ngược guard role

**Mô hình:** giữ `role` (`admin/staff`) làm **mặc định + fallback**, thêm `permissions` JSON/flags per-user **chỉ thu hẹp hoặc nới trong biên role** — staff không bao giờ vượt admin.

```ts
// Khả năng cho staff (default full như hiện tại — tương thích ngược §11):
export interface StaffPermissions {
  checkin: 0 | 1;        // Check-in/out + thu phí (mặc định 1)
  pass_sale: 0 | 1;      // Bán/gia hạn vé tháng (mặc định 1)
  report_self: 0 | 1;    // Báo cáo + Hiệu suất ca mình (mặc định 1)
  profile_self: 0 | 1;   // Sửa SĐT/địa chỉ của mình (mặc định 1, khóa S1.4)
  reservation: 0 | 1;    // Xác nhận/hủy đặt chỗ (§13) (mặc định 1)
}
export const STAFF_DEFAULTS: StaffPermissions =
  { checkin: 1, pass_sale: 1, report_self: 1, profile_self: 1, reservation: 1 };
```

**Tương thích ngược (bắt buộc):**
1. DB: cột `users.permissions TEXT NULL` — **NULL = full staff cũ** (resolve = `STAFF_DEFAULTS`). Không backfill, không vỡ guard cũ.
2. Guard cũ theo `role` giữ nguyên ở mọi IPC hiện có; permission check **chỉ thêm** ở các kênh mới/liên quan (check-in, pass_sale, activity:list, profile:update…): `role==='admin'` → pass luôn; `role==='staff'` → check flag tương ứng, thiếu → `FORBIDDEN('NO_PERMISSION:<key>')`.
3. Frontend: menu/nav render theo `role` như cũ + **ẩn thêm** theo flags (vd staff mất `pass_sale` → ẩn nút "Bán vé" + deep-link redirect + toast — pattern DS-006 §1). Flags resolve 1 lần lúc login (`me.permissions ?? defaults`), cache trong `useAuth`, refresh sau khi admin sửa.

**DB mới (S4): 1 cột `users.permissions TEXT NULL`** (migration-007) — không bảng mới. Kiểu JSON string `{"checkin":1,...}` (SQLite không có JSONB native ở better-sqlite3 cũ → TEXT + app parse, partial JSON thiếu key = default 1).

### S4.2 Layout

**Mở rộng drawer S1b / dialog edit (admin):** section "Quyền hạn" (chỉ khi edit user `role==='staff'`; edit admin ẩn section + note "Admin luôn full quyền"):
- 5 toggle rows (label + mô tả 12/Text-60 + Switch): Check-in/out & thu phí / Bán vé tháng / Xem báo cáo ca mình / Tự sửa SĐT-địa chỉ / Xác nhận đặt chỗ.
- Nút "Khôi phục mặc định" (reset 5 flags = 1) + note 12: "Mặc định nhân viên có đủ 5 quyền (giữ nguyên như hiện tại)."
- Với user đang online máy khác: Warning line reuse DS-006 §4 (phiên họ hết hiệu lực thao tác tiếp theo → flags mới áp dụng).

**Ma trận ví dụ (user chốt):** staff A chỉ check-in = `{checkin:1, pass_sale:0, report_self:0, profile_self:1, reservation:0}`; staff B bán vé + xem báo cáo ca mình = `{checkin:1, pass_sale:1, report_self:1, profile_self:1, reservation:1}`.

### S4.3 Contract API

- **Tái dùng:** `users:list` (+ cột `permissions` vào SELECT/DTO), `users:update` (+ patch `permissions?`), login/me (+ `permissions` resolve).
- **Mới: KHÔNG kênh mới.** Resolve rule backend (cho @node-developer): `resolvePerm(user, key) = user.role==='admin' ? 1 : (parse(user.permissions)?.[key] ?? 1)`.
- Error mới: `FORBIDDEN('NO_PERMISSION:<key>')` → frontend map sang toast Danger "Tài khoản của bạn không có quyền {label} — liên hệ quản lý." (không hiện raw key).

### S4.4 Validation / States / A11y

- Validation: `permissions` chỉ nhận 5 keys whitelist, giá trị 0/1; set admin → backend bỏ qua (không lưu); không thể tự hạ quyền chính mình (self-edit ẩn section); V1 không version/conflict — last-write-wins + toast "Đã cập nhật quyền cho {username}."
- States: toggle optimistic + rollback khi IPC fail (toast Danger + revert); user bị thu hết quyền → empty-state ở landing staff "Tài khoản của bạn chưa được gán quyền nào — liên hệ quản lý." (tránh màn trắng).
- A11y: Switch native `<button role="switch" aria-checked>`; mỗi toggle có mô tả text; thay đổi quyền announce `aria-live="polite"`; contrast badge giữ ≥4.5:1.

---

## §5 Thứ tự triển khai + mục cần DB mới

| Pha | Việc | DB mới | Phụ thuộc |
|---|---|---|---|
| **S1** Hồ sơ | migration-005: +3 cột `users(address, start_date, notes)`; `users:list/update` mở rộng; drawer + edit mở rộng + "Hồ sơ của tôi" + `users:profile*` | 3 cột nullable (tương thích ngược) | Không — làm trước |
| **S2** Hiệu suất | Tab Hiệu suất aggregate từ `activity:list` hiện có; mini bar CSS-only | **Không** | Cần DS-007 backend xong; độc lập S1 |
| **S3** Chấm công | migration-006: bảng `shifts` + `attendance` + seed 3 ca; IPC check-in/out/list/today; màn Chấm công + đối soát | **2 bảng mới** (@database) | Nên sau S1 (dùng hồ sơ NV ở filter); dùng số liệu S2 cho đối soát |
| **S4** Phân quyền | migration-007: +1 cột `users.permissions TEXT NULL`; `resolvePerm` ở IPC liên quan; section Quyền hạn trong edit; menu ẩn theo flags | 1 cột nullable (NULL = full cũ) | **Làm cuối** — mọi guard mới dựa trên hồ sơ (S1) + hành động (S2/S3) đã ổn định |

**Nguyên tắc xuyên pha:** backend luôn fallback (NULL permissions = full; cột profile NULL = "—"); frontend không bao giờ đoán API chưa có (S1d "Đề xuất sửa đổi" V1 chỉ là note; rank staff V1 không có); staff `mine_only` ép ở backend mọi list mới (pattern DS-007 §2).

**Status: verified** (đủ 4 pha, mỗi pha có layout/nav + contract tái-dùng/mới phân biệt rõ + validation + states + a11y; tương thích ngược guard `role` cũ ở S1-nullable/S4-NULL=full; schema mới ghi rõ cho @database: migration-005 3 cột, migration-006 2 bảng, migration-007 1 cột).
