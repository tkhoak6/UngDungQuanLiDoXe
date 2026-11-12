/// Kho remember-me: secure storage (token thô) + bảng `remember_tokens`
/// (hash + hạn). Mọi ghi DB đều prune hết hạn + trần 5 token/user
/// (đúng semantics BE-023).
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../db/app_db.dart';

/// Remember-me local (MO-018) — phiên bản mobile của BE-023
/// (`specs/backend-summary.md` §BE-023: token xoay vòng, thu hồi khi logout).
///
/// KHÁC BIỆT với desktop (cố ý, không gọi IPC/API nào):
/// - Desktop: token lưu file `sessions.json` cạnh DB. Mobile: token THÔ
///   trong Keystore/Keychain (`flutter_secure_storage`), token HASH trong
///   bảng `remember_tokens` của chính DB local (hash-only như BE-023 —
///   đọc DB không suy ra token).
/// - Không brute-force counter như BE-023 (5 sai → khóa 60s): token nằm
///   trong secure storage đã gắn device-unlock của OS; kẻ tấn công cầm DB
///   mà không có token thô thì không resume được (chỉ có hash).
/// - QUYẾT ĐỊNH checkbox default ON (mobile = máy cá nhân; token đã bọc
///   secure storage + xoay vòng + thu hồi khi logout; desktop BE-023 để
///   user tự tick).
///
/// Luồng resume (mở app): đọc secure storage → hết hạn/token lạ → xóa +
/// bắt login; user bị xóa/khóa → xóa + bắt login; `password_hash` đổi
/// (màn Đổi mật khẩu/mirror login mới) → fingerprint lệch → xóa + bắt
/// login lại với message rõ. OK → XOAY VÒNG single-use (như BE-023:
/// token cũ thu hồi ngay, cấp token mới).

