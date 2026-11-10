import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/fee.dart';

void main() {
  group('computeFee — api-contract §8', () {
    test('<= 30 phút tính 1 giờ', () {
      final inT = DateTime(2026, 11, 10, 8, 0);
      final r = computeFee(
        checkIn: inT,
        checkOut: inT.add(const Duration(minutes: 25)),
        hourlyRate: 20000,
        dailyRate: 150000,
      );
      expect(r.hours, 1);
      expect(r.total, 20000);
      expect(r.usedDaily, isFalse);
    });

    test('61 phút ceil thành 2 giờ', () {
      final inT = DateTime(2026, 11, 10, 8);
      final r = computeFee(
        checkIn: inT,
        checkOut: inT.add(const Duration(minutes: 61)),
        hourlyRate: 20000,
        dailyRate: 150000,
      );
      expect(r.hours, 2);
      expect(r.total, 40000);
    });

    test('>= 12 giờ áp giá ngày', () {
      final inT = DateTime(2026, 11, 10, 8);
      final r = computeFee(
        checkIn: inT,
        checkOut: inT.add(const Duration(hours: 13)),
        hourlyRate: 20000,
        dailyRate: 150000,
      );
      expect(r.usedDaily, isTrue);
      expect(r.total, 150000);
    });

    test('vé tháng còn hiệu lực = 0', () {
      final inT = DateTime(2026, 11, 10, 8);
      final r = computeFee(
        checkIn: inT,
        checkOut: inT.add(const Duration(hours: 5)),
        hourlyRate: 20000,
        dailyRate: 150000,
        hasValidPass: true,
      );
      expect(r.total, 0);
    });

    test('giảm giá không âm', () {
      final inT = DateTime(2026, 11, 10, 8);
      final r = computeFee(
        checkIn: inT,
        checkOut: inT.add(const Duration(hours: 1)),
        hourlyRate: 20000,
        dailyRate: 150000,
        discount: 999999,
      );
      expect(r.total, 0);
    });
  });

  group('passPrice — gói 12 tháng -10%', () {
    test('1 tháng = daily*30', () {
      expect(passPrice(pricePerDay: 5000, months: 1), 150000);
    });
    test('12 tháng giảm 10%', () {
      expect(passPrice(pricePerDay: 5000, months: 12), 1620000);
    });
  });
}
