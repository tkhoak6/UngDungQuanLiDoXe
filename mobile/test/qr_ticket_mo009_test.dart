import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/qr_ticket.dart';

/// MO-009 V1a — vé QR ký HMAC (mirror BE-018/desktop `qr-ticket.ts`).
///
/// Vector chéo sinh bằng node:crypto (cùng code path với desktop):
/// key = bytes 1..32, ticket T-20261111-0001, plate 51H-12345,
/// check-in 2026-11-11 08:00:00 (UTC) → epoch phút 29906400.
void main() {
  const crossKeyB64 =
      'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
  const crossQr =
      'P1.T-20261111-0001.51H12345.29906400.H-3-lxcUXIVUwBSGK1cmocxQNeguq5CWaz00wq3mB-4';

  group('QrTicket — normalize + epoch (mirror BE)', () {
    test('normalizePlateForQr bỏ -/./space, giữ [A-Z0-9]', () {
      expect(QrTicket.normalizePlateForQr('51H-123.45'), '51H12345');
      expect(QrTicket.normalizePlateForQr(' 29ab 12345 '), '29AB12345');
    });

    test('checkInToEpochMin coi stamp DB như UTC (mirror BE)', () {
      final want =
          DateTime.utc(2026, 11, 11, 8, 0).millisecondsSinceEpoch ~/ 60000;
      expect(QrTicket.checkInToEpochMin('2026-11-11 08:00:00'), want);
      expect(want, 29906400);
    });
  });

  group('QrTicket — ký/verify', () {
    test('vector chéo node:crypto verify OK', () {
      final res = QrTicket.verifySignature(crossQr, crossKeyB64);
      expect(res.ok, isTrue);
      expect(res.payload!.ticketCode, 'T-20261111-0001');
      expect(res.payload!.plateNorm, '51H12345');
      expect(res.payload!.epochMin, 29906400);
    });

    test('signTicket tái tạo đúng vector chéo', () {
      final qr = QrTicket.signTicket(
        ticketCode: 'T-20261111-0001',
        licensePlate: '51H-123.45',
        checkInAt: '2026-11-11 08:00:00',
        keyB64: crossKeyB64,
      );
      expect(qr, crossQr);
    });

    test('sửa 1 ký tự biển → INVALID_SIGNATURE', () {
      final bad = crossQr.replaceFirst('51H12345', '51H12346');
      final res = QrTicket.verifySignature(bad, crossKeyB64);
      expect(res.ok, isFalse);
      expect(res.reason, QrFailReason.invalidSignature);
    });

    test('sửa 1 ký tự SIG → INVALID_SIGNATURE', () {
      final bad = '${crossQr.substring(0, crossQr.length - 1)}A';
      final res = QrTicket.verifySignature(bad, crossKeyB64);
      expect(res.ok, isFalse);
      expect(res.reason, QrFailReason.invalidSignature);
    });

    test('sai key → INVALID_SIGNATURE', () {
      const other = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      final res = QrTicket.verifySignature(crossQr, other);
      expect(res.ok, isFalse);
      expect(res.reason, QrFailReason.invalidSignature);
    });

    test('version lạ → UNSUPPORTED_VERSION', () {
      final bad = crossQr.replaceFirst('P1.', 'P2.');
      final res = QrTicket.verifySignature(bad, crossKeyB64);
      expect(res.ok, isFalse);
      expect(res.reason, QrFailReason.unsupportedVersion);
    });

    test('sai format / quá dài → INVALID_FORMAT', () {
      expect(QrTicket.verifySignature('hello', crossKeyB64).reason,
          QrFailReason.invalidFormat);
      expect(QrTicket.verifySignature('P1.a.b.c.d.e', crossKeyB64).reason,
          QrFailReason.invalidFormat);
      final long = 'P1.${'X' * 600}';
      expect(QrTicket.verifySignature(long, crossKeyB64).reason,
          QrFailReason.invalidFormat);
    });
  });

  group('QrTicket — messageFor tiếng Việt (inline banner)', () {
    test('mọi reason đều có câu Việt render trực tiếp', () {
      final map = {
        QrFailReason.invalidFormat: 'Mã không hợp lệ — kiểm tra lại vé.',
        QrFailReason.unsupportedVersion:
            'Mã phiên bản mới — cập nhật app.',
        QrFailReason.invalidSignature:
            'Mã không hợp lệ — có thể vé giả hoặc chụp nhầm.',
        QrFailReason.notFound: 'Không tìm thấy vé này trên máy.',
        QrFailReason.plateMismatch:
            'Biển số trong QR khác vé đã lưu — kiểm tra lại.',
        QrFailReason.noKey:
            'Chưa có khóa xác thực — đăng nhập khi có mạng 1 lần.',
      };
      for (final e in map.entries) {
        expect(QrTicket.messageFor(e.key), e.value);
      }
    });

    test('alreadyUsed kèm giờ check-out', () {
      expect(
        QrTicket.messageFor(QrFailReason.alreadyUsed,
            detail: 'Vé T-20261111-0001 đã check-out lúc 09:15.'),
        'Vé T-20261111-0001 đã check-out lúc 09:15.',
      );
    });
  });

  group('QrTicket — isValidKeyB64', () {
    test('32 bytes base64 OK, sai độ dài/lạ từ chối', () {
      expect(QrTicket.isValidKeyB64(crossKeyB64), isTrue);
      expect(QrTicket.isValidKeyB64('AAAA'), isFalse);
      expect(QrTicket.isValidKeyB64('không-phải-key'), isFalse);
    });
  });
}
