# Khu vực Quản lý mở rộng (DS-011) — Design Spec (3 pha M1→M3)

> Tokens: Primary `#1677FF`, Secondary `#8B5CF6`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Surface `#FFFFFF`, Text `#111827`. Font Plus Jakarta Sans (UI), JetBrains Mono (tiền/timestamp/mã). Scale 12/14/16/20/24/32. Spacing 4/8/12/16/24/32. Quy ước shell/dialog/toast/keyboard/`/`-focus/Esc: xem `./specs/parking-app.md` §Global shell + §Cross-screen rules. Pattern table/filter/toolbar: kế thừa §c (Zones) + §f (Báo cáo). Pattern log/audit: kế thừa `./specs/activity-log.md` (DS-007, `activity:list` + guard admin/staff). Backend columns + views + ma trận quyền: `api-contract.md` §4 (zones) / §8 (sessions fee) / §9 (payments append-only) / §10 (views) / §11 (quyền) / §14 (shifts). Code hiện tại: `src/renderer/pages/RevenuePage.tsx` (filter today/7d/30d/custom + export giả lập client-side) + `src/renderer/pages/DashboardPage.tsx` (staff-safe `reports:dashboard` bundle). Specs only — no code.

## 0. Định vị nav & phân quyền (chung cả 3 pha)

- **Nav item mới:** label "Quản lý", Lucide `Settings2` (fallback `SlidersHorizontal`), vị trí **sau "Báo cáo", trước "Nhật ký"** (cuối nhóm quản trị, trước màn admin-only "Nhân viên").
- **Hiển thị:**
  - Admin: thấy nav, full 3 tabs.
  - Staff: **không thấy nav** (giống màn Nhân viên DS-006). Deep-link → redirect trang mặc định của staff (Check-in), kèm Danger toast "Bạn không có quyền truy cập." (không để màn trắng).
  - Guest: không nav, deep-link → Guest view (giống guard `users-page` §1).
- **Route guard:** render tab content chỉ sau khi role resolve; chưa resolve → skeleton, không nháy nội dung. IPC trả `FORBIDDEN` → Danger banner + nút "Đăng nhập lại" (pattern DS-007 §6).
- **Cấu trúc màn:** 1 màn "Quản lý" + segmented tabs 3 pha: [Báo cáo nâng cao | Cấu hình | An toàn & Sao lưu]. Tab state lưu trong URL query (`?tab=reports|config|safety`) để deep-link + back-button đúng. Tabs `role="tablist"` + arrow-key nav (pattern `staff-area.md` S2 tab Chi tiết/Hiệu suất).

---

## M1 — Báo cáo nâng cao (so sánh kỳ + xuất chi tiết)

### M1.1 Layout

**Tab "Báo cáo nâng cao"** (thay thế dần màn Báo cáo cũ — màn cũ giữ nguyên route, tab mới là bản nâng cấp; frontend redirect nav "Báo cáo" → tab này khi M1 xong, màn cũ ẩn khỏi nav nhưng giữ code 1 release để rollback).

**Filter bar (mở rộng từ RevenuePage hiện tại):**
- Granularity segmented: [Ngày | Tuần | Tháng | Năm] (16, `aria-pressed`). Quyết định: **segmented thay vì auto** — user chốt "tùy chọn", auto-aggregate gây bất ngờ (màn cũ tự gộp >90 ngày bị chê). Giữ Warning note khi range >90 ngày ở granularity Ngày (gợi ý chuyển Tuần).
- Period picker kép: Kỳ A (chính) + toggle "So sánh" bật Kỳ B (phụ). Mỗi kỳ: preset Hôm nay / 7 ngày / 30 ngày / Quý / Năm / Tùy chọn (2 date inputs). Kỳ B default = kỳ liền trước cùng độ dài (VD A = T10/2026 → B = T9/2026), user đổi được.
- Giữ nguyên từ màn cũ: Khu vực multi-select (nâng từ single-select hiện tại — quyết định: multi vì so sánh theo khu), Loại vé select, Xuất Excel + Xuất PDF.

**Summary row (mở rộng từ 3 KPI → 5):** Tổng doanh thu (24/bold mono) + Δ% vs kỳ B (badge Success/Danger + mũi tên, text "+12,4% so với kỳ trước") | Tổng lượt xe + Δ | Trung bình/lượt + Δ | Vé lượt (tỷ trọng %) | Vé tháng (tỷ trọng %). Mỗi KPI có sub-line 12/Text-60 "Kỳ B: X" để neo so sánh.