/// Backend lưu 4 key remember — tách để test fake không cần Keystore.
abstract class RememberBackend {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Backend thật: Keystore (Android) / Keychain (iOS).
class SecureRememberBackend implements RememberBackend {
  const SecureRememberBackend([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Backend RAM — chỉ dùng cho test VM (không có platform channel).
class MemoryRememberBackend implements RememberBackend {
  final Map<String, String> _map = {};

  @override
  Future<String?> read(String key) async => _map[key];

  @override
  Future<void> write(String key, String value) async {
    _map[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _map.remove(key);
  }
}

/// Snapshot phiên đã lưu trong secure storage (đủ để resume + verify).
class StoredRemember {
  const StoredRemember({
    required this.userId,
    required this.token,
    required this.pwFingerprint,
    required this.expiresAtMs,
  });

  final int userId;
  final String token;
  final String pwFingerprint;
  final int expiresAtMs;
}

/// Kết quả quyết định resume (pure — test được, không chạm DB).
enum ResumeVerdict {
  ok,
  expired,
  unknownToken,
  userMissing,
  locked,
  passwordChanged,
}

/// Message tiếng Việt cho từng lý do bắt login lại (hiển thị ở Login).
String resumeMessage(ResumeVerdict v) {
  switch (v) {
    case ResumeVerdict.ok:
      return '';
    case ResumeVerdict.expired:
      return 'Phiên đăng nhập đã hết hạn — vui lòng đăng nhập lại.';
    case ResumeVerdict.unknownToken:
      return 'Phiên đăng nhập không còn hiệu lực — vui lòng đăng nhập lại.';
    case ResumeVerdict.userMissing:
      return 'Tài khoản không còn trên thiết bị này — vui lòng đăng nhập lại.';
    case ResumeVerdict.locked:
      return 'Tài khoản đã bị khóa — liên hệ quản trị viên.';
    case ResumeVerdict.passwordChanged:
      return 'Bạn đã đổi mật khẩu — vui lòng đăng nhập lại.';
  }
}

/// Quyết định resume thuần túy (mirror logic trong
/// [RememberSessionStore] + [HybridAuthRepo.restoreRemembered], tách ra
/// để unit test không cần sqflite).
///
/// Thứ tự check (giống BE-023: không phân biệt lý do ở tầng token):
/// hết hạn → token lạ → user mất → khóa → đổi pass → ok.
ResumeVerdict checkResume({
  required StoredRemember stored,
  required int nowMs,
  required bool tokenKnown,
  required Map<String, dynamic>? userRow,
}) {
  if (RememberSessionStore.isExpired(stored.expiresAtMs, nowMs)) {
    return ResumeVerdict.expired;
  }
  if (!tokenKnown) return ResumeVerdict.unknownToken;
  if (userRow == null) return ResumeVerdict.userMissing;
  if ((userRow['is_active'] as int? ?? 1) != 1) {
    return ResumeVerdict.locked;
  }
  final fp = RememberSessionStore.fingerprint(
    userRow['password_hash'] as String? ?? '',
  );
  if (fp != stored.pwFingerprint) return ResumeVerdict.passwordChanged;
  return ResumeVerdict.ok;
}

/// Kho remember-me: secure storage (token thô) + bảng `remember_tokens`
/// (hash + hạn). Mọi ghi DB đều prune hết hạn + trần 5 token/user
/// (đúng semantics BE-023).
class RememberSessionStore {
  RememberSessionStore(this._db, {RememberBackend? backend})
      : _backend = backend ?? const SecureRememberBackend();

  final AppDb _db;
  final RememberBackend _backend;

  /// Hạn phiên như BE-023: 30 ngày.
  static const int ttlDays = 30;

  /// Trần token/user như BE-023: 5.
  static const int maxTokensPerUser = 5;

  static const String _kUserId = 'remember_user_id';
  static const String _kToken = 'remember_token';
  static const String _kPwFp = 'remember_pw_fp';
  static const String _kExpires = 'remember_expires_at';

  /// 32 bytes CSPRNG → base64url 43 ký tự (không padding), như BE-023.
  static String generateToken([Random? random]) {
    final r = random ?? Random.secure();
    final bytes = List<int>.generate(32, (_) => r.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  /// Hash lưu DB (hash-only — đọc DB không suy ra token thô).
  static String tokenHash(String rawToken) =>
      sha256.convert(utf8.encode('remember:$rawToken')).toString();

  /// Fingerprint `password_hash` hiện tại — đổi pass là lệch, bắt login.
  /// KHÔNG bao giờ lưu password/mật khẩu thô.
  static String fingerprint(String passwordHash) =>
      sha256.convert(utf8.encode('pwfp:$passwordHash')).toString();

  static bool isExpired(int expiresAtMs, int nowMs) =>
      nowMs >= expiresAtMs;

  /// Cấp (hoặc xoay) token cho user: prune hết hạn → trần 5 → INSERT →
  /// ghi secure storage. Gọi sau login/register (remember ON) và sau mỗi
  /// resume thành công (single-use rotation như BE-023).
  Future<void> saveSession({
    required int userId,
    required String passwordHash,
    DateTime? now,
  }) async {
    final at = now ?? DateTime.now();
    final token = generateToken();
    final expiresAtMs =
        at.millisecondsSinceEpoch + ttlDays * 24 * 3600 * 1000;
    final d = await _db.db;
    final nowS = _fmt(at);
    await d.delete(
      'remember_tokens',
      where: 'expires_at <= ?',
      whereArgs: [at.millisecondsSinceEpoch],
    );
    final mine = await d.query(
      'remember_tokens',
      where: 'user_id = ?',
      whereArgs: [userId],
      orderBy: 'expires_at ASC',
    );
    final overflow = mine.length - (maxTokensPerUser - 1);
    for (var i = 0; i < overflow; i++) {
      await d.delete(
        'remember_tokens',
        where: 'token_hash = ?',
        whereArgs: [mine[i]['token_hash']],
      );
    }
    await d.insert('remember_tokens', {
      'token_hash': tokenHash(token),
      'user_id': userId,
      'expires_at': expiresAtMs,
      'created_at': nowS,
    });
    await _backend.write(_kUserId, '$userId');
    await _backend.write(_kToken, token);
    await _backend.write(_kPwFp, fingerprint(passwordHash));
    await _backend.write(_kExpires, '$expiresAtMs');
  }

  /// Đọc snapshot secure storage — null khi chưa từng remember.
  Future<StoredRemember?> readStored() async {
    final uid = await _backend.read(_kUserId);
    final token = await _backend.read(_kToken);
    final fp = await _backend.read(_kPwFp);
    final exp = await _backend.read(_kExpires);
    final id = int.tryParse(uid ?? '');
    final expiresAtMs = int.tryParse(exp ?? '');
    if (id == null || token == null || token.isEmpty) return null;
    if (fp == null || fp.isEmpty || expiresAtMs == null) return null;
    return StoredRemember(
      userId: id,
      token: token,
      pwFingerprint: fp,
      expiresAtMs: expiresAtMs,
    );
  }

  /// Token thô này còn trong bảng không (đã xoay/thu hồi → false).
  Future<bool> isTokenKnown(String rawToken) async {
    final d = await _db.db;
    final rows = await d.query(
      'remember_tokens',
      where: 'token_hash = ?',
      whereArgs: [tokenHash(rawToken)],
      limit: 1,
    );
    return rows.isNotEmpty;
  }

  /// Thu hồi phiên của máy này: xóa hàng token (nếu đọc được) + xóa sạch
  /// 4 key secure. Best-effort từng bước — không throw để logout/register
  /// đổi máy chủ không bao giờ kẹt.
  Future<void> clearDevice() async {
    String? token;
    try {
      token = await _backend.read(_kToken);
    } catch (_) {
      token = null;
    }
    if (token != null && token.isNotEmpty) {
      try {
        final d = await _db.db;
        await d.delete(
          'remember_tokens',
          where: 'token_hash = ?',
          whereArgs: [tokenHash(token)],
        );
      } catch (_) {
        // DB chưa mở được — key secure bên dưới vẫn xóa.
      }
    }
    await clearSecureOnly();
  }

  /// Chỉ xóa 4 key secure (test được, không chạm DB).
  Future<void> clearSecureOnly() async {
    for (final k in [_kUserId, _kToken, _kPwFp, _kExpires]) {
      try {
        await _backend.delete(k);
      } catch (_) {
        // Bỏ qua — key có thể đã mất.
      }
    }
  }

  String _fmt(DateTime d) {
    final u = d.toUtc();
    String p(int v) => v.toString().padLeft(2, '0');
    return '${u.year}-${p(u.month)}-${p(u.day)} '
        '${p(u.hour)}:${p(u.minute)}:${p(u.second)}';
  }
}
