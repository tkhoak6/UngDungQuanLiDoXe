import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Vé QR ký HMAC-SHA256 — mirror 1-1 desktop `src/main/qr-ticket.ts`
/// (BE-018, spec `./specs/qr-anpr.md` §1.2) để QR mobile ↔ desktop
/// verify chéo được.
///
/// Format chốt: `P1.<ticket_code>.<PLATE_NORM>.<IN_TS>.<SIG>`
/// (SIG = base64url HMAC-SHA256 43 ký tự, không padding).
///
/// Pure Dart (không chạm DB/keychain) để unit-test được. Key chỉ đi qua
/// tham số `keyB64` — KHÔNG hardcode, KHÔNG log ở mọi path.
class QrTicket {
  QrTicket._();

  static const String version = 'P1';

  /// Chặn input quá khổ trước khi split/regex (QR thật < 220 ký tự).
  static const int maxLength = 512;

  /// Chuẩn hóa biển số cho payload QR: UPPERCASE + chỉ giữ [A-Z0-9]
  /// (superset của "bỏ -/./space" trong spec — cùng kết quả với biển VN).
  static String normalizePlateForQr(String plate) =>
      plate.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');

  /// `YYYY-MM-DD HH:MM:SS` (DB, coi như UTC — mirror BE) → epoch phút.
  static int checkInToEpochMin(String checkInAt) {
    final iso = '${checkInAt.replaceAll(' ', 'T')}Z';
    final ms = DateTime.tryParse(iso)?.millisecondsSinceEpoch;
    if (ms == null) throw const QrTicketException('Giờ vào vé không hợp lệ');
    return ms ~/ 60000;
  }

  /// Ký vé → chuỗi QR text. Caller tự resolve ticket/plate/check_in_at.
  ///
  /// Trên mobile: chỉ STAFF device (có key trong secure storage) được ký
  /// lúc check-in; customer KHÔNG ký (chỉ render `qr_text` đã lưu).
  static String signTicket({
    required String ticketCode,
    required String licensePlate,
    required String checkInAt,
    required String keyB64,
  }) {
    final ticket = ticketCode.trim();
    if (!RegExp(r'^T-\d{8}-\d{4}$').hasMatch(ticket)) {
      throw const QrTicketException('Mã vé không hợp lệ');
    }
    final plate = normalizePlateForQr(licensePlate);
    if (plate.length < 2) {
      throw const QrTicketException('Biển số không hợp lệ');
    }
    final ts = checkInToEpochMin(checkInAt);
    final unsigned = '$version.$ticket.$plate.$ts';
    final sig = _b64urlEncode(_hmac(unsigned, _keyToBytes(keyB64)));
    return '$unsigned.$sig';
  }

