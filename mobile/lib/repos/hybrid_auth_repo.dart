import 'dart:async';
import 'dart:developer' as dev;

import '../data/pb_auth_remote.dart';
import '../data/pb_client.dart';
import '../data/remember_session_store.dart';
import '../db/app_db.dart';
import '../models/entities.dart';
import 'auth_repo.dart';

/// Nguồn phiên đăng nhập — hiển thị ở Cá nhân/Tôi + màn Trạng thái.
enum AuthSource { remote, local }

class HybridAuthResult {
  const HybridAuthResult(this.user, this.source);

  final AppUser user;
  final AuthSource source;
}

/// Kết quả 1 lần resume remember-me lúc mở app (MO-018).
class RestoreAttempt {
  const RestoreAttempt._(this.user, this.source, this.reason);

  /// Không có phiên remember nào — mở app như guest, không message.
  const RestoreAttempt.none() : this._(null, null, null);

  /// Resume OK — dựng session + xoay token xong.
  const RestoreAttempt.ok(AppUser user, AuthSource source)
      : this._(user, source, null);

  /// Resume fail — caller xóa session + hiện [resumeMessage(reason)].
  const RestoreAttempt.failed(ResumeVerdict reason)
      : this._(null, null, reason);

  final AppUser? user;
  final AuthSource? source;
  final ResumeVerdict? reason;

  bool get resumed => user != null;
}

/// Adapter auth hybrid (MO-003/MO-010): login thử PocketBase trước rớt
/// mạng → local; register local trước, sync server nền best-effort.
///
/// - Login: PB ok → mirror local (để lần sau offline vẫn vào được) → trả
///   [AuthSource.remote]. PB từ chối rõ ràng (sai MK…) mà local lại đúng
///   (tài khoản chỉ có local) → trả [AuthSource.local].
/// - Register: LOCAL TRƯỚC (MO-010, offline-first) → vào app ngay, KHÔNG
///   chặn vì server. Đồng bộ lên PB best-effort nền (fire-and-forget):
///   có mạng thì mirror + đánh dấu, rớt mạng/lỗi server thì bỏ qua để
///   lần sau thử lại — KHÔNG bao giờ ném lỗi server ra UI. Chỉ lỗi
///   local (SĐT sai/trùng trên máy, MK yếu…) mới hiện banner đỏ.
///   Trùng SĐT trên server + chưa có local: remote PHONE_TAKEN được xử
///   lý trong sync nền (thử login + mirror), không chặn luồng chính.
/// - sqflite local giữ nguyên làm fallback/offline mặc định (không xóa).
class HybridAuthRepo {
  HybridAuthRepo(this._local, this._db, this._pbLoader,
      {Future<PbRemoteUser> Function(
        PbClient pb, {
        required String phone,
        required String password,
        required String fullName,
      })? remoteRegister,
      RememberSessionStore? remember})
      : _remoteRegisterOverride = remoteRegister,
        _remember = remember ?? RememberSessionStore(_db);

  final AuthRepo _local;
  final AppDb _db;

  /// Kho remember-me local (MO-018, mirror BE-023 — KHÔNG gọi IPC/API).
  final RememberSessionStore _remember;

  /// Loader do providers.dart cung cấp (tránh import vòng state/*).
  /// Trả null khi chưa khởi tạo được client — lúc đó dùng local thuần.
  final Future<PbClient?> Function() _pbLoader;

  /// Hàm đăng ký remote — mặc định [pbRegisterCustomer]. Tham số inject
  /// chỉ phục vụ test (giả lập online-fail mà không cần mạng/PB thật).
  final Future<PbRemoteUser> Function(
    PbClient pb, {
    required String phone,
    required String password,
    required String fullName,
  })? _remoteRegisterOverride;

  Future<HybridAuthResult> login(String username, String password) async {
    final u = username.trim();
    final pb = await _pbLoader();
    if (pb != null) {
      try {
        final remote = await pbLogin(pb.client, u, password);
        await _mirrorLocal(username: u, password: password, remote: remote);
        final user = await _local.login(u, password);
        return HybridAuthResult(user, AuthSource.remote);
      } on PbOfflineException {
        // Rớt mạng → fallback local bên dưới.
      } on PbAuthFailure catch (e) {
        // Server từ chối nhưng tài khoản có thể chỉ tồn tại local.
        // MO-006: PB gộp "không tồn tại + sai MK" thành WRONG_PASSWORD,
        // còn local phân biệt được — nếu local khẳng định NOT_FOUND thì
        // báo đúng NOT_FOUND (trước đây nuốt thành WRONG_PASSWORD gây
        // hiểu lầm "sai mật khẩu" dù user chưa từng có trong DB mobile).
        try {
          final user = await _local.login(u, password);
          return HybridAuthResult(user, AuthSource.local);
        } on AuthException catch (localErr) {
          dev.log(
            'hybrid login: remote=${e.code} local=${localErr.code} '
            '→ ${resolveRemoteFailure(e, localErr).code}',
            name: 'HybridAuthRepo',
          );
          throw resolveRemoteFailure(e, localErr);
        }
      }
    }
    final user = await _local.login(u, password);
    return HybridAuthResult(user, AuthSource.local);
  }

