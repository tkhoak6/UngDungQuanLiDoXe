import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:pocketbase/pocketbase.dart';

import '../core/validators.dart';
import 'pb_client.dart';

/// Tác vụ auth remote qua PocketBase (MO-003).
///
/// Quy ước server (specs/pocketbase-guide.md + pocketbase-collections.json):
/// - 1 auth collection `users`, login bằng `username`
///   (customer username = SĐT, staff = username).
/// - `role` select admin/staff/customer; `email` để trống.
/// - Đăng ký public: `createRule = ""`, ép `role = customer` ở client
///   (P2: thêm hook server ép role chống tự nâng quyền).
///
/// Mọi lỗi trả về [PbAuthFailure] với message tiếng Việt thân thiện —
/// KHÔNG lộ raw (`ClientException.response`) ra UI.
class PbRemoteUser {
  const PbRemoteUser({
    required this.id,
    required this.username,
    required this.fullName,
    required this.phone,
    required this.role,
    required this.isActive,
    required this.permissionsJson,
    required this.address,
    required this.startDate,
  });

  final String id;
  final String username;
  final String fullName;
  final String? phone;
  final String role; // admin | staff | customer
  final bool isActive;
  final String? permissionsJson; // JSON 5 flags, null = full staff cũ
  final String? address;
  final String? startDate;

  static const Set<String> validRoles = {'admin', 'staff', 'customer'};

  factory PbRemoteUser.fromRecord(RecordModel record) {
    final m = record.toJson();
    final rawRole = (m['role'] as String? ?? 'customer').trim();
    final perms = m['permissions'];
    return PbRemoteUser(
      id: record.id,
      username: (m['username'] as String? ?? '').trim(),
      fullName: (m['full_name'] as String? ?? '').trim(),
      phone: _str(m['phone']),
      role: validRoles.contains(rawRole) ? rawRole : 'customer',
      isActive: (m['is_active'] as bool?) ?? true,
      permissionsJson:
          perms == null ? null : (perms is String ? perms : jsonEncode(perms)),
      address: _str(m['address']),
      startDate: _str(m['start_date']),
    );
  }

  static String? _str(Object? v) {
    if (v is! String) return null;
    final t = v.trim();
    return t.isEmpty ? null : t;
  }
}

/// Lỗi auth remote đã Việt hóa (code tương thích [AuthException] local).
class PbAuthFailure implements Exception {
  const PbAuthFailure(this.code, this.message);

  final String code;
  final String message;
}

/// Đăng nhập PB bằng username (SĐT với customer).
/// Sai tài khoản/MK → [PbAuthFailure]; rớt mạng → [PbOfflineException].
Future<PbRemoteUser> pbLogin(
  PocketBase pb,
  String identity,
  String password,
) async {
  final id = identity.trim();
  if (id.length < 3) {
    throw const PbAuthFailure(
      'INVALID',
      'Tên đăng nhập/SĐT chưa đúng.',
    );
  }
  if (password.isEmpty) {
    throw const PbAuthFailure('INVALID', 'Vui lòng nhập mật khẩu.');
  }
  try {
    final auth = await pb
        .collection('users')
        .authWithPassword(id, password)
        .timeout(PbClient.rpcTimeout);
    final user = PbRemoteUser.fromRecord(auth.record);
    if (!user.isActive) {
      pb.authStore.clear();
      throw const PbAuthFailure(
        'LOCKED',
        'Tài khoản đã bị khóa — liên hệ quản trị viên.',
      );
    }
    return user;
  } on PbAuthFailure {
    rethrow;
  } on TimeoutException {
    throw const PbOfflineException();
  } on SocketException {
    throw const PbOfflineException();
  } on ClientException catch (e) {
    throw _mapClientError(e);
  }
}

/// Đăng ký customer mới trên PB (role luôn customer) + login lấy phiên.
/// Trùng SĐT → [PbAuthFailure] code PHONE_TAKEN; rớt mạng → [PbOfflineException].
Future<PbRemoteUser> pbRegisterCustomer(
  PocketBase pb, {
  required String phone,
  required String password,
  required String fullName,
}) async {
  final p = phone.trim();
  final name = fullName.trim();
  final phoneErr = Validators.phone(p);
  if (phoneErr != null) throw PbAuthFailure('INVALID_PHONE', phoneErr);
  final nameErr = Validators.fullName(name);
  if (nameErr != null) throw PbAuthFailure('INVALID_NAME', nameErr);
  final passErr = Validators.password(password);
  if (passErr != null) throw PbAuthFailure('WEAK_PASSWORD', passErr);

  try {
    await pb.collection('users').create(body: {
      'username': p,
      'phone': p,
      'full_name': name,
      'role': 'customer',
      'is_active': true,
      'password': password,
      'passwordConfirm': password,
    }).timeout(PbClient.rpcTimeout);
    // Đăng ký xong login ngay để có phiên (server không auto-login).
    return await pbLogin(pb, p, password);
  } on PbAuthFailure {
    rethrow;
  } on PbOfflineException {
    rethrow;
  } on TimeoutException {
    throw const PbOfflineException();
  } on SocketException {
    throw const PbOfflineException();
  } on ClientException catch (e) {
    throw _mapClientError(e);
  }
}

/// Map ClientException → lỗi Việt, không lộ raw response.
PbAuthFailure _mapClientError(ClientException e) {
  if (e.statusCode == 400) {
    if (_isUniqueViolation(e)) {
      return const PbAuthFailure(
        'PHONE_TAKEN',
        'SĐT đã được đăng ký. Hãy đăng nhập.',
      );
    }
    return const PbAuthFailure(
      'WRONG_PASSWORD',
      'Sai tài khoản hoặc mật khẩu. Kiểm tra lại.',
    );
  }
  if (e.statusCode == 401 || e.statusCode == 403) {
    return const PbAuthFailure(
      'WRONG_PASSWORD',
      'Sai tài khoản hoặc mật khẩu. Kiểm tra lại.',
    );
  }
  if (e.statusCode == 404) {
    return const PbAuthFailure(
      'NOT_FOUND',
      'Tài khoản không tồn tại. Kiểm tra lại SĐT.',
    );
  }
  if (e.statusCode >= 500) {
    return const PbAuthFailure(
      'PB_ERROR',
      'Máy chủ đang bận. Thử lại sau ít phút.',
    );
  }
  return const PbAuthFailure(
    'PB_ERROR',
    'Không kết nối được máy chủ. Thử lại sau.',
  );
}

/// PB trả data.{field}.code = validation_not_unique khi trùng UNIQUE.
bool _isUniqueViolation(ClientException e) {
  final resp = e.response;
  final data = resp['data'];
  if (data is! Map) return false;
  for (final v in data.values) {
    if (v is Map && v['code'] == 'validation_not_unique') return true;
  }
  return false;
}
