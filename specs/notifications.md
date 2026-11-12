# Thông báo đẩy — Notification Spec (DS-014)

> Spec only — KHÔNG code. Tokens kế thừa `DESIGN.md` §2–§10 (Primary `#1677FF`, Success `#16A34A`, Warning `#D97706`, Danger `#DC2626`, Text `#111827`). Font Plus Jakarta Sans + JetBrains Mono (mã vé/mã giữ chỗ/tiền/giờ). Nguồn entities: `api-contract.md`; luồng customer P2/P4: `./specs/customer-area.md`; staff S2/S3: `./specs/staff-area.md`; tab mobile: `./specs/mobile-app.md`.
> Quyết định nền (user chốt "làm hết"): **V1 = local scheduler, KHÔNG server push.** Mobile = `flutter_local_notifications` + `workmanager`/`background_fetch`; Desktop Electron = Windows Toast qua Notification API có sẵn (**KHÔNG FCM desktop**). P2 mới FCM remote push qua PocketBase hooks (server merge đang tạm gác — spec giữ chỗ interface, không triển khai V1).

## 0. Phạm vi V1 (4 sự kiện — chốt)

| # | Sự kiện | Đối tượng | Kênh V1 |
|---|---|---|---|
| E1 | Vé tháng sắp hết hạn (trước 3 ngày + ngày hết) | Customer (mobile + desktop nếu login customer) | Local schedule |
| E2 | Giữ chỗ sắp tới giờ (trước 20p) | Customer đã đặt (P4 `reservations.status='held'`) | Local schedule |
| E3 | Bãi đầy (occupancy ≥100%) | Guest/customer xem Sơ đồ + staff cổng | In-app banner + local toast (mobile) / Toast desktop; KHÔNG spam push mỗi xe ra/vào |
| E4 | Ca chưa chốt khi hết ca 30p | Staff đang trực (`attendance.check_out_at IS NULL`) | Local schedule + banner trong màn Chấm công |

- P2 (không làm V1): FCM remote push (quên vé dù app kill sâu, admin broadcast, nhắc nợ…), iOS APNs, desktop khi app tắt hẳn.
- Nguyên tắc chung: **mọi thông báo đều có deep-link + action rõ + tắt được** (xem §5–§6). Không ping câm (tap phải tới đúng màn).

## 1. E1 — Vé tháng sắp hết hạn

### 1.1 Điều kiện kích hoạt
- Nguồn: `monthly_passes` của chính user (`owner_phone = me.phone` / desktop: user login), `status='active'`.
- Tính `days_left = ceil((end_date 23:59 − now) / 1 ngày)`.
- Bắn khi: `days_left == 3` (nhắc sớm) và `days_left == 0` (ngày hết, sau 07:00 — tôn quiet-hours §6). Không bắn khi đã `expired/cancelled/pending`.
- Scheduler: mobile `workmanager` periodic 1×/ngày (~06:30 sau quiet-hours) quét passes local; desktop `node-schedule` daily 06:30 + check lúc mở app (nếu app mở sau giờ quét mà chưa bắn hôm nay → bắn bù 1 lần).

### 1.2 Nội dung VN (chốt copy)
- Trước 3 ngày — title: `Vé tháng sắp hết hạn` / body: `Vé {pass_code} xe {plate} hết hạn sau 3 ngày ({dd/mm/yyyy}). Mang {tiền} ra quầy để gia hạn.` — tone Warning.
- Ngày hết — title: `Vé tháng hết hạn hôm nay` / body: `Vé {pass_code} xe {plate} hết hạn hôm nay. Gia hạn trước 22:00 để giữ chỗ ưu đãi.` — tone Danger.
- `{tiền}` = giá gói tương đương (công thức staff §e customer-area P3), format `vi-VN ₫` mono.

### 1.3 Deep-link
- Mobile: `/passes` (tab Vé, highlight row `pass_code` — scroll tới + badge pulse 1 lần, không auto-mở form).
- Desktop customer: tab Vé tháng (cùng highlight). Desktop staff xem vé của khách: KHÔNG nhận E1 (tránh spam quầy).