  /// Đăng ký offline-first (MO-010): local trước, server sync nền.
  ///
  /// - Luôn tạo tài khoản local trước → throw duy nhất lỗi local
  ///   (validation/PHONE_TAKEN trên máy) để UI hiện banner đỏ đúng chỗ.
  /// - Lỗi server (rớt mạng, PB_ERROR, PHONE_TAKEN trên server…) KHÔNG
  ///   ném ra — sync nền tự xử lý, user vào app ngay với
  ///   [AuthSource.local] + note vàng "chưa đồng bộ".
  Future<HybridAuthResult> registerCustomer({
    required String phone,
    required String password,
    required String fullName,
  }) async {
    final user = await _local.registerCustomer(
      phone: phone,
      password: password,
      fullName: fullName,
    );
    unawaited(_syncNewAccountToServer(
      phone: phone.trim(),
      password: password,
      fullName: fullName.trim(),
    ));
    return HybridAuthResult(user, AuthSource.local);
  }

  /// Sync nền tài khoản vừa tạo local lên PocketBase (fire-and-forget).
  ///
  /// Best-effort tuyệt đối: mọi lỗi (loader null, rớt mạng, PB từ chối,
  /// mirror lỗi) đều chỉ log — KHÔNG ném, để lần mở app sau thử lại.
  /// Trùng SĐT trên server → thử login + mirror (user đăng ký lại).
  Future<void> _syncNewAccountToServer({
    required String phone,
    required String password,
    required String fullName,
  }) async {
    try {
      final pb = await _pbLoader();
      if (pb == null) {
        dev.log('register sync: chưa có PB client → để pending',
            name: 'HybridAuthRepo');
        return;
      }
      final register = _remoteRegisterOverride ?? _defaultRemoteRegister;
      try {
        final remote = await register(
          pb,
          phone: phone,
          password: password,
          fullName: fullName,
        );
        await _mirrorLocal(
          username: phone,
          password: password,
          remote: remote,
        );
        dev.log('register sync: ok ($phone)', name: 'HybridAuthRepo');
      } on PbOfflineException {
        dev.log('register sync: offline → pending ($phone)',
            name: 'HybridAuthRepo');
      } on PbAuthFailure catch (e) {
        if (e.code == 'PHONE_TAKEN') {
          try {
            await _remoteLoginAndMirror(pb, phone, password);
            dev.log('register sync: SĐT đã có → login+mirror ok ($phone)',
                name: 'HybridAuthRepo');
          } catch (_) {
            dev.log('register sync: PHONE_TAKEN nhưng login fail → pending',
                name: 'HybridAuthRepo');
          }
        } else {
          dev.log('register sync: server từ chối ${e.code} → pending',
              name: 'HybridAuthRepo');
        }
      }
    } catch (e) {
      // Catch-all: sync nền không bao giờ được crash app/test.
      dev.log('register sync: lỗi không mong đợi → pending ($e)',
          name: 'HybridAuthRepo');
    }
  }

  /// Adapter mặc định: PbClient → PocketBase thô cho [pbRegisterCustomer].
  static Future<PbRemoteUser> _defaultRemoteRegister(
    PbClient pb, {
    required String phone,
    required String password,
    required String fullName,
  }) =>
      pbRegisterCustomer(
        pb.client,
        phone: phone,
        password: password,
        fullName: fullName,
      );

  /// Đăng xuất: xóa phiên PB (nếu có). Session app do UI tự null.
  Future<void> logoutRemote() async {
    final pb = await _pbLoader();
    await pb?.logout();
  }

  /// Lưu phiên remember sau login/register (checkbox ON, default ON).
  /// Best-effort: lỗi (DB/secure storage) không chặn vào app.
  Future<void> persistRememberMe(int userId) async {
    try {
      final hash = await _local.passwordHashOf(userId);
      if (hash == null) return;
      await _remember.saveSession(userId: userId, passwordHash: hash);
    } catch (_) {
      // Remember là tiện ích — login vẫn thành công khi lưu fail.
    }
  }

  /// Thu hồi phiên remember của máy này (logout / tắt checkbox /
  /// đổi máy chủ). Best-effort — không throw để logout không kẹt.
  Future<void> clearRemembered() async {
    try {
      await _remember.clearDevice();
    } catch (_) {
      // Bỏ qua — secure keys có thể đã mất.
    }
  }

