# MO-015 — Implementation Summary (Thông báo mobile V1, nối DS-014)

> Spec: `./specs/notifications.md` (§E1–E4, §5 quyền, §6 quiet-hours).
> V1 = local scheduler, KHÔNG FCM. Chỉ chạm `mobile/*`. Không chạy app.

## Quyết định dep (ghi rõ theo contract)

- **`flutter_local_notifications ^23.0.1`** — show ngay + `zonedSchedule`
  exact (`exactAllowWhileIdle`) cho E2/E4 + tap/action handling + channels.
  V23 đổi toàn bộ API sang **named parameters** (`show(id:title:...)`,
  `zonedSchedule(... scheduledDate: ...)`); receivers/action receiver phải
  khai báo tường minh trong `AndroidManifest.xml` (đã làm).
- **`workmanager ^0.10.10`** (CHỌN, không `background_fetch`) — vì cần
  **one-off delayed tasks** (fallback E2/E4 khi thiếu exact-alarm, inexact
  ±15p theo spec §7) + **periodic daily 06:35** (E1 sweep + bù E4).
  `background_fetch` chỉ có periodic ≥15p, không one-off → loại.
- **`timezone ^0.11.2`** — util thuần-Dart cho `zonedSchedule`
  (init `Asia/Ho_Chi_Minh` vì DB lưu wall-clock VN naive).

## File mới — `lib/notifications/`

| File | Nội dung |
|---|---|
| `notification_config.dart` | `QuietHours` (22:00–06:00, sweep bù 06:05), channel ids, task names, prefs keys, deep-link spec, `NotifEvent` |
| `notification_content.dart` | Copy VN E1/E2/E3/E4 + rationale/denied + `NotifPayload` encode `k=v;` + `resolveLink` theo role |
| `notification_logic.dart` | Pure: `daysLeft`, `e1Milestone`, `e2FireTime`, `e4FireTime` (workDate + endsNextDay), `quietBehavior`, `deferToMorning`, `shouldShowFullToast` (cooldown 15p), `shouldShowRationale` (max 2), `shouldShowFallbackBanner` (7 ngày), `resolveTapLink`, `stableIdFor` (E1 10xxx/E2 20xxx/E4 30xxx), `hmToMin` |
| `notification_service.dart` | Wrapper plugin: init/channels, tap stream `NotifTap(payload, actionId)`, permission (permission_handler), exact-alarm, `showNow`/`scheduleExact` (ném `ExactAlarmDenied` → fallback), `launchTap` |
| `notification_scheduler.dart` | `planPassSweep` (dedupe key `e1.<code>.<endDate>.d3/d0`, gộp summary ≥2 vé), `planShiftSweep`, `schedule/cancelReservation` (E2 exact + fallback workmanager one-off), `schedule/cancelShiftReminder` (E4), `runLaunchSweep` (foreground catch-up lúc mở app/login/grant), `runBackgroundDaily` + `runFallbackFire` (workmanager isolate), `notifCallbackDispatcher` |
| `notification_widgets.dart` | `maybeShowRationale` (bottom sheet VN, max 2), `showDeniedGuide` (steps Settings + Mở cài đặt), `NotifFallbackBanner` (role=status, nhớ 7 ngày), `NotifStatusTile` (switch + Mở cài đặt), `maybeToastZoneFull` (cooldown 15p/zone) |
| `notifications.dart` | Barrel |

## File sửa

| File | Thay đổi |
|---|---|
| `pubspec.yaml` | +3 deps (qua `flutter pub add`) |
| `lib/main.dart` | init service + scheduler (try/catch từng bước), đọc `launchTap` → `initialNotifLink/Action` |
| `lib/app.dart` | alias `/passes`, `/reservations`, `/staff/attendance` → route canonical; `ParkingApp` stateful: listen taps → `resolveTapLink` + E2 `cancel_hold` → `?confirm_cancel=1`; launch sweep 1 lần/user sau login |
| `screens/customer_main.dart` | E2 schedule sau giữ thành công + rationale; `focusCode`/`confirmCancel` (highlight viền + sheet mã / dialog hủy); cancel → hủy lịch; fallback banner trong sheet thành công |
| `screens/customer_more.dart` | `highlightCode` (viền + badge pulse 1 lần, tôn reduced-motion); rationale sau đăng ký vé; fallback banner |
| `screens/map_screen.dart` | E3 `_FullZoneBanner` Danger khi zone đầy + nút tìm khu còn chỗ (lazy `availability()`) |
| `screens/staff_ops.dart` | E3 check-in: option khu đầy disabled + toast cooldown 15p + gợi ý khu |
| `screens/staff_attendance.dart` | `openCheckout` (autofocus + banner chốt bù); schedule E4 sau Vào ca + rationale; cancel sau chốt; fallback banner |
| `screens/customer_profile.dart` | `NotifStatusTile` ở Cá nhân + Tôi (staff) |
| `android/.../AndroidManifest.xml` | POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED, VIBRATE + 3 receivers |
| `test/notifications_mo015_test.dart` | 23 tests pure (schedule/dedupe/quiet/cooldown/rationale/fallback/deep-link/payload/copy) |

## Điểm lệch spec có chủ ý (ghi rõ)

1. E2 fallback khi thiếu exact-alarm = workmanager one-off (inexact ±15p) — đúng fallback spec §7.
2. Ban đêm E4 ca NIGHT: `endsNextDay` tường minh (so start/end), không suy từ `checkInAt` (tránh lệch khi mở app sau 06:00).
3. E1 daily sweep khi app kill: lọc theo `owner_phone/userid` lưu prefs lúc foreground (multi-user cùng máy: chỉ sweep owner cuối).
4. iOS/APNs + FCM remote = P2 (ngoài scope).

## Chưa verify (ngoài scope contract — KHÔNG chạy app/build)

- `flutter build apk` (thiếu keystore/CI), tap thật trên Android 13+, exact-alarm permission flow, workmanager isolate với sqflite thật, OEM kill (Xiaomi/Huawei).
- Manual checklist (giữ cho QA): giữ chỗ cách giờ bắt đầu 25p → push trước 20p; tắt exact alarm → vẫn nhắc (±15p); deny quyền → banner + hướng dẫn; quiet 23:00 tạo giữ chỗ 06:10 → push silent.

## Verification

- `flutter analyze` → **No issues found!**
- `flutter test` → **92/92 passed** (69 cũ + 23 mới `notifications_mo015_test.dart`)
- Không `print`/`debugPrint` trong `lib/notifications/`
- Mọi màn data-dependent giữ nguyên loading/error/empty states (chỉ thêm banner/toggle)
