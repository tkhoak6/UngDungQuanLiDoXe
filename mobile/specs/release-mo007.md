# MO-007 — Bản release (ký số + icon/splash) — LẦN 2

## Đã làm
1. **Icon launcher**: chữ P trắng (Arial Bold) trên nền `#1677FF`
   - `android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png` (48/72/96/144/192)
   - Adaptive icon `mipmap-anydpi-v26/ic_launcher(.xml|_round.xml)` + foreground PNG + `values/colors.xml`
2. **Tên app**: `AndroidManifest` label → `Bãi Xe Thông Minh`; `MaterialApp.title` → `Bãi Xe Thông Minh`
3. **Splash branded**: `drawable/launch_background.xml` + `drawable-v21/launch_background.xml`
   nền `#1677FF` + `drawable/splash_logo.png` (P trắng, giữa màn hình)
4. **Ký số release**:
   - `android/upload-keystore.jks` (PKCS12, RSA-2048, alias `parking-upload`, hạn 30 năm) — GITIGNORED
   - `android/key.properties` (passwords) — GITIGNORED
   - `android/app/build.gradle.kts`: `signingConfigs.release` + fallback debug khi thiếu keystore
   - `.gitignore` (+`android/.gitignore` có sẵn): `*.jks`, `*.keystore`, `key.properties`
5. **Build**: `flutter build apk --release` → `build/app/outputs/flutter-apk/app-release.apk` — **58.5 MB**

## Verification
- `flutter analyze`: **No issues found**
- `apksigner verify --print-certs`: Signer DN `CN=Bai Xe Thong Minh, OU=Mobile, O=Parking, L=Hanoi, C=VN` (đúng key release, không phải debug)
- Cài thử trên máy thật: **PENDING user** (không có thiết bị nối vào môi trường build)

## Ghi chú / follow-up
- `applicationId` vẫn `com.example.parking_mobile` (giữ nguyên theo out-of-scope; đổi ID cần quyết định riêng vì ảnh hưởng update + Play listing)
- Chưa bật R8/minify (`--shrink`): giảm size thêm nhưng rủi ro runtime với reflection — đề xuất task riêng + test hồi quy
- **KHÔNG re-run script tạo keystore** (đã xóa): key mới sẽ làm mất khả năng update app đã cài

**Status: `partially_verified`** (analyze 0 issues + APK ký đúng key; chờ user cài thử)