### 1.4 Chống spam
- **Tối đa 2 push/vé/vòng đời**: 1 ở D-3, 1 ở D-0. Không lặp hàng ngày D-2/D-1 (user đã thấy thì đủ; chi tiết còn lại xem trong app badge — mobile tab Vé giữ Warning dot khi `≤7 ngày`, desktop row badge Warning như `DESIGN.md` §10.1).
- Gia hạn xong (`active` mới / `pending` đã gửi) → hủy lịch nhắc vé cũ ngay.
- Nhiều vé cùng user: gộp thành 1 summary nếu ≥2 vé cùng mốc (`+2 vé khác cũng sắp hết — xem chi tiết`), tap → `/passes`.

## 2. E2 — Giữ chỗ sắp tới giờ (ưu tiên cao nhất)

### 2.1 Điều kiện kích hoạt
- Nguồn: `reservations` của mình `status='held'`, `date = today`, `time_from` trong tương lai.
- Bắn **1 lần lúc `time_from − 20p`**. Nếu tạo reservation muộn (cách giờ bắt đầu <20p) → bắn ngay sau khi giữ thành công 30s (thay cho nhắc sớm).
- Scheduler: khi tạo/sync reservation → đặt exact alarm local (`flutter_local_notifications` zonedSchedule / Android `exactAlarm`; desktop `node-schedule` job theo `expires_at/time_from`). Hủy alarm khi `used/expired/cancelled`.
- Countdown trong app (customer-area P4.5 / mobile §2.2) vẫn chạy độc lập — push là nhắc dù app background.

### 2.2 Nội dung VN
- Title: `Sắp tới giờ giữ chỗ` / body: `Mã {R-code} tại khu {zone} từ {HH:mm}. Tới trước {HH:mm + 20p} nếu không chỗ sẽ tự hủy.` + 2 action: `[Xem mã] [Hủy giữ chỗ]`.
- Mã `R-…` hiển thị mono (trong push text thường — client nào hỗ trợ monospace thì dùng, không bắt buộc).

### 2.3 Deep-link
- Mobile: `/reservations` (mở success sheet mã tương ứng). Action `Xem mã` = deep-link có param `?code={R-code}`; action `Hủy` = mở màn confirm hủy (không hủy trực tiếp từ nút push — tránh bấm nhầm).
- Desktop: tab Đặt chỗ, focus card mã.

### 2.4 Chống spam + edge
- 1 push/reservation. Không nhắc lại ở `time_from` đúng giờ (user đã được nhắc 20p trước; đếm ngược trong app đủ).
- Quá giờ không check-in → KHÔNG push "đã hết hạn" riêng (tránh dồn 2 ping liên tiếp); row chuyển badge Hết hạn + hiển thị lần mở app sau (in-app only).
- **E2 được miễn quiet-hours** (§6): giữ chỗ trong khung 06:00–22:00, nhắc trước 20p có thể rơi vào ~05:40–06:00? V1 giữ chỗ trong ngày + giờ bãi 06:00–22:00 → nhắc sớm nhất ~05:40. Cho phép bypass nhưng phát **silent/low-priority** nếu trong 22:00–06:00 (không rung/âm thanh, chỉ hiện trong notification tray).

## 3. E3 — Bãi đầy (occupancy ≥100%)

### 3.1 Điều kiện kích hoạt
- Nguồn: `v_zone_availability` / `ZoneAvailability {total, occupied, free}` per-zone + toàn bãi.
- Ngưỡng: `free == 0` (≥100%) ở **1 zone** → banner zone đó; toàn bãi đầy → banner global. Hồi dưới ngưỡng (có ≥1 chỗ trống) → tự gỡ banner, **không push "đã có chỗ"** (tránh ping-pong khi xe ra/vào liên tục).
- V1 KHÔNG push remote từng biến động occupancy (quá ồn). E3 là **in-app + local toast khi đang mở app**, không phải push đánh thức máy:
  - Mobile `/map`: summary strip chuyển Danger + refresh; Danger dot ở tab Sơ đồ (mobile-app §1.1 badge); tap cell zone đầy → bottom sheet "Khu {code} đã đầy — xem khu khác" + nút chuyển zone còn chỗ.
  - Desktop: zone card banner Danger + disable CTA Check-in (đúng `DESIGN.md` §10.1); Guest map legend giữ nguyên.