**Chart (so sánh):** grouped/stacked bar — Kỳ A cột đặc (Primary=vượt lượt, Secondary=vé tháng stacked), Kỳ B cột nhạt cùng vị trí (`rgba` 35% opacity, cùng màu). Legend 4 mục (A-vé lượt, A-vé tháng, B-vé lượt, B-vé tháng) 12px. Height 240 cố định. Dưới chart: toggle "Xem dạng bảng" (pattern §f) — bảng này là aggregate, xem M1.2 cho detail.

**Detail table (MỚI — yêu cầu "chi tiết từng giao dịch, không chỉ tổng"):**
- Toggle "Tổng hợp / Chi tiết" phía trên table (segmented, default Tổng hợp = table group-by-period hiện tại giữ nguyên).
- Tab Chi tiết: table full-width columns: Thời gian (mono 12, `paid_at dd/mm/yyyy HH:mm`) | Mã GD (mono — `payments.id` dạng `GD-000123` hoặc ticket/pass code) | Loại (badge: Vé lượt=Primary tint / Vé tháng=Secondary tint / Điều chỉnh=Warning tint) | Khu vực | Biển số (mono) | Thu ngân (tên + username mono 12) | Phương thức (cash/transfer/card/e_wallet text) | Số tiền (mono, `vi-VN ₫`) | Ghi chú (ellipsis + tooltip).
- Sort: Thời gian DESC default, `aria-sort`; click đảo. Server-side pagination 50/100 per page (detail dày hơn aggregate). Row click → drawer 360px reuse §e (payment + session/pass tóm tắt) — optional V1, frontend được bỏ qua mà vẫn PASS (pattern DS-007 §2 row-click).

### M1.2 Contract — tái dùng / mới (KHÔNG bịa cột)

**Tái dùng (không đổi backend):**
- `v_revenue_daily` + `v_sessions_daily` (§10) cho chart + aggregate table Kỳ A **và** Kỳ B (frontend gọi 2 lần cùng params, khác from/to → so sánh client-side, không cần IPC compare riêng — quyết định: **không thêm `reports:compare`**, 2 calls song song đủ, tránh phình IPC).
- `monthly_passes.price + start_date` compose vé-tháng (RevenuePage hiện tại đã làm — giữ logic, chỉ thêm kỳ B).
- `activity:list` (DS-007 §4) cho cột Thu ngân (JOIN users sẵn có).

**Mới (1 IPC read-only, không cột/bảng mới):**
```ts
// reports:transactions — detail từng giao dịch thu phí theo paid_at
export interface TxListInput {
  from: string;               // YYYY-MM-DD (theo payments.paid_at)
  to: string;                 // YYYY-MM-DD inclusive
  zone_ids?: number[];        // multi-select mới (undefined = tất cả)
  kind?: 'casual' | 'monthly' | 'adjust';  // vé lượt / vé tháng / điều chỉnh (note LIKE 'điều chỉnh%')
  payment_method?: PaymentMethod;
  search?: string;            // ticket_code / pass_code / license_plate LIKE uppercase
  granularity?: 'day' | 'week' | 'month' | 'year'; // server gom tổng hợp khi tab Tổng hợp (đỡ aggregate client)
  limit?: number;             // default 50, max 200
  offset?: number;
}
export interface TxRow {
  paid_at: string;            // ISO8601 UTC (payments.paid_at)
  payment_id: number;         // GD-XXXXXX display
  kind: 'casual' | 'monthly' | 'adjust';   // suy từ session_id/monthly_pass_id + note
  ticket_code: string | null; // sessions.ticket_code | passes.pass_code
  license_plate: string | null;
  zone_code: string | null; zone_name: string | null;
  received_by_name: string | null; received_by_username: string | null; // JOIN users (xóa → null + fallback "— (đã xóa)")
  payment_method: PaymentMethod | null;
  amount: number;             // VND thực thu (payments.amount)
  note: string | null;
}
export interface TxListOutput { rows: TxRow[]; total: number; summary: { revenue: number; tx_count: number; avg: number } }
```
- SQL gợi ý: `SELECT … FROM payments LEFT JOIN parking_sessions … LEFT JOIN monthly_passes … LEFT JOIN vehicles … LEFT JOIN parking_zones … LEFT JOIN users … WHERE date(paid_at) BETWEEN ? AND ? ORDER BY paid_at DESC LIMIT/OFFSET` (+ COUNT cùng filter; `summary` = SUM/COUNT cùng WHERE, không LIMIT).
- **Export Excel chi tiết:** frontend xuất **từ `reports:transactions` full-range** (loop offset tới hết, cap 10.000 dòng/file + Warning "Vượt 10.000 — thu hẹp kỳ"), sheet 1 = Chi tiết (columns trên), sheet 2 = Tổng hợp (aggregate kỳ A vs B). Không xuất từ DOM.
- **Export PDF chi tiết:** PDF = bản in tổng hợp (KPI + chart snapshot + aggregate table) + phụ lục tối đa 500 dòng detail đầu tiên + note "Xem file Excel để đủ N dòng". Quyết định: **PDF không ôm full detail** (PDF hàng nghìn dòng vô dụng + nặng máy in quầy).
- Quyền: admin-only (`reports:revenue` đã admin-only per §11 — giữ). Staff cần đối soát ca mình → dùng tab Hiệu suất `staff-area.md` S2 (đã có `report_self`), không mở M1 cho staff.

