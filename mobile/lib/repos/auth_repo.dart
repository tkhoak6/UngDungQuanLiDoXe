import 'dart:convert';

import '../core/validators.dart';
import '../db/app_db.dart';
import '../models/entities.dart';

class AuthException implements Exception {
  const AuthException(this.code, this.message);

  final String code;
  final String message;
}

/// Auth local V1: login-by-username (customer username = SĐT), register customer.
/// SECURITY GATE: demo hash 'demo:<pw>'. Auth production (bcrypt/server)
/// cần security review trước khi thay — xem specs/mobile-implementation-summary.md.
class AuthRepo {
  AuthRepo(this._db);

  final AppDb _db;

  StaffPermissions _perms(String? raw) {
    if (raw == null || raw.trim().isEmpty) {
      return StaffPermissions.defaults;
    }
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return StaffPermissions.fromMap(m);
    } catch (_) {
      return StaffPermissions.defaults;
    }
  }

  Future<AppUser> _toUser(Map<String, dynamic> row) async {
    final d = await _db.db;
    final roles =
        await d.query('roles', where: 'id = ?', whereArgs: [row['role_id']]);
    final roleName =
        roles.isEmpty ? 'customer' : roles.first['name'] as String;
    return AppUser.fromMap({...row, 'role_name': roleName},
        _perms(row['permissions'] as String?));
  }

  Future<AppUser> login(String username, String password) async {
    final d = await _db.db;
    final u = username.trim();
    if (u.length < 3) {
      throw const AuthException('INVALID', 'Tên đăng nhập/SĐT chưa đúng.');
    }
    final rows =
        await d.query('users', where: 'username = ?', whereArgs: [u], limit: 1);
    if (rows.isEmpty) {
      throw const AuthException(
          'NOT_FOUND', 'Tài khoản không tồn tại. Kiểm tra lại SĐT.');
    }
    final row = rows.first;
    if ((row['is_active'] as int) != 1) {
      throw const AuthException('LOCKED', 'Tài khoản đã bị khóa.');
    }
    if (row['password_hash'] != 'demo:$password') {
      throw const AuthException('WRONG_PASSWORD', 'Sai mật khẩu.');
    }
    return _toUser(row);
  }

  Future<AppUser> registerCustomer({
    required String phone,
    required String password,
    required String fullName,
  }) async {
    final p = phone.trim();
    if (Validators.phone(p) != null) {
      throw const AuthException('INVALID_PHONE', 'SĐT chưa đúng.');
    }
    if (Validators.password(password) != null) {
      throw const AuthException('WEAK_PASSWORD', 'Mật khẩu phải ≥6 ký tự.');
    }
    if (Validators.fullName(fullName) != null) {
      throw const AuthException('INVALID_NAME', 'Họ tên chưa đúng.');
    }
    final d = await _db.db;
    final dup = await d.query(
      'users',
      where: 'username = ? OR phone = ?',
      whereArgs: [p, p],
      limit: 1,
    );
    if (dup.isNotEmpty) {
      throw const AuthException('PHONE_TAKEN', 'SĐT đã được đăng ký.');
    }
    final roles = await d.query(
      'roles',
      where: 'name = ?',
      whereArgs: ['customer'],
      limit: 1,
    );
    if (roles.isEmpty) {
      throw const AuthException('NO_ROLE', 'Thiếu role customer.');
    }
    final id = await d.insert('users', {
      'username': p,
      'password_hash': 'demo:$password',
      'full_name': fullName.trim(),
      'phone': p,
      'role_id': roles.first['id'],
    });
    final row =
        (await d.query('users', where: 'id = ?', whereArgs: [id])).first;
    return _toUser(row);
  }

  Future<AppUser> updateProfileName(int userId, String fullName) async {
    final err = Validators.fullName(fullName);
    if (err != null) throw AuthException('INVALID_NAME', err);
    final d = await _db.db;
    await d.update(
      'users',
      {'full_name': fullName.trim(), 'updated_at': _now()},
      where: 'id = ?',
      whereArgs: [userId],
    );
    return _toUser(
        (await d.query('users', where: 'id = ?', whereArgs: [userId])).first);
  }

  Future<void> changePassword({
    required int userId,
    required String current,
    required String fresh,
  }) async {
    final d = await _db.db;
    final row =
        (await d.query('users', where: 'id = ?', whereArgs: [userId])).first;
    if (row['password_hash'] != 'demo:$current') {
      throw const AuthException(
          'INVALID_CURRENT_PASSWORD', 'Mật khẩu hiện tại chưa đúng.');
    }
    final err = Validators.newPassword(fresh, current);
    if (err != null) throw AuthException('WEAK_PASSWORD', err);
    await d.update(
      'users',
      {'password_hash': 'demo:$fresh', 'updated_at': _now()},
      where: 'id = ?',
      whereArgs: [userId],
    );
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