- Staff cổng (mobile `/staff/checkin`, desktop check-in): zone dropdown option đầy → disabled + Danger tag (đã có ở mobile §3.1) + inline toast 1 lần/phiên khi vừa đầy: `Khu {code} vừa đầy.`

### 3.2 Nội dung VN
- In-app banner: `Bãi đã đầy ({occupied}/{total}) — vui lòng quay lại sau hoặc chọn khu {gợi ý còn X chỗ}.` + nút `[Tìm khu còn chỗ]`.
- Toast staff 1 lần: `Khu {code} vừa đầy — chuyển sang khu {gợi ý}.`

### 3.3 Deep-link
- Không cần push deep-link V1. Banner nút → `/map` (mobile) / Sơ đồ (desktop), preselect zone còn chỗ gần nhất.

### 3.4 Chống spam
- Cooldown **≥15 phút** cho toast "vừa đầy" cùng zone; banner in-app theo state thật (có/không) nên tự hết ồn.
- Poll giữ nguyên (map 30s, reservations 60s) — không tăng tần suất poll vì E3 (tiết kiệm pin).

## 4. E4 — Ca chưa chốt khi hết ca 30p

### 4.1 Điều kiện kích hoạt
- Nguồn: `attendance` của mình (`user_id = me.id`), row ca hôm nay `check_out_at IS NULL`, `now ≥ shift.end_time + 30p`.
- Bắn 1 lần/ngày/ca. Bao gồm cả ca đêm (end 06:00 → nhắc 06:30 — sau quiet-hours nên phát bình thường).
- Scheduler: desktop/mobile staff đặt job lúc Vào ca (`check-in` → schedule `end+30p`); mở app chấm công cũng re-check bù. Chốt ca xong → hủy job.

### 4.2 Nội dung VN
- Title: `Bạn chưa chốt ca {tên ca}` / body: `Ca {sáng/chiều/tối} {HH:mm–HH:mm} đã hết 30 phút mà chưa chốt. Vào Chấm công để chốt bù ({closing} + ghi chú).` + action `[Chốt ca ngay]`.

### 4.3 Deep-link
- Mobile: `/staff/attendance` (auto-mở sheet Ra ca / chốt bù). Desktop: màn Chấm công + focus card ca + badge "Chốt bù" (staff-area S3.5).

### 4.4 Chống spam
- Tối đa **1 push + 1 banner in-app** ("Bạn chưa chốt ca sáng hôm qua" — S3.5). Không nhắc lại mỗi giờ. Hôm sau vẫn chưa chốt → banner tồn tại, không push thêm (tránh nợ ping chồng chất).

## 5. UX xin quyền (bắt buộc — accessibility first)

### 5.1 Luồng chuẩn (cả 2 nền tảng)
1. **Rationale in-app bằng tiếng Việt TRƯỚC system prompt** (không gọi API xin quyền ngay lần đầu mở app):
   - Trigger hiển thị rationale: sau khi user hoàn thành 1 hành động liên quan đầu tiên (customer: giữ chỗ thành công / đăng ký vé; staff: vào ca lần đầu). Không hiện ngay splash (tỉ lệ deny cao).
   - Copy rationale (bottom sheet mobile / dialog desktop 480px): title `Bật thông báo để không lỡ việc?` + bullets 3 dòng (vé sắp hết · giữ chỗ sắp tới giờ · ca chưa chốt) + 2 nút `[Để sau] [Bật thông báo]` (primary). Note 12: "Chỉ 4 việc quan trọng, không quảng cáo. Tắt bất kỳ lúc nào trong Cài đặt."
