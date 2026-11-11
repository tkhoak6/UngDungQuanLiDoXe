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

    test('slot 24/24 + qua đêm (BE-019): 15p–4h, không khung giờ', () {
      final now = DateTime(2026, 11, 10, 8, 0);
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 11 * 60),
          isNull);
      // 15 phút ok (cũ chặn <1h)
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 9 * 60 + 15),
          isNull);
      // <15p chặn
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 9 * 60 + 10),
          isNotNull);
      // >4h chặn
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 15 * 60),
          isNotNull);
      // qua đêm 23:00→01:00 (2h) ok — KHÔNG còn lỗi quá 22h
      expect(
          Validators.slot(
              date: now,
              now: DateTime(2026, 11, 10, 22, 30),
              fromMin: 23 * 60,
              toMin: 60),
          isNull);
      // ngoài khung cũ 21:00→23:00 ok (không clamp 06:00–22:00)
      expect(
          Validators.slot(
              date: now,
              now: DateTime(2026, 11, 10, 20, 0),
              fromMin: 21 * 60,
              toMin: 23 * 60),
          isNull);
      // start == end chặn
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 9 * 60, toMin: 9 * 60),
          isNotNull);
      // khác today chặn
      expect(
          Validators.slot(
              date: now.subtract(const Duration(days: 1)),
              now: now,
              fromMin: 9 * 60,
              toMin: 11 * 60),
          isNotNull);
      // quá khứ >15p chặn
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 7 * 60, toMin: 9 * 60),
          isNotNull);
      // quá khứ trong 15p cho qua (quick mode chốt giờ bấm nút)
      expect(
          Validators.slot(
              date: now, now: now, fromMin: 7 * 60 + 50, toMin: 9 * 60),
          isNull);
    });
  });
}
