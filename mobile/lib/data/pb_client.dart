import 'dart:async';
import 'dart:io';

import 'package:pocketbase/pocketbase.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Kết nối PocketBase singleton (MO-003 — auth trước, data sau).
///
/// - Base URL lưu ở SharedPreferences key [urlKey], mặc định [defaultUrl].
/// - Token + auth record tự persist qua [AsyncAuthStore] ở key [authKey]
///   (SDK tự gọi save/clear — app không cầm token thô).
/// - Đổi URL → xóa phiên cũ để token server cũ không rò sang server mới.
/// - Rớt mạng KHÔNG throw ở tầng này — các hàm remote tự map
///   [SocketException]/[TimeoutException] thành offline để caller fallback.
class PbClient {
  PbClient(this._prefs);

  static const String urlKey = 'pb_url';
  static const String authKey = 'pb_auth';
  static const String defaultUrl = 'https://mqaue7.bot-keep.xyz';

  static const Duration rpcTimeout = Duration(seconds: 15);
  static const Duration healthTimeout = Duration(seconds: 10);

  final SharedPreferences _prefs;
  late PocketBase _pb;

  PocketBase get client => _pb;

  /// URL đang dùng (đã chuẩn hóa; hỏng → default, không throw).
  String get baseUrl {
    try {
      return normalizeUrl(_prefs.getString(urlKey) ?? defaultUrl);
    } on PbConfigException {
      return defaultUrl;
    }
  }

  /// true khi còn token chưa hết hạn trong store (kể cả đang offline).
  bool get hasSession => _pb.authStore.isValid;

  /// Username của phiên đã lưu (nếu có), phục vụ màn Trạng thái.
  String? get savedUsername {
    final m = _pb.authStore.record?.toJson();
    final u = m?['username'];
    return u is String && u.isNotEmpty ? u : null;
  }

  Future<void> init() async {
    final store = AsyncAuthStore(
      save: (String data) async {
        await _prefs.setString(authKey, data);
      },
      initial: _prefs.getString(authKey),
      clear: () async {
        await _prefs.remove(authKey);
      },
    );
    _pb = PocketBase(baseUrl, authStore: store);
  }

  /// Chuẩn hóa + validate URL. Sai → [PbConfigException] (tiếng Việt).
  static String normalizeUrl(String raw) {
    final t = raw.trim().replaceAll(RegExp(r'/+$'), '');
    if (t.isEmpty) return defaultUrl;
    final uri = Uri.tryParse(t);
    if (uri == null ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.host.isEmpty) {
      throw const PbConfigException(
        'URL máy chủ chưa đúng (VD https://pb.example.com).',
      );
    }
    return t;
  }

  /// Đổi server: validate → xóa phiên cũ → lưu URL → dựng lại client.
  Future<void> setUrl(String raw) async {
    final url = normalizeUrl(raw); // throw PbConfigException nếu sai
    await logout();
    await _prefs.setString(urlKey, url);
    await init();
  }

  /// GET /api/health — true khi server sống. Không throw.
  Future<PbHealth> checkHealth() async {
    try {
      final h = await _pb.health.check().timeout(healthTimeout);
      final msg = h.message.trim();
      return PbHealth(
        ok: true,
        message: msg.isEmpty ? 'Máy chủ phản hồi bình thường.' : msg,
      );
    } on TimeoutException {
      return const PbHealth(
        ok: false,
        message: 'Máy chủ không phản hồi (quá 10 giây).',
      );
    } catch (_) {
      return const PbHealth(
        ok: false,
        message: 'Không kết nối được máy chủ. Kiểm tra URL/mạng.',
      );
    }
  }

  /// Làm mới phiên đã lưu (gọi khi mở app / trước tác vụ remote).
  /// 401 → xóa phiên, trả false. Rớt mạng → ném [PbOfflineException].
  Future<bool> refreshSession() async {
    if (!_pb.authStore.isValid) return false;
    try {
      await _pb
          .collection('users')
          .authRefresh()
          .timeout(rpcTimeout);
      return true;
    } on TimeoutException {
      throw const PbOfflineException();
    } on SocketException {
      throw const PbOfflineException();
    } on ClientException catch (e) {
      if (e.statusCode == 401) await logout();
      return false;
    }
  }

  Future<void> logout() async {
    _pb.authStore.clear();
    await _prefs.remove(authKey);
  }
}

/// Kết quả health check — chỉ DTO hiển thị, không lộ raw.
class PbHealth {
  const PbHealth({required this.ok, required this.message});

  final bool ok;
  final String message;
}

/// URL cấu hình sai (lỗi người dùng nhập).
class PbConfigException implements Exception {
  const PbConfigException(this.message);

  final String message;
}

/// Mất mạng/timeout — caller fallback local.
class PbOfflineException implements Exception {
  const PbOfflineException();
}
