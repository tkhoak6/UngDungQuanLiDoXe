import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/reservations.dart';

/// MO-012 — helpers đặt nhanh 24/24 + qua đêm (BE-019).
void main() {
  group('reservations 24/24 (MO-012)', () {
    test('duration: cùng ngày và qua đêm', () {
      expect(reservationDurationMin(9 * 60, 11 * 60), 120);
      expect(reservationDurationMin(23 * 60, 60), 120); // 23:00→01:00
      expect(reservationDurationMin(0, 12 * 60), 720);
      expect(isOvernight(23 * 60, 60), isTrue);
      expect(isOvernight(9 * 60, 11 * 60), isFalse);
      expect(isOvernight(600, 600), isTrue); // end == start = qua đêm 24h
    });

    test('hhmm vòng 24h', () {
      expect(hhmm(9 * 60 + 30), '09:30');
      expect(hhmm(23 * 60 + 120), '01:00'); // quick 23:00 + 2h
      expect(hhmm(1440), '00:00');
    });

    test('fmtDur phút/giờ', () {
      expect(fmtDur(15), '15 phút');
      expect(fmtDur(120), '2 giờ');
      expect(fmtDur(90), '1 giờ 30 phút');
    });

    test('startEndOf: qua đêm end +1 ngày, hết hạn = end + 20p', () {
      final day = DateTime(2026, 11, 10);
      final r = startEndOf(day, 23 * 60, 60);
      expect(r.start, DateTime(2026, 11, 10, 23, 0));
      expect(r.end, DateTime(2026, 11, 11, 1, 0)); // sang hôm sau
      final exp = r.end.add(const Duration(minutes: 20));
      expect(stampOf(exp), '2026-11-11 01:20:00'); // tràn ngày đúng
      final same = startEndOf(day, 9 * 60, 11 * 60);
      expect(same.end, DateTime(2026, 11, 10, 11, 0));
    });

    test('minutesToExpiry: countdown từ expires_at', () {
      final now = DateTime(2026, 11, 10, 22, 50);
      expect(minutesToExpiry('2026-11-11 01:20:00', now), 150);
      expect(minutesToExpiry('2026-11-10 22:00:00', now), -50);
      expect(minutesToExpiry('not-a-date', now), isNull);
    });
  });
}
