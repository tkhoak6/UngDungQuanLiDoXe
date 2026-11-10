# Mobile App V1 — Implementation Summary (MO-001, DS-012)

> Flutter single-codebase (Android + iOS). Nằm trong `mobile/`, KHÔNG động
> vào app Electron. Spec: `./specs/mobile-app.md`. Tokens: `DESIGN.md`.
> Entities: `api-contract.md` §1–§14.

## Khung đã dựng

| Nhóm | Files |
|---|---|
| Entry/theme/router | `lib/main.dart`, `lib/app.dart` (GoRouter + StatefulShellRoute, Material3 light/dark, safe-area shells) |
| Tokens/validation/phí | `lib/core/tokens.dart`, `validators.dart` (copy customer-area P1/P3/P4), `fee.dart` (công thức §8: ≤30p→1h, ≥12h→giá ngày, vé tháng→0; gói 12T −10%), `format.dart` |
| Entities 1-1 api-contract | `lib/models/entities.dart` (AppUser, StaffPermissions + STAFF_DEFAULTS + resolvePerm, Zone/Spot/Vehicle/Session/Pass/Reservation/Shift/Attendance, ParkingSettings) |
| Local SQLite mirror | `lib/db/app_db.dart` (sqflite; tables §1–§14 + `pending_sync` ở sessions/payments/reservations/attendance; seed roles/zones A-B-C + spots/staff/customer demo + 1 xe đang đỗ + 1 pass pending) |
| Repos (mine-only) | `lib/repos/auth_repo.dart` (login/register/đổi MK), `parking_repo.dart` (availability/spots/check-in/check-out txn), `customer_repo.dart` (xe/vé/đặt chỗ của tôi + quota 2 + sweep expired), `staff_repo.dart` (shifts/attendance + quy ước ca đêm + SyncQueue stub P2) |
| State | `lib/state/providers.dart` (Riverpod: session/highContrast + repos + offline stream) |
| Widgets dùng chung | `lib/widgets/ui.dart` (AppBadge có text, PlateText/MoneyText mono, PrimaryButton ≥48dp, LoadingList skeleton, EmptyView, ErrorBanner, OfflineStrip, showAppSheet bottom sheet) |
| Guest + Customer | `screens/map_screen.dart` (grid 4 cột, poll 30s, pause khi backgrounded, legend, detail sheet + deep-link đặt chỗ), `customer_main.dart` (đặt chỗ P4), `customer_vehicles.dart` (segmented Xe/Lịch sử), `customer_more.dart` (vé P3), `customer_profile.dart` (P1 + staff Tôi) |
| Staff | `screens/staff_ops.dart` (check-in form + success sheet + haptic; checkout search + preview + thu cash/transfer + lý do giảm giá bắt buộc), `staff_attendance.dart` (card ca hiện tại, Vào/Ra, banner quên chốt, lịch sử 7 ngày) |
| Auth/Admin | `screens/auth.dart` (login SĐT/username + register + guest mode; AdminBlockScreen "Quản trị dùng bản desktop") |
| Tests | `test/fee_test.dart`, `test/validators_test.dart`, `test/widget_test.dart` (badge text + touch target ≥48dp) |

## Nav

- Guest: `/map` + CTA login. Customer shell `/c/*`: Sơ đồ, Đặt chỗ, Xe tôi, Vé, Cá nhân.
- Staff shell `/s/*`: Check-in, Thu phí, Chấm công, Tôi. Guard `permissions` (thiếu `checkin` → toast NO_PERMISSION; thiếu `reservation` → ẩn field mã; thiếu `report_self` → ẩn lịch sử).
- Admin login → `/blocked`, không crash.

## Điểm lệch nhỏ (chấp nhận V1)

- `customer_repo.dart` 372 dòng, `staff_ops.dart` 423, `customer_vehicles.dart` ~330: gom theo repo/màn để dễ review; tách tiếp khi sang P2.
- Auth dùng hash demo `'demo:<pw>'` local — thay bcrypt/server-sync cần **security review** trước (ghi trong `auth_repo.dart` + `mobile/README.md`).
- `flutter analyze` / `flutter test` / `flutter run` CHƯA chạy được: máy build không có Flutter SDK.

## Verification

- [x] Không `print`/`debugPrint` (grep sạch).
- [x] Mọi màn data đều có loading/error/empty (skeleton + banner + empty view).
- [x] Touch target ≥48dp (CTA 48–52, tab 64, icon-button bọc 48, chip padded); bottom sheet thay dialog; SafeArea ở tab bar + CTA sticky.
- [ ] `flutter pub get` + `flutter analyze` + `flutter test`: **chưa chạy** (không có SDK trên máy này).
- [ ] Chạy trên emulator/device: **chưa chạy**.

**Status: `partially_verified`** — code hoàn chỉnh theo spec, chờ chạy toolchain:

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

Demo: customer `0901234567/customer123`, staff `staff01/staff123`, hoặc guest xem sơ đồ.