### M1.3 Validation
- `from > to` → inline Danger 12 dưới date input + disable Xuất ("Ngày bắt đầu phải ≤ ngày kết thúc").
- Kỳ B trùng/overlap Kỳ A → Warning inline (không chặn): "Hai kỳ giao nhau — Δ% có thể gây hiểu lầm."
- Granularity Năm + range >3 năm → Warning "Khoảng rộng — tổng hợp có thể chậm" + giới hạn 5 năm (from/to cách nhau ≤ 5 năm, vượt → chặn + message).
- Export khi total = 0 → disable cả 2 nút + tooltip "Không có dữ liệu để xuất".
- `zone_ids` rỗng sau multi-select bỏ hết = tất cả (không phải "không khu nào") — ghi rõ dưới filter 12/Text-60.

### M1.4 States
- Loading: chart + KPI + table skeletons cố định chiều cao, `aria-busy`, không shift-layout; đổi Kỳ B → skeleton chỉ chart + Δ badges (giữ table Kỳ A).
- Error: panel retry (pattern §f); `FORBIDDEN` → banner + "Đăng nhập lại".
- Empty: aggregate rỗng → reuse §f ("Không có giao dịch…" + "Mở rộng khoảng ngày"); detail rỗng nhưng aggregate có → "Kỳ này không có giao dịch chi tiết — thử nới phương thức/khu vực" + "Xóa bộ lọc".
- Partial: Kỳ B fail nhưng Kỳ A ok → chart hiện Kỳ A + Warning badge trên Δ "Không tải được kỳ so sánh — Thử lại" (retry chỉ Kỳ B, không mất Kỳ A).
- Export: progress determinate + % mono (pattern §f hiện tại); fail → Danger toast + retry; xong → live region "Xuất xong: bao_cao_chi_tiet_10-2026.xlsx (N dòng)".

### M1.5 A11y
- Segmented granularity + Tổng hợp/Chi tiết: `role="group"`, `aria-pressed`, arrow-key nav.
- Δ% badges: text "+12,4%" luôn kèm chữ (không màu-only); icon mũi tên `aria-hidden`.
- Chart so sánh: `role="img"` + `aria-label` tóm tắt ("Kỳ A 42,1tr (+12,4% vs kỳ B 37,5tr), vé lượt 70%"); bảng aggregate visually-hidden toggle kế bên (pattern §f); cột Kỳ B trong bảng có `scope` rõ.
- Detail table: `<th scope>` + `aria-sort`; tiền/timestamp/mã mono; tiền `vi-VN ₫`; ngày `dd/mm/yyyy HH:mm`.
- Export buttons `aria-busy` + live region; toasts max 3 bottom-right 4s; focus-visible 2px Primary; zoom 200% không chồng (table scroll ngang, sticky cột Thời gian + Tổng).
- Handoff check: demo loading/error/empty/partial-B + keyboard-only pass + 200% zoom (như §Cross-screen rule 5).

---

## M2 — Cấu hình hệ thống (giá / ca / quy tắc phí / thông tin bãi)