  /// Tự login lại khi mở app (MO-018): đọc secure storage → verify FRESH
  /// (còn hạn, token còn trong bảng, user còn, chưa khóa, pass chưa đổi)
  /// → OK thì XOAY token single-use (như BE-023) rồi trả session.
  /// Fail → đã thu hồi + caller hiện message rõ, bắt login lại.
  Future<RestoreAttempt> restoreRemembered() async {
    final StoredRemember stored;
    try {
      final s = await _remember.readStored();
      if (s == null) return const RestoreAttempt.none();
      stored = s;
    } catch (_) {
      return const RestoreAttempt.none();
    }
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (RememberSessionStore.isExpired(stored.expiresAtMs, nowMs)) {
      await clearRemembered();
      return const RestoreAttempt.failed(ResumeVerdict.expired);
    }
    final bool known;
    try {
      known = await _remember.isTokenKnown(stored.token);
    } catch (_) {
      return const RestoreAttempt.none();
    }
    final Map<String, dynamic>? row;
    try {
      row = await _local.userRowById(stored.userId);
    } catch (_) {
      return const RestoreAttempt.none();
    }
    final verdict = checkResume(
      stored: stored,
      nowMs: nowMs,
      tokenKnown: known,
      userRow: row,
    );
    if (verdict != ResumeVerdict.ok || row == null) {
      await clearRemembered();
      return RestoreAttempt.failed(verdict);
    }
    // OK → xoay vòng single-use: token cũ thu hồi, cấp mới.
    try {
      await _remember.saveSession(
        userId: stored.userId,
        passwordHash: row['password_hash'] as String? ?? '',
      );
    } catch (_) {
      return const RestoreAttempt.none();
    }
    final user = await _local.findById(stored.userId);
    if (user == null) {
      await clearRemembered();
      return const RestoreAttempt.failed(ResumeVerdict.userMissing);
    }
    // Nguồn badge: PB còn token hợp lệ (sync, không gọi mạng lúc mở
    // app) → remote, còn lại local. Best-effort tuyệt đối.
    var source = AuthSource.local;
    try {
      final pb = await _pbLoader().timeout(const Duration(seconds: 3));
      if (pb != null && pb.hasSession) source = AuthSource.remote;
    } catch (_) {
      source = AuthSource.local;
    }
    return RestoreAttempt.ok(user, source);
  }

  /// Quyết định lỗi cuối khi remote từ chối + local cũng lỗi (pure — có
  /// unit test, không chạm DB).
  ///
  /// - Local NOT_FOUND: tài khoản chắc chắn không có trên thiết bị này →
  ///   báo đúng NOT_FOUND để UI hướng dẫn tạo/liên hệ admin, thay vì
  ///   WRONG_PASSWORD gộp của PB gây hiểu lầm.
  /// - Còn lại (sai MK local, khóa…): giữ lỗi remote (gộp, không lộ
  ///   local có/không có user — theo chính sách message gộp vì bảo mật).
  static AuthException resolveRemoteFailure(
    PbAuthFailure remote,
    AuthException local,
  ) {
    if (local.code == 'NOT_FOUND') return local;
    return AuthException(remote.code, remote.message);
  }

  Future<HybridAuthResult> _remoteLoginAndMirror(
    PbClient pb,
    String username,
    String password,
  ) async {
    final remote = await pbLogin(pb.client, username, password);
    await _mirrorLocal(username: username, password: password, remote: remote);
    final user = await _local.login(username, password);
    return HybridAuthResult(user, AuthSource.remote);
  }

  /// Mirror user PB → row local để offline vẫn đăng nhập được.
  ///
  /// - Giữ `password_hash` scheme local hiện tại (`demo:<pw>`);
  ///   dùng đúng MK vừa xác thực với server.
  /// - Không đụng `notes`/local-only khác khi update.
  Future<void> _mirrorLocal({
    required String username,
    required String password,
    required PbRemoteUser remote,
  }) async {
    final d = await _db.db;
    final roles = await d.query(
      'roles',
      where: 'name = ?',
      whereArgs: [remote.role],
      limit: 1,
    );
    final int roleId;
    if (roles.isNotEmpty) {
      roleId = roles.first['id'] as int;
    } else {
      final fallback = await d.query(
        'roles',
        where: 'name = ?',
        whereArgs: ['customer'],
        limit: 1,
      );
      roleId = fallback.first['id'] as int;
    }
    final name =
        remote.fullName.isEmpty ? username : remote.fullName;
    final row = <String, Object?>{
      'full_name': name,
      'phone': remote.phone,
      'role_id': roleId,
      'is_active': remote.isActive ? 1 : 0,
      'permissions': remote.permissionsJson,
      'address': remote.address,
      'start_date': remote.startDate,
      'password_hash': 'demo:$password',
      'updated_at': _now(),
    };
    final existing = await d.query(
      'users',
      where: 'username = ?',
      whereArgs: [username],
      limit: 1,
    );
    if (existing.isEmpty) {
      await d.insert('users', {...row, 'username': username});
    } else {
      await d.update(
        'users',
        row,
        where: 'id = ?',
        whereArgs: [existing.first['id']],
      );
    }
  }

  String _now() {
    final n = DateTime.now().toUtc();
    return '${n.year}-${n.month.toString().padLeft(2, '0')}-'
        '${n.day.toString().padLeft(2, '0')} '
        '${n.hour.toString().padLeft(2, '0')}:'
        '${n.minute.toString().padLeft(2, '0')}:'
        '${n.second.toString().padLeft(2, '0')}';
  }
}