  /// Verify chữ ký offline (máy staff dùng key trong secure storage tự
  /// check mà không cần mạng — spec §1.3.2). Chỉ check format + version
  /// + HMAC. KHÔNG check DB status ở đây (đối soát `parked` do repo làm).
  static QrVerifyLocal verifySignature(String qrText, String keyB64) {
    final text = qrText.trim();
    if (text.isEmpty || text.length > maxLength) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidFormat);
    }
    final parts = text.split('.');
    if (parts.length != 5) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidFormat);
    }
    final ver = parts[0];
    final ticket = parts[1];
    final plate = parts[2];
    final tsRaw = parts[3];
    final sig = parts[4];
    if (ver != version) {
      return const QrVerifyLocal.invalid(QrFailReason.unsupportedVersion);
    }
    if (!RegExp(r'^T-\d{8}-\d{4}$').hasMatch(ticket)) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidFormat);
    }
    if (!RegExp(r'^[A-Z0-9]{2,12}$').hasMatch(plate)) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidFormat);
    }
    if (!RegExp(r'^\d{1,10}$').hasMatch(tsRaw)) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidFormat);
    }
    if (!RegExp(r'^[A-Za-z0-9\-_]{43}$').hasMatch(sig)) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidSignature);
    }
    late final Uint8List key;
    try {
      key = _keyToBytes(keyB64);
    } catch (_) {
      return const QrVerifyLocal.invalid(QrFailReason.noKey);
    }
    final unsigned = '$ver.$ticket.$plate.$tsRaw';
    final expected = _hmac(unsigned, key);
    late final Uint8List actual;
    try {
      actual = _b64urlDecode(sig);
    } catch (_) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidSignature);
    }
    if (actual.length != expected.length ||
        !_constantTimeEqual(actual, expected)) {
      return const QrVerifyLocal.invalid(QrFailReason.invalidSignature);
    }
    return QrVerifyLocal.valid(
      QrPayload(
        version: ver,
        ticketCode: ticket,
        plateNorm: plate,
        epochMin: int.parse(tsRaw),
      ),
    );
  }

  /// Câu tiếng Việt render trực tiếp (inline banner) — copy BE-018.
  static String messageFor(QrFailReason reason, {String? detail}) {
    switch (reason) {
      case QrFailReason.invalidFormat:
        return 'Mã không hợp lệ — kiểm tra lại vé.';
      case QrFailReason.unsupportedVersion:
        return 'Mã phiên bản mới — cập nhật app.';
      case QrFailReason.invalidSignature:
        return 'Mã không hợp lệ — có thể vé giả hoặc chụp nhầm.';
      case QrFailReason.notFound:
        return 'Không tìm thấy vé này trên máy.';
      case QrFailReason.plateMismatch:
        return 'Biển số trong QR khác vé đã lưu — kiểm tra lại.';
      case QrFailReason.alreadyUsed:
        return detail ?? 'Vé đã sử dụng.';
      case QrFailReason.noKey:
        return 'Chưa có khóa xác thực — đăng nhập khi có mạng 1 lần.';
    }
  }

  /// Key hợp lệ = base64/base64url decode ra đúng 32 bytes (mirror BE).
  static bool isValidKeyB64(String s) {
    try {
      final raw = s.contains('-') || s.contains('_')
          ? _b64urlDecode(s)
          : base64.decode(s);
      if (raw.length == 32) return true;
      return base64.decode(s).length == 32;
    } catch (_) {
      return false;
    }
  }

  static Uint8List _keyToBytes(String keyB64) {
    // Lưu chuẩn base64 thường; chấp nhận cả base64url.
    final raw = keyB64.contains('-') || keyB64.contains('_')
        ? _b64urlDecode(keyB64)
        : base64.decode(keyB64);
    if (raw.length != 32) throw const QrTicketException('invalid key');
    return raw;
  }

  static Uint8List _hmac(String message, Uint8List key) {
    final h = Hmac(sha256, key);
    return Uint8List.fromList(h.convert(utf8.encode(message)).bytes);
  }

  static String _b64urlEncode(Uint8List bytes) =>
      base64Url.encode(bytes).replaceAll('=', '');

  static Uint8List _b64urlDecode(String s) {
    var b64 = s.replaceAll('-', '+').replaceAll('_', '/');
    final pad = (4 - (b64.length % 4)) % 4;
    b64 += '=' * pad;
    return base64.decode(b64);
  }

  /// So sánh constant-time — chống timing attack (spec §1.2).
  static bool _constantTimeEqual(Uint8List a, Uint8List b) {
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }
}

/// Payload QR đã verify chữ ký (chưa đối soát DB status).
class QrPayload {
  const QrPayload({
    required this.version,
    required this.ticketCode,
    required this.plateNorm,
    required this.epochMin,
  });

  final String version;
  final String ticketCode;
  final String plateNorm;
  final int epochMin;
}

/// Lý do verify fail — mirror `QrVerifyReason` desktop (bản local).
enum QrFailReason {
  invalidFormat,
  unsupportedVersion,
  invalidSignature,
  notFound,
  plateMismatch,
  alreadyUsed,
  noKey,
}

/// Kết quả verify offline (chữ ký). Đối soát DB (`parked`/`completed`)
/// do [QrTicketRepo] làm sau — mirror `tickets:verify-qr` BE-018.
class QrVerifyLocal {
  const QrVerifyLocal._({this.payload, this.reason});

  const QrVerifyLocal.valid(QrPayload payload) : this._(payload: payload);

  const QrVerifyLocal.invalid(QrFailReason reason) : this._(reason: reason);

  final QrPayload? payload;
  final QrFailReason? reason;

  bool get ok => payload != null;
}

class QrTicketException implements Exception {
  const QrTicketException(this.message);

  final String message;

  @override
  String toString() => 'QrTicketException: $message';
}