2. Bấm `Bật thông báo` → gọi system prompt (`requestPermission` / `Notification.requestPermission`). Bấm `Để sau` → không hỏi lại cho tới hành động liên quan tiếp theo (tối đa 2 lần rationale, lần 3 im luôn — tôn trọng user).
3. Kết quả granted → toast Success `Đã bật thông báo.` + test-schedule E1/E2 hiện có ngay.

### 5.2 Khi bị denied / permanently denied
- Hiện **hướng dẫn mở Cài đặt** (không hiện system prompt lại — OS chặn):
  - Mobile Android: deep-link `app_settings` (`openAppSettings`): `Cài đặt → Ứng dụng → {App} → Thông báo → Bật`. iOS (P2): `Cài đặt → {App} → Thông báo`.
  - Desktop Electron/Windows: `Settings → System → Notifications → {App} → On` + đảm bảo Focus Assist tắt / "Do not disturb" không chặn giờ đó.
- **Fallback banner trong app** (không bỏ rơi user tắt thông báo): strip Warning persistent trên các màn liên quan khi permission denied/blocked: Vé (`Vé {code} hết hạn {dd/mm} — thông báo đang tắt.` + nút `Hướng dẫn bật`), Đặt chỗ (countdown card đậm hơn + text `Thông báo tắt — hãy tự canh giờ`), Chấm công (badge Chốt bù đậm). Banner có nút Đóng (nhớ 7 ngày) + link `Hướng dẫn bật`.
- Toggle trạng thái trong Cá nhân/Tôi (`Thông báo: Bật/Tắt` + nút `Mở cài đặt`) để user kiểm tra lại sau.

### 5.3 A11y
- Rationale dialog/sheet: `role="dialog"` + focus vào title khi mở + Esc/back đóng + trả focus về trigger. Công tắc trạng thái `role="switch" aria-checked`. Banner fallback `role="status"` (không `alert` gây giật SR trừ E2 trong giờ). Contrast badge/text ≥4.5:1 (Warning text `#92400E`, Danger `#B91C1C` trên tint).

## 6. Quiet-hours (22:00–06:00)

| Sự kiện | Trong quiet-hours | Hành vi |
|---|---|---|
| E1 vé sắp hết | Hoãn | Job quét dời sang **06:05** sáng hôm sau (desktop mở app đêm → chỉ badge in-app, không Toast) |
| E2 giữ chỗ | **Bypass nhưng silent** | Vẫn hiện tray (time-critical, user tự đặt) nhưng `priority=low`, không âm thanh/rung; countdown in-app là nguồn chính |
| E3 bãi đầy | Không áp dụng | Vốn in-app only, không push nên không vi phạm giờ im lặng |
| E4 ca đêm | Cho phép | Ca đêm end 06:00 → nhắc 06:30 đã ngoài quiet-hours; ca ngày hết muộn kéo qua 22:00 → hoãn tới 06:05 + banner chốt bù trong app |

- Config: hằng số local `QUIET_START=22:00 / QUIET_END=06:00` (cùng chỗ `ParkingSettings` file local — mobile-app §6). P2 có thể cho user chỉnh giờ (defer, không làm V1).
- `prefers-reduced-motion` / chế độ im lặng OS luôn được tôn trọng (không rung/haptic cho E1/E3/E4; E2 haptic nhẹ chỉ khi ngoài quiet-hours).

## 7. Kiến trúc V1 vs P2 (cho @frontend + backend sau này — spec only)

### V1 — Local scheduler (làm ngay, không server)
- **Mobile** (`flutter_local_notifications` + `workmanager`/`background_fetch`):
  - `NotificationService.scheduleDaily(pass reminders 06:30)` — quét `monthly_passes` local (sqflite/drift mirror).
  - `scheduleReservationAlarm(reservation)` — exact alarm `time_from − 20p`; hủy khi consume/cancel.
  - `scheduleShiftReminder(attendance)` — `end + 30p` khi Vào ca.
  - E3: không schedule — render theo snapshot poll 30s.
  - Android 13+ cần `POST_NOTIFICATIONS` runtime permission (§5); exact alarm cần `SCHEDULE_EXACT_ALARM` — xin kèm rationale, fallback inexact +15p nếu denied (ghi rõ cho Flutter).
