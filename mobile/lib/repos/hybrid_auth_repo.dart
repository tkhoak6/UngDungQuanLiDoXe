import 'dart:developer' as dev;

import '../data/pb_auth_remote.dart';
import '../data/pb_client.dart';
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

/// Adapter auth hybrid (MO-003): thử PocketBase trước, rớt mạng → local.
///
/// - Login: PB ok → mirror local (để lần sau offline vẫn vào được) → trả
///   [AuthSource.remote]. PB từ chối rõ ràng (sai MK…) mà local lại đúng
///   (tài khoản chỉ có local) → trả [AuthSource.local].
/// - Register: PB ok (role customer) → mirror local. Rớt mạng → local.
///   Trùng SĐT trên server → thử login PB luôn (người dùng đăng ký lại);
///   đúng MK → vào app, sai → báo PHONE_TAKEN.
/// - sqflite local giữ nguyên làm fallback/offline mặc định (không xóa).
class HybridAuthRepo {
  HybridAuthRepo(this._local, this._db, this._pbLoader);

  final AuthRepo _local;
  final AppDb _db;

  /// Loader do providers.dart cung cấp (tránh import vòng state/*).
  /// Trả null khi chưa khởi tạo được client — lúc đó dùng local thuần.
  final Future<PbClient?> Function() _pbLoader;

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

  Future<HybridAuthResult> registerCustomer({
    required String phone,
    required String password,
    required String fullName,
  }) async {
    final pb = await _pbLoader();
    if (pb != null) {
      try {
        final remote = await pbRegisterCustomer(
          pb.client,
          phone: phone,
          password: password,
          fullName: fullName,
        );
        await _mirrorLocal(
          username: phone.trim(),
          password: password,
          remote: remote,
        );
        final user = await _local.login(phone.trim(), password);
        return HybridAuthResult(user, AuthSource.remote);
      } on PbOfflineException {
        // Rớt mạng → đăng ký local bên dưới.
      } on PbAuthFailure catch (e) {
        if (e.code == 'PHONE_TAKEN') {
          // SĐT đã có trên server — thử login luôn cho tiện.
          try {
            return await _remoteLoginAndMirror(pb, phone.trim(), password);
          } on PbAuthFailure {
            throw AuthException(e.code, e.message);
          } on PbOfflineException {
            // Mạng chập chờn → để local quyết bên dưới.
          }
        } else {
          throw AuthException(e.code, e.message);
        }
      }
    }
    final user = await _local.registerCustomer(
      phone: phone,
      password: password,
      fullName: fullName,
    );
    return HybridAuthResult(user, AuthSource.local);
  }

  /// Đăng xuất: xóa phiên PB (nếu có). Session app do UI tự null.
  Future<void> logoutRemote() async {
    final pb = await _pbLoader();
    await pb?.logout();
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
