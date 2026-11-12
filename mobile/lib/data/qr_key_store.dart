import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Lưu `qr_hmac_key` trên device — Keystore (Android) / Keychain (iOS),
/// KHÔNG plain prefs (spec §1.2, §6).
///
/// Key cấp 1 lần sau login staff (V1a mobile local-only: nhập từ màn
/// Cài đặt/“Khóa QR” do admin đọc từ `auth:qr-key` desktop; P2 fetch
/// qua API khi có link server). Rotation: ghi đè key mới (grace 7 ngày
/// do backend chịu — V1 giữ 1 key).
class QrKeyStore {
  QrKeyStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const String keyB64Key = 'qr_hmac_key_b64';
  static const String keyIdKey = 'qr_key_id';

  Future<String?> readKeyB64() => _storage.read(key: keyB64Key);

  Future<int> readKeyId() async {
    final raw = await _storage.read(key: keyIdKey);
    return int.tryParse(raw ?? '') ?? 1;
  }

  Future<bool> get hasKey async => await readKeyB64() != null;

  Future<void> saveKey({required String keyB64, int keyId = 1}) async {
    final clean = keyB64.trim();
    if (clean.isEmpty) throw const QrKeyStoreException('Khóa trống.');
    await _storage.write(key: keyB64Key, value: clean);
    await _storage.write(key: keyIdKey, value: '$keyId');
  }

  Future<void> clear() async {
    await _storage.delete(key: keyB64Key);
    await _storage.delete(key: keyIdKey);
  }
}

class QrKeyStoreException implements Exception {
  const QrKeyStoreException(this.message);

  final String message;

  @override
  String toString() => 'QrKeyStoreException: $message';
}
