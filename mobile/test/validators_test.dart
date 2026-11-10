import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/validators.dart';

void main() {
  group('validators — copy customer-area', () {
    test('phone VN 10 số', () {
      expect(Validators.phone('0901234567'), isNull);
      expect(Validators.phone('123'), isNotNull);
      expect(Validators.phone('1901234567'), isNotNull);
    });

    test('plate normalize + validate', () {
      expect(Validators.normalizePlate(' 51h-12345 '), '51H-12345');
      expect(Validators.plate('51H-12345'), isNull);
      expect(Validators.plate('AB'), isNotNull);
    });

    test('password >= 6', () {
      expect(Validators.password('123456'), isNull);
      expect(Validators.password('123'), isNotNull);
    });

    test('slot V1: today, 1–4h, 06:00–22:00', () {
      final now = DateTime(2026, 11, 10, 8, 0);
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 11 * 60),
          isNull);
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 9 * 60 + 30),
          isNotNull); // < 1h
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 15 * 60),
          isNotNull); // > 4h
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 21 * 60, toMin: 23 * 60),
          isNotNull); // quá 22h
      expect(
          Validators.slot(
              date: now.subtract(const Duration(days: 1)),
              now: now,
              fromMin: 9 * 60,
              toMin: 11 * 60),
          isNotNull); // khác today
    });
  });
}