### M2.0 Quyết định tổng (user chốt — ghi cứng để @leader/@frontend không làm lại)

| Mục | Quyết định | Lý do |
|---|---|---|
| Giá giờ/ngày theo khu | **MỞ RỘNG màn Khu vực hiện tại** (inline edit trong table §c), KHÔNG tab mới | Giá là thuộc tính của zone row; tách tab mới gây 2 nơi sửa 1 giá → drift |
| Khung ca | **TÁI DÙNG tab "Định nghĩa ca"** trong màn Chấm công (`staff-area.md` S3 + `shifts:update`) | Đã có contract + UI spec; Quản lý chỉ deep-link sang ("Quản lý khung ca →" link sang Chấm công tab Định nghĩa ca) |
| Quy tắc tính phí (30p tối thiểu, ngưỡng ngày 12h) | **Xem + sửa hằng số qua UI, KHÔNG DB mới** (lưu localStorage, backend đọc config file) — xem M2.2 | Quy tắc là hằng số công thức §8, không phải dữ liệu; thêm bảng `fee_rules` là over-engineering V1 |
| Thông tin bãi (tên/địa chỉ/SĐT/logo) | **Lưu localStorage trước** (key `parking.settings.v1`), KHÔNG bảng DB mới V1 | 1 máy quầy = 1 bãi; multi-machine sync là P2 (lúc đó mới thêm bảng `app_settings`) |

### M2.1 Layout — tab "Cấu hình" (4 cards xếp dọc, max-width 720, không table mới)

1. **Card "Giá theo khu" (mở rộng, không phải tab):** table Khu vực hiện tại thêm inline-edit: click giá giờ/giá ngày → thành currency input (mono, suffix ₫) + Enter lưu / Esc hủy. Hoặc nút "Sửa giá" mở dialog 480px reuse §c form (chỉ 2 fields giá + helper "Giá ngày nên ≤ 12× giá giờ"). Quyết định cho frontend: **inline-edit là default**, dialog là fallback khi inline fail a11y QA. Lịch sử giá: không lưu (payments đã snapshot `hourly_rate_applied`/`daily_rate_applied` §8 — đủ đối soát).
2. **Card "Khung ca làm việc":** read-only tóm tắt 3 ca (MORNING 06:00–14:00…) + Button secondary "Quản lý khung ca →" deep-link sang màn Chấm công tab Định nghĩa ca. Không duplicate editor ở đây (1 nguồn sự thật).
3. **Card "Quy tắc tính phí":** 2 number inputs: "Miễn/tối thiểu (phút)" default 30 + "Ngưỡng áp giá ngày (giờ)" default 12 + preview dòng 12/Text-60 "VD: gửi 45 phút → tính 1 giờ × đơn giá; ≥12h → áp giá ngày." + Button primary "Lưu quy tắc". Note Warning: "Đổi quy tắc chỉ áp dụng vé mới check-in sau lúc lưu (vé đang đỗ giữ giá cũ đã snapshot)." Kèm "Khôi phục mặc định (30p / 12h)" text-button + confirm.
4. **Card "Thông tin bãi xe":** inputs Tên bãi* / Địa chỉ / SĐT* (pattern VN `inputmode="tel"`) + logo upload (PNG/JPG ≤ 512KB, preview 96×96 radius 12, nút Xóa logo) + preview header hóa đơn mini (logo + tên + địa chỉ + SĐT — đúng chỗ sẽ in ra). Button primary "Lưu thông tin". Dùng ở: header hóa đơn check-out + header file Excel/PDF xuất ra.

### M2.2 Contract — tái dùng / mới

**Tái dùng (không đổi):**
- Giá khu: `zones:update {id, price_per_hour, price_per_day}` (đã có — chỉ thêm UI inline-edit, không IPC mới).
- Khung ca: `shifts:list` (read) + `shifts:update` (§14) — Quản lý chỉ read + deep-link.
- Công thức phí §8 giữ nguyên; backend đọc hằng số từ config thay vì hardcode (refactor nội bộ backend, không đổi IPC).

