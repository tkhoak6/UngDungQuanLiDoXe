# Parking Mobile V1

Flutter (single codebase Android + iOS) — customer 5 tabs + staff 4 tabs,
offline-first với SQLite local mirror (sqflite). Không động vào app Electron.

## Chạy

```bash
cd mobile
flutter pub get
flutter analyze        # kỳ vọng: không lỗi
flutter test           # unit fee/validators + widget smoke
flutter run            # emulator/device
```

## Tài khoản demo (seed local)

| Vai trò  | Đăng nhập | Mật khẩu    |
|----------|-----------|-------------|
| Customer | 0901234567| customer123 |
| Staff    | staff01   | staff123    |
| Admin    | (bị chặn) | — → màn "Quản trị dùng bản desktop" |

Hoặc "Tiếp tục xem sơ đồ" (guest, không login).

## Lưu ý bảo mật (security gate)

Auth V1 dùng hash demo `'demo:<pw>'` trong SQLite local để chạy độc lập.
Trước khi thay bằng bcrypt/server-sync thật: bắt buộc security review
(OWASP Mobile: không lưu secret/PIN plaintext, dùng flutter_secure_storage,
certificate pinning cho Dio). Xem `lib/repos/auth_repo.dart`.
