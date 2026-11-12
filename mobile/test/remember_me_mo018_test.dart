import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/data/remember_session_store.dart';
import 'package:parking_mobile/db/app_db.dart';

/// MO-018 — Ghi nhớ đăng nhập local (nối BE-023 concept: token xoay vòng,
/// thu hồi khi logout — TRIỂN KHAI PHIÊN BẢN LOCAL, không gọi IPC/API).
///
/// Pure-logic tests — không chạm sqflite/Keystore (VM test không có
/// platform channel): crypto helpers, backend RAM, quyết định resume
/// [checkResume], message tiếng Việt. Luồng DB (saveSession/isTokenKnown)
/// verify bằng `flutter analyze` + review code (cùng pattern BE-023).
void main() {
  RememberSessionStore storeOf(MemoryRememberBackend backend) =>
      // Chú ý: AppDb.instance chỉ được TRUYỀN vào, không gọi `.db`
      // (gọi là cần platform channel) — các test dưới chỉ dùng backend.
      RememberSessionStore(AppDb.instance, backend: backend);

  StoredRemember stored({
    int userId = 7,
    String token = 'tok-abc',
    String pwFingerprint = 'fp-1',
    int expiresAtMs = 9999999999999,
  }) =>
      StoredRemember(
        userId: userId,
        token: token,
        pwFingerprint: pwFingerprint,
        expiresAtMs: expiresAtMs,
      );

  Map<String, dynamic> userRow({
    int isActive = 1,
    String passwordHash = 'demo:pw1',
  }) => {
        'id': 7,
        'username': '0901234567',
        'password_hash': passwordHash,
        'is_active': isActive,
      };

  group('token + fingerprint (mirror BE-023: 32 bytes, hash-only)', () {
    test('generateToken 43 ký tự base64url, không padding', () {
      final t = RememberSessionStore.generateToken(Random(42));
      expect(t.length, 43);
      expect(t.contains('='), isFalse);
      expect(t.contains('+'), isFalse);
      expect(t.contains('/'), isFalse);
    });

    test('generateToken duy nhất mỗi lần', () {
      final a = RememberSessionStore.generateToken();
      final b = RememberSessionStore.generateToken();
      expect(a, isNot(equals(b)));
    });

    test('tokenHash/fingerprint ổn định + 64 hex + tách domain', () {
      final h1 = RememberSessionStore.tokenHash('tok-abc');
      final h2 = RememberSessionStore.tokenHash('tok-abc');
      expect(h1, equals(h2));
      expect(h1.length, 64);
      expect(RegExp(r'^[0-9a-f]{64}$').hasMatch(h1), isTrue);
      expect(
        RememberSessionStore.tokenHash('tok-abc'),
        isNot(equals(RememberSessionStore.fingerprint('tok-abc'))),
      );
      expect(
        RememberSessionStore.fingerprint('demo:pw1'),
        isNot(equals(RememberSessionStore.fingerprint('demo:pw2'))),
      );
    });

    test('isExpired: bằng mốc = hết hạn (an toàn)', () {
      expect(RememberSessionStore.isExpired(1000, 999), isFalse);
      expect(RememberSessionStore.isExpired(1000, 1000), isTrue);
      expect(RememberSessionStore.isExpired(1000, 1001), isTrue);
    });
  });

  group('MemoryRememberBackend + readStored/clearSecureOnly', () {
    test('readStored null khi chưa lưu gì', () async {
      final store = storeOf(MemoryRememberBackend());
      expect(await store.readStored(), isNull);
    });

    test('readStored parse đủ 4 key; thiếu 1 key → null', () async {
      final backend = MemoryRememberBackend();
      final store = storeOf(backend);
      await backend.write('remember_user_id', '7');
      await backend.write('remember_token', 'tok-abc');
      await backend.write('remember_pw_fp', 'fp-1');
      // Thiếu remember_expires_at → null (không resume nửa vời).
      expect(await store.readStored(), isNull);
      await backend.write('remember_expires_at', '9999999999999');
      final s = await store.readStored();
      expect(s, isNotNull);
      expect(s!.userId, 7);
      expect(s.token, 'tok-abc');
      expect(s.pwFingerprint, 'fp-1');
      expect(s.expiresAtMs, 9999999999999);
    });

    test('clearSecureOnly xóa sạch 4 key (logout)', () async {
      final backend = MemoryRememberBackend();
      final store = storeOf(backend);
      await backend.write('remember_user_id', '7');
      await backend.write('remember_token', 'tok-abc');
      await backend.write('remember_pw_fp', 'fp-1');
      await backend.write('remember_expires_at', '9999999999999');
      await store.clearSecureOnly();
      expect(await store.readStored(), isNull);
    });
  });

  group('checkResume (quyết định resume thuần túy)', () {
    const now = 1000000;

    test('ok khi mọi điều kiện đạt', () {
      final s = stored(
        pwFingerprint:
            RememberSessionStore.fingerprint('demo:pw1'),
        expiresAtMs: now + 1000,
      );
      expect(
        checkResume(
          stored: s,
          nowMs: now,
          tokenKnown: true,
          userRow: userRow(),
        ),
        ResumeVerdict.ok,
      );
    });

    test('hết hạn → expired (ưu tiên trước mọi check khác)', () {
      final s = stored(expiresAtMs: now - 1);
      expect(
        checkResume(
          stored: s,
          nowMs: now,
          tokenKnown: false,
          userRow: null,
        ),
        ResumeVerdict.expired,
      );
    });

    test('token lạ (đã xoay/thu hồi) → unknownToken', () {
      final s = stored(expiresAtMs: now + 1000);
      expect(
        checkResume(
          stored: s,
          nowMs: now,
          tokenKnown: false,
          userRow: userRow(),
        ),
        ResumeVerdict.unknownToken,
      );
    });

    test('user bị xóa → userMissing', () {
      final s = stored(expiresAtMs: now + 1000);
      expect(
        checkResume(
          stored: s,
          nowMs: now,
          tokenKnown: true,
          userRow: null,
        ),
        ResumeVerdict.userMissing,
      );
    });

    test('user bị khóa → locked', () {
      final s = stored(expiresAtMs: now + 1000);
      expect(
        checkResume(
          stored: s,
          nowMs: now,
          tokenKnown: true,
          userRow: userRow(isActive: 0),
        ),
        ResumeVerdict.locked,
      );
    });

    test('đổi pass (fingerprint lệch) → passwordChanged', () {
      final s = stored(
        pwFingerprint:
            RememberSessionStore.fingerprint('demo:pw-CU'),
        expiresAtMs: now + 1000,
      );
      expect(
        checkResume(
          stored: s,
          nowMs: now,
          tokenKnown: true,
          userRow: userRow(passwordHash: 'demo:pw-MOI'),
        ),
        ResumeVerdict.passwordChanged,
      );
    });
  });

  group('resumeMessage (tiếng Việt, rõ hành động)', () {
    test('mọi verdict fail đều có message bắt login/khóa', () {
      expect(
        resumeMessage(ResumeVerdict.expired),
        contains('đăng nhập lại'),
      );
      expect(
        resumeMessage(ResumeVerdict.unknownToken),
        contains('đăng nhập lại'),
      );
      expect(
        resumeMessage(ResumeVerdict.userMissing),
        contains('đăng nhập lại'),
      );
      expect(
        resumeMessage(ResumeVerdict.locked),
        contains('khóa'),
      );
      expect(
        resumeMessage(ResumeVerdict.passwordChanged),
        allOf(contains('đổi mật khẩu'), contains('đăng nhập lại')),
      );
      expect(resumeMessage(ResumeVerdict.ok), isEmpty);
    });
  });
}