**Mới (KHÔNG bảng DB — 2 kênh IPC + localStorage, quyết định §M2.0):**
```ts
// Config kênh đề xuất: app-config:get / app-config:set (Electron store / file JSON cạnh DB)
// Frontend cache localStorage key 'parking.settings.v1' (ghi đè khi IPC trả về), offline vẫn đọc được.
export interface ParkingSettings {
  lot_name: string;            // required, 1–100 ký tự
  address: string | null;      // optional, max 255
  phone: string | null;        // optional, pattern SĐT VN 10 số bắt đầu 0 (validate app, giống §12)
  logo_data_url: string | null;// PNG/JPG dataURL ≤ 512KB (validate size + mime ở app)
  fee_grace_minutes: number;   // default 30, int 0–120
  fee_day_threshold_hours: number; // default 12, int 1–24
  updated_at: string;          // ISO8601 (IPC set)
}
// app-config:get → { data: ParkingSettings } (lần đầu → defaults: grace 30, threshold 12, lot_name "Bãi giữ xe")
// app-config:set { patch: Partial<ParkingSettings> } → validate + persist + { data: ParkingSettings }
// Error: 'INVALID_PHONE' | 'LOGO_TOO_LARGE' (400) | 'INVALID_FEE_RULE' (grace/threshold ngoài biên)
```
- Ràng buộc chéo: `fee_day_threshold_hours × 60 > fee_grace_minutes` (ngưỡng ngày phải lớn hơn tối thiểu) — backend chặn + message "Ngưỡng ngày phải lớn hơn thời gian tối thiểu."
- Logo: không lưu file rời (1 dataURL trong JSON config đủ nhẹ ≤512KB); vượt → từ chối, gợi ý nén.
- P2 (ghi rõ, KHÔNG làm V1): bảng `app_settings` khi cần sync nhiều máy — migration lúc đó, V1 localStorage/file là đủ.

### M2.3 Validation
- Tên bãi trống → inline Danger 12 + disable Lưu. SĐT sai pattern → Danger + ví dụ "VD 0901234567". Địa chỉ >255 → chặn + đếm ký tự live.
- Giá giờ/giá ngày ≤ 0 → chặn; giá ngày < giá giờ → Warning (không chặn, có bãi giá ngày rẻ khuyến mãi) nhưng yêu cầu confirm lần 2 ("Giá ngày thấp hơn giá giờ — xác nhận?").
- `fee_grace_minutes` 0–120, `fee_day_threshold_hours` 1–24; ngoài biên → chặn + message biên. Nút Lưu disabled đến khi form dirty + valid.
- Mọi đổi giá/quy tắc: confirm dialog 480px tóm tắt "Giá giờ A: 20.000 → 25.000₫ (áp dụng vé mới từ bây giờ)" + primary "Xác nhận".

### M2.4 States
- Loading: 4 cards skeleton, `aria-busy`. Error: banner + retry per-card (giá fail không chặn thông tin bãi).
- Dirty-guard: rời tab khi form chưa lưu → confirm "Bỏ thay đổi chưa lưu?" (pattern drawer §e).
- Success: toast Success "Đã lưu quy tắc tính phí — áp dụng vé mới từ bây giờ." (nêu rõ scope để khỏi tưởng đổi ngược vé cũ).
- Logo upload fail (sai định dạng/quá 512KB) → inline Danger dưới preview, giữ logo cũ.

### M2.5 A11y
- Mỗi card là `<section aria-labelledby>`; inputs có `<label>`; currency/number inputs `inputmode="decimal"`/`numeric` + suffix ₫/phút/giờ là text (không nuốt vào value đọc screen reader).
- Logo upload: native `<input type="file" accept="image/png,image/jpeg">` + label rõ; preview `alt="Logo bãi xe"`; nút xóa `aria-label="Xóa logo"`.
- Deep-link ca: link thật (`<a href>` nội bộ), focus-visible; quầy in hóa đơn preview là `role="img"` + `aria-label` tóm tắt.
- Toasts/confirm/Esc/focus-return theo §Cross-screen rules; zoom 200% cards xếp dọc không vỡ.

---

## M3 — Backup & an toàn (sao lưu / khôi phục / nhật ký hệ thống)

### M3.1 Layout — tab "An toàn & Sao lưu" (3 cards dọc, max-width 720)