- **Desktop Electron** (Windows Toast qua Notification API có sẵn):
  - `node-schedule` daily 06:30 (E1) + per-entity jobs (E2/E4) tạo lúc đặt chỗ/vào ca; **check bù lúc mở app** (app tắt qua đêm → quét ngay khi launch, tôn quiet-hours: nếu đang trong giờ im lặng chỉ badge, không Toast).
  - Toast click → focus đúng route (§1.3–§4.3). Không lưu lịch vào DB — rebuild từ SQLite mỗi launch (đơn giản, không drift).
- Payload local chung: `{event: E1|E2|E4, entity_code, deep_link, scheduled_at}` — cùng shape để P2 thay scheduler bằng FCM mà không đổi UI xử lý.

### P2 — FCM remote push (để sau, server merge xong mới làm)
- Mobile Android: FCM qua Firebase project (checklist §8). iOS: APNs (cần Apple Developer — P2). Desktop: **vẫn local, không FCM** (app desktop luôn mở ở quầy — push remote không thêm giá trị).
- Server (PocketBase hooks / backend sau merge): `onPassExpiring (cron)`, `onReservationCreated (schedule)`, `onShiftUnclosed (cron)` → gửi FCM data-message `{deep_link}`; app render local notification với cùng copy §1–§4 (đảm bảo offline-consistent UX).
- Không đổi contract deep-link, copy VN, quiet-hours, chống spam — P2 chỉ đổi **nguồn trigger** từ local sang remote (fallback local vẫn giữ khi offline).

## 8. Checklist Firebase cho user (V1 Android — user tự tạo)

> @leader chuyển nguyên checklist này cho user. Không cần Firebase cho desktop V1 và iOS V1 (defer P2).

- [ ] 1. Tạo project tại `console.firebase.google.com` (tên gợi ý `parking-app-v1`, region mặc định).
- [ ] 2. Add Android app: package name **phải khớp** `applicationId` trong `android/app/build.gradle` (VD `com.parking.app`) + nickname + SHA-1 debug (lấy bằng `./gradlew signingReport`; SHA-1 release bổ sung khi ký app).
- [ ] 3. Tải `google-services.json` → đặt vào `android/app/google-services.json` (KHÔNG commit key release vào git public — thêm vào `.gitignore` nếu repo public).
- [ ] 4. Bật **Cloud Messaging API (V1)** trong Google Cloud Console của project (FCM legacy API đã tắt — dùng HTTP v1, cần service account ở P2; V1 local chưa gọi API nhưng bật sẵn để khỏi quên).
- [ ] 5. Gửi package name + `google-services.json` lại cho team (hoặc đặt sẵn vào repo private) → @frontend Flutter mới cấu hình `firebase_core` + channel `parking_reminders` (importance high cho E2, default cho E1/E4).
- [ ] 6. Test trên máy Android 13+: cấp quyền thủ công 1 lần, đặt 1 giữ chỗ test cách giờ hiện tại 25p → xác nhận push tới trước 20p.

## Verification

- [x] Đủ 4 sự kiện (E1/E2/E3/E4) — mỗi sự kiện có điều kiện kích hoạt + copy VN + deep-link mobile/desktop + chống spam
- [x] UX xin quyền: rationale Việt trước system prompt + denied → hướng dẫn Cài đặt + fallback banner trong app + toggle trạng thái
- [x] Quiet-hours 22:00–06:00: E1 hoãn 06:05, E2 bypass-silent, E3 n/a, E4 ca đêm 06:30 — có hằng số config
- [x] Phân biệt V1 (local scheduler, desktop Toast không FCM) / P2 (FCM remote, PocketBase hooks) + payload shape chung
- [x] Checklist Firebase 6 bước cho user (project + google-services.json + package/SHA-1 + FCM v1 + channel + test case)

**Status: verified** — spec `./specs/notifications.md` đủ 4 sự kiện + quyền + quiet-hours + checklist Firebase; không code, không sửa spec khác.
