# BE-018 — Backend Summary: Vé QR ký số (V1a, nối DS-013)

Spec: `./specs/qr-anpr.md` §1.2–§1.3. KHÔNG camera/quét ở desktop, KHÔNG đổi luồng check-in/out hiện tại.

## Quyết định theo spec

- Format chốt: `P1.<ticket>.<PLATE_NORM>.<epoch_min>.<sig-b64url>` (HMAC-SHA256, key 256-bit, so sánh constant-time).
- Chống dùng lại **bằng DB status** (`parked` mới valid; `completed`/`cancelled` → `ALREADY_USED`), không bằng QR.
- Key sinh lười lần đầu (`crypto.randomBytes(32)`), lưu `app-config.json` (`qr_hmac_key_b64`), KHÔNG hardcode/KHÔNG log/KHÔNG in vào QR.
- Check-out: `CheckOutInput.qr_payload?` optional (backward-compatible) → verify → resolve `ticket_code` → chạy transaction cũ.

## File đã tạo/sửa

| File | Thay đổi |
|---|---|
| `src/main/qr-ticket.ts` (mới) | `signTicket` / `verifyQrSignature` (offline, chỉ check SIG) / `ensureQrHmacKey` / `readQrHmacKey` / `normalizePlateForQr` / epoch_min helpers |
| `src/main/qr-ticket.spec.ts` (mới) | 6 unit test sign/verify |
| `src/main/app-config.ts` | `ParkingSettings` + `withDefaults` + `validateParkingPatch`/`ConfigPatch` nhận `qr_hmac_key_b64` (base64 32 bytes), `qr_key_id` (=1) |
| `src/shared/types.ts` | `ParkingSettings.qr_hmac_key_b64`/`qr_key_id`; `CheckOutInput.qr_payload?`; `QrKeyOutput`/`QrPayloadOutput`/`QrVerifyOutput`/`QrVerifyReason`; ApiMap +3 kênh |
| `src/main/ipc-handlers.ts` | `auth:qr-key` (staff, sinh lười + trả key); `tickets:qr-payload` (staff+checkin, backend ký); `tickets:verify-qr` (staff+checkin, SIG + status + plate-mismatch + fee preview); `sessions:check-out` resolve `qr_payload?` |
| `api-contract.md` | Thêm §17 (3 kênh QR + `qr_payload?` ở check-out) |

## IPC mới (guard + input/output)

- `auth:qr-key` — guard `staff` (admin qua được). Input `void` → `{key_b64, key_id}`. Key sinh 1 lần, lần sau đọc lại.
- `tickets:qr-payload` — guard `staff` + perm `checkin`. Input `{ticket_code}` → `{qr_text, ticket_code, license_plate, check_in_at}`. Vé không tồn tại → `Không tìm thấy vé`.
- `tickets:verify-qr` — guard `staff` + perm `checkin`. Input `{qr_text}` → `{valid, reason?, message?, session?, fee_preview?}`.
  Reasons: `INVALID_FORMAT` / `UNSUPPORTED_VERSION` (→ "cập nhật app") / `INVALID_SIGNATURE` (→ "có thể vé giả") / `NOT_FOUND` / `PLATE_MISMATCH` (SIG đúng nhưng biển DB khác QR) / `ALREADY_USED` (vé completed → kèm `session`, message `đã sử dụng lúc HH:mm`).
- `sessions:check-out` — thêm `qr_payload?` optional. Có QR: verify trước (fail → `Mã không hợp lệ…`; version lạ → `cập nhật app`); QR + ticket_code cùng gửi mà lệch nhau → lỗi; chỉ QR → tự resolve. Không QR → luồng cũ nguyên vẹn.

## Security checklist (security-review)

- [x] KHÔNG hardcode key; sinh bằng `crypto.randomBytes(32)`; KHÔNG `console.log`/log file key ở mọi path (grep `qr_hmac_key_b64` chỉ ở app-config/qr-ticket/types/ipc).
- [x] `auth:qr-key` sau `requireRole('staff')` (đã login); device cất secure storage là việc của mobile (spec).
- [x] So sánh SIG bằng `crypto.timingSafeEqual`; message ký ASCII cố định; input QR giới hạn 512 ký tự + regex whitelist từng field.
- [x] Error message tiếng Việt, không lộ key/raw/internal; `tickets:*` dùng parameterized query.
- [x] `payments` append-only giữ nguyên; check-out vẫn 1 transaction.

## Cho @frontend / mobile

- Check-in xong gọi `tickets:qr-payload {ticket_code}` → render QR từ `qr_text` (ECC M, nền trắng, ≥160dp).
- Check-out: quét → gửi `sessions:check-out {qr_payload, payment_method}` (không cần gõ tay); hoặc verify trước qua `tickets:verify-qr` để preview phí.
- Offline: dùng `auth:qr-key` đã lưu để tự check SIG; thu offline → `pending_sync`, online gọi `tickets:verify-qr` đối soát (vé đã dùng → flag `NEED_REVIEW`, không tự trừ tiền).
- Backup/restore: `.db` + `app-config.json` đi cùng nhau (mất key → mọi QR cũ invalid).

## Verification

- `npx tsc --noEmit` → PASS.
- `npx vitest run src/main/qr-ticket.spec.ts` → 6/6 PASS (ký→verify OK; sửa 1 ký tự biển → `INVALID_SIGNATURE`; sửa 1 ký tự SIG → fail; sai key → fail; version lạ → `UNSUPPORTED_VERSION`; normalize + epoch round-trip).
- Vé completed → `ALREADY_USED`: cover bằng code (handler check `status !== 'parked'`, mirror guard `sessions:preview-fee` hiện có) — chưa chạy DB thật (KHÔNG restart app theo hợp đồng).