1. **Card "Sao lưu dữ liệu":** dòng trạng thái ("Lần sao lưu cuối: 24/10/2026 08:00 — file `parking-20261024-0800.db`" 14/mono + badge Success "Tự động hằng ngày 03:00" hoặc Warning "Chưa sao lưu lần nào") + Button primary "Sao lưu ngay (.db)" (progress determinate khi đang copy) + note 12/Text-60 "File .db chứa toàn bộ vé, vé tháng, ca trực. Lưu ra USB/ổ rời."
2. **Card "Khôi phục dữ liệu" (danger zone):** viền Danger 1px + nền tint `rgba(220,38,38,0.04)`. Input file (chỉ `.db`, native picker) → hiện metadata file chọn (tên, dung lượng, ngày sửa mono) → Button Danger "Khôi phục" disabled đến khi đã tick checkbox "Tôi hiểu khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại" + gõ xác nhận tên bãi (type-to-confirm, pattern xóa zone §c guard). Confirm dialog 640px 2 bước: bước 1 tóm tắt (file nguồn, dữ liệu hiện tại sẽ mất: N sessions + M passes, backup tự động trước ghi đè "parking-pre-restore-TIMESTAMP.db") + bước 2 "Đang khôi phục…" progress → xong yêu cầu **khởi động lại app** (Button "Khởi động lại ngay").
3. **Card "Nhật ký hệ thống":** reuse nguyên table `activity:list` DS-007 (toolbar staff-filter admin-only + date + action + search, 5 cột, 3 badges, pagination 20) nhưng **lọc sẵn action thu phí + mở rộng note hiển thị backup/restore/config events nếu có**. Quyết định (xem M3.2): V1 reuse, không bảng audit mới.

### M3.2 Contract — tái dùng / mới

**Tái dùng (không đổi):**
- Nhật ký: `activity:list` DS-007 §4 (check_in/check_out/pass_sale + payment_method) — đủ đối soát "ai thu gì". Config changes (đổi giá/quy tắc) và backup/restore **V1 không có dòng log riêng** — ghi rõ là giới hạn chấp nhận được (xem trade-off dưới).

**Mới (3 IPC Electron, KHÔNG cột/bảng DB mới):**
```ts
// backup:now → copy file SQLite đang mở (checkpoint WAL trước khi copy) ra path user chọn
export interface BackupNowInput { dest_path?: string }  // undefined → mở save-dialog, default name parking-YYYYMMDD-HHmm.db
export interface BackupNowOutput { success: boolean; data?: { path: string; size_bytes: number; backed_up_at: string }; error?: string }
// 'DB_BUSY' (đang transaction check-out) → app retry sau 2s tối đa 3 lần rồi mới báo lỗi
// Tự động hằng ngày 03:00 (main-process job, giữ 7 bản gần nhất, xóa bản cũ + log vào console/main-log)

// restore:from-file { source_path } → 1) auto-backup hiện tại (pre-restore-TIMESTAMP.db)
//   2) validate header SQLite + PRAGMA integrity_check 3) thay file 4) yêu cầu restart
// Error: 'NOT_SQLITE' | 'INTEGRITY_FAIL' | 'SCHEMA_MISMATCH' (app_version trong user_version khác) → từ chối + message rõ
// KHÔNG cho restore khi còn xe đang đỗ (active sessions > 0) → 'HAS_PARKED_VEHICLES' + hướng dẫn check-out hết trước
```
- **Trade-off ghi cứng (để @leader không đòi thêm):** V1 không có bảng `audit_log` riêng → ai đổi giá/sửa quy tắc/backup lúc nào **không hiện** trong Nhật ký hệ thống (chỉ hiện giao dịch thu phí). Muốn log config/backup phải thêm bảng + IPC mới = scope P2 (ghi là M3-P2 trong §4, ước lượng +1 migration + 2 IPC). V1 chấp nhận vì quầy 1 admin.

### M3.3 Validation
- Sao lưu: đích không ghi được (quyền/USB đầy) → Danger toast + message hệ điều hành gốc kèm theo ("Không ghi được E:\\ — kiểm tra dung lượng/quyền.").
- Khôi phục: file không `.db` → chặn ngay ở picker (accept filter) + validate header sau chọn; `integrity_check` fail → từ chối + "File backup hỏng — dùng bản pre-restore hoặc bản cũ hơn."; schema version mismatch → từ chối + "File từ phiên bản app khác (vX vs vY) — cập nhật app trước."
- Type-to-confirm phải khớp chính xác tên bãi (case-sensitive trim); sai → disable nút + hint. Checkbox ghi đè bắt buộc.
- Chặn restore khi `active_sessions > 0` (check qua `reports:dashboard` count) — không có ngoại lệ (tránh mất vé đang đỗ).

