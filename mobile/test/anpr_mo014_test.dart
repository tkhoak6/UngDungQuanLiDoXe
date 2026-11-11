import 'package:flutter_test/flutter_test.dart';

import 'package:parking_mobile/core/anpr.dart';
import 'package:parking_mobile/data/anpr_recognizer.dart';

/// MO-014 ANPR V1b (spec `./specs/qr-anpr.md` §2.3): normalize + regex VN
/// + display + trích ứng viên + gợi ý fuzzy + mock recognizer.
/// V1 KHÔNG tự sửa OCR — suggest chỉ để hiện "Ý bạn là …?" cho user tap.
void main() {
  group('Anpr.normalize', () {
    test('uppercase + bỏ ký tự ngoài [A-Z0-9]', () {
      expect(Anpr.normalize('51H 123.45'), '51H12345');
      expect(Anpr.normalize('51h-12345'), '51H12345');
      expect(Anpr.normalize('  29ab 12345\n'), '29AB12345');
    });
  });

  group('Anpr.parse (regex VN)', () {
    test('biển chuẩn pass', () {
      expect(Anpr.parse('51H12345'), '51H12345');
      expect(Anpr.parse('51H-12345'), '51H12345');
      expect(Anpr.parse('51H 123.45'), '51H12345');
      expect(Anpr.parse('29AB12345'), '29AB12345');
      expect(Anpr.parse('51H123456'), '51H123456');
    });

    test('biển sai fail → null', () {
      expect(Anpr.parse(''), isNull); // rỗng
      expect(Anpr.parse('ABC'), isNull); // quá ngắn
      expect(Anpr.parse('5112345'), isNull); // thiếu chữ
      expect(Anpr.parse('5H12345'), isNull); // thiếu 1 số đầu
      expect(Anpr.parse('51HHH12345'), isNull); // 3 chữ
      expect(Anpr.parse('51H123'), isNull); // đuôi <4 số
      expect(Anpr.parse('51H1234567'), isNull); // tổng >10
      expect(Anpr.parse('HELLOWORLD'), isNull); // không có số đầu
    });
  });

  group('Anpr.display', () {
    test('chèn "-" sau cụm chữ', () {
      expect(Anpr.display('51H12345'), '51H-12345');
      expect(Anpr.display('29AB12345'), '29AB-12345');
    });

    test('không match → trả nguyên để user sửa tay', () {
      expect(Anpr.display('ABC'), 'ABC');
    });
  });

  group('Anpr.extractCandidates', () {
    test('1 biển rõ trong text', () {
      expect(
        Anpr.extractCandidates('VIETNAM\n51H-12345\nXYZ'),
        ['51H12345'],
      );
    });

    test('OCR tách "51H 12345" thành 2 token → ghép cặp kề', () {
      expect(Anpr.extractCandidates('51H 12345'), ['51H12345']);
    });

    test('nhiều biển → giữ thứ tự, khử trùng', () {
      expect(
        Anpr.extractCandidates('51H12345 xe trước\n29AB12345\n51H12345'),
        ['51H12345', '29AB12345'],
      );
    });

    test('không đọc được → rỗng (caller ở lại camera + warning)', () {
      expect(Anpr.extractCandidates('HELLO\nNO PLATE HERE'), isEmpty);
      expect(Anpr.extractCandidates(''), isEmpty);
    });

    test('chữ thường + gạch vẫn match', () {
      expect(Anpr.extractCandidates('bien 51h-123.45'), ['51H12345']);
    });

    test('OCR tách vụn 4 token vẫn ghép được', () {
      expect(Anpr.extractCandidates('51 H 123 45'), ['51H12345']);
    });
  });

  group('Anpr.suggest (fuzzy, KHÔNG tự sửa)', () {
    test('đã hợp lệ → null (không gợi ý)', () {
      expect(Anpr.suggest('51H12345'), isNull);
      expect(Anpr.suggest('51H-12345'), isNull);
    });

    test('S thay 5 (OCR hay nhầm) → gợi ý 1-tap', () {
      expect(Anpr.suggest('51H1234S'), '51H12345');
    });

    test('0 thay O ở cụm chữ', () {
      // 51O12345 đã hợp lệ (O là chữ) → không gợi ý.
      expect(Anpr.suggest('51O12345'), isNull);
      // 29A812345: 8 ở cụm số là đúng, đã hợp lệ → null.
      expect(Anpr.suggest('29A812345'), isNull);
    });

    test('B thay 8 ở đuôi số → gợi ý', () {
      expect(Anpr.suggest('51H1234B'), '51H12348');
    });

    test('sai quá 1 ký tự → null (về nhập tay)', () {
      expect(Anpr.suggest('ABCDEFGH'), isNull);
      expect(Anpr.suggest('12'), isNull);
    });
  });

  group('AnprRecognizer (mock, không cần camera/model)', () {
    test('OCR text → candidates → confirm', () async {
      final AnprRecognizer rec = FakeAnprRecognizer('xe\n51H 12345\n');
      final text = await rec.recognize('/tmp/shot.jpg');
      final cands = Anpr.extractCandidates(text);
      expect(cands, ['51H12345']);
      await rec.close();
    });

    test('OCR rỗng → rỗng (nhánh "Chưa đọc được")', () async {
      final AnprRecognizer rec = FakeAnprRecognizer('???');
      expect(Anpr.extractCandidates(await rec.recognize('x')), isEmpty);
      await rec.close();
    });
  });
}

/// Giả recognizer trả OCR canned — test nhánh parse/confirm không cần
/// camera thật hay model ML Kit.
class FakeAnprRecognizer implements AnprRecognizer {
  FakeAnprRecognizer(this.text);

  final String text;

  @override
  Future<String> recognize(String imagePath) async => text;

  @override
  Future<void> close() async {}
}