### M3.4 States
- Sao lưu: idle → backing-up (progress + `aria-busy`, disable nút) → success toast + cập nhật "Lần sao lưu cuối" + live region; fail → Danger + retry (giữ path đã chọn).
- Khôi phục: idle → file-selected (metadata) → confirming (checkbox + type-in) → restoring (progress, **khóa toàn bộ UI** overlay "Đang khôi phục — không tắt app") → restart-required (màn hình chặn + nút duy nhất "Khởi động lại ngay").
- Nhật ký: reuse DS-007 §6 (loading/error/empty/partial user-xóa) nguyên văn.
- Lần đầu chưa backup lần nào → Warning banner trên cùng tab "Chưa có bản sao lưu nào — Sao lưu ngay trước khi tiếp tục." + CTA.

### M3.5 A11y
- Danger zone: heading + `aria-describedby` cảnh ghi đè; checkbox + type-confirm đều có `<label>`; overlay restoring `role="alertdialog"` + `aria-modal`, focus trap, không Esc được (chặn thoát giữa chừng — ghi rõ lý do trong dialog).
- File inputs native (không custom giả) để screen reader + keyboard tự nhiên; metadata file là text mono đọc được.
- Progress bars `role="progressbar"` + text %; live regions cho xong/fail; restart screen focus tự vào nút duy nhất; zoom 200% cards dọc ok.
- Handoff check: demo sao-lưu-thành-công / restore-bị-chặn (còn xe) / file-hỏng + keyboard-only + 200% zoom.

---

## 4. Thứ tự triển khai + mục cần DB/API mới (cho @leader chia task)

| Pha | Thứ tự | Việc | DB mới? | API/IPC mới? |
|---|---|---|---|---|
| M1 | 1 (làm trước) | `reports:transactions` backend (SQL §M1.2, read-only) | **KHÔNG** (JOIN cột hiện có) | **CÓ** — 1 IPC read-only |
| M1 | 2 | Tab Báo cáo nâng cao frontend (filter kép + compare + detail toggle + export) | — | Tái dùng views §10 + `activity:list` |
| M1 | 3 | Export Excel detail (loop offset, cap 10k) + PDF tổng hợp (cap 500 dòng phụ lục) | — | Dùng M1-1 |
| M2 | 4 | Inline-edit giá zone (frontend) trên `zones:update` hiện có | **KHÔNG** | **KHÔNG** (IPC có sẵn) |
| M2 | 5 | `app-config:get/set` backend (file JSON cạnh DB) + 4 cards frontend + deep-link ca | **KHÔNG** (file/keys, P2 mới bảng) | **CÓ** — 2 IPC config |
| M3 | 6 | `backup:now` + auto-job 03:00 + `restore:from-file` backend | **KHÔNG** (file-level copy) | **CÓ** — 2 IPC (+ 1 job main-process) |
| M3 | 7 | Tab An toàn frontend (2 cards + reuse table `activity:list`) | **KHÔNG** | Tái dùng DS-007 |
| P2 (sau) | — | Bảng `audit_log` (ai đổi giá/config/backup lúc nào) + bảng `app_settings` (sync nhiều máy) | **CÓ** — 2 bảng, migration mới | **CÓ** — IPC log mới |

- **Tổng V1: 0 bảng/cột DB mới, 5 IPC mới** (`reports:transactions`, `app-config:get/set`, `backup:now`, `restore:from-file`), còn lại tái dùng. Không phát minh cột âm thầm — mọi field trong contract M1/M2 đều map 1-1 tới cột §4/§8/§9/§14 hoặc file config mới (ghi rõ).
- Rủi ro chính: export 10k dòng trên máy quầy yếu → loop offset + chunked write, progress thật (không fake %); restore khóa UI → overlay `alertdialog` không Esc.

**Status: verified** (đủ 3 pha M1→M3, mỗi pha có layout/nav-guard + contract tái-dùng/mới phân biệt rõ + validation + states + a11y; thứ tự + bảng DB/API mới chốt ở §4; tương thích tokens/shell/a11y DESIGN.md + pattern DS-007/users-page/staff-area; không sửa spec màn khác, không code).
