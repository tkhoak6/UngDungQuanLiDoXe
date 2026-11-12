import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:parking_mobile/core/anpr.dart';
import 'package:parking_mobile/data/anpr_recognizer.dart';

/// MO-017 (nối MO-014): phân loại thất bại ANPR + message riêng từng
/// nguyên nhân + ghép biển 2 dòng + toán khung crop. Pure Dart (+1 test
/// engine chạy trên VM), không cần camera/model/thiết bị thật.
void main() {
  // Cần binding để MethodChannel ném MissingPluginException (thay vì
  // FlutterError) khi không có platform — đúng đường wrap thật.
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Anpr.extractCandidates (MO-017: biển 2 dòng)', () {
    test('biển xe máy 2 dòng "65-AB / 829.65" (case screenshot user)', () {
      expect(Anpr.extractCandidates('65-AB\n829.65'), ['65AB82965']);
    });

    test('2 dòng chữ thường + dấu câu vẫn ghép', () {
      expect(Anpr.extractCandidates('65-ab\n829.65'), ['65AB82965']);
    });

    test('dòng rác ghép vào quá dài/sai pattern → tự rớt', () {
      expect(Anpr.extractCandidates('VIETNAM\n51H-12345\nXYZ'), ['51H12345']);
    });

    test('không tạo ứng viên ảo từ 2 biển khác nhau kề dòng', () {
      // "29AB12345"+"51H12345" dài 18 ký tự → rớt parse, giữ nguyên 2 biển.
      expect(
        Anpr.extractCandidates('29AB12345\n51H12345'),
        ['29AB12345', '51H12345'],
      );
    });

    test('hành vi MO-014 giữ nguyên (trong-dòng, token, vụn 4 mảnh)', () {
      expect(Anpr.extractCandidates('51H 12345'), ['51H12345']);
      expect(Anpr.extractCandidates('51 H 123 45'), ['51H12345']);
      expect(Anpr.extractCandidates('HELLO\nNO PLATE HERE'), isEmpty);
    });
  });

  group('Anpr.classify (lỗi thắng trước text)', () {
    test('TimeoutException → timeout', () {
      expect(
        Anpr.classify(error: TimeoutException('slow', const Duration(seconds: 8))),
        AnprFailureKind.timeout,
      );
    });

    test('PlatformException / StateError / Exception → engine', () {
      expect(
        Anpr.classify(
          error: PlatformException(code: 'TextRecognizerError'),
        ),
        AnprFailureKind.engine,
      );
      expect(
        Anpr.classify(error: StateError('recognizer chưa sẵn sàng')),
        AnprFailureKind.engine,
      );
      expect(
        Anpr.classify(
          error: AnprEngineException('TextRecognizerError', 'boom'),
        ),
        AnprFailureKind.engine,
      );
    });

    test('không lỗi + text rỗng/khoảng trắng → empty', () {
      expect(Anpr.classify(text: ''), AnprFailureKind.empty);
      expect(Anpr.classify(text: '  \n '), AnprFailureKind.empty);
    });

    test('không lỗi + có chữ → unmatched', () {
      expect(
        Anpr.classify(text: 'HELLO WORLD'),
        AnprFailureKind.unmatched,
      );
    });

    test('lỗi thắng text (kể cả text dở)', () {
      expect(
        Anpr.classify(error: StateError('x'), text: '51H12345'),
        AnprFailureKind.engine,
      );
    });
  });

  group('Anpr.hintFor (mỗi nguyên nhân 1 message)', () {
    test('đủ 4 message, không rỗng, không còn message chung cũ', () {
      for (final kind in AnprFailureKind.values) {
        final hint = Anpr.hintFor(kind);
        expect(hint, isNotEmpty);
        expect(hint, isNot(contains('Chưa đọc được')));
      }
    });

    test('engine/timeout hướng Thử lại', () {
      expect(Anpr.hintFor(AnprFailureKind.engine), contains('Thử lại'));
      expect(Anpr.hintFor(AnprFailureKind.timeout), contains('Thử lại'));
    });

    test('empty gợi ý flash khi torch tắt, đủ sáng khi torch bật', () {
      expect(
        Anpr.hintFor(AnprFailureKind.empty, torchOn: false),
        contains('flash'),
      );
      expect(
        Anpr.hintFor(AnprFailureKind.empty, torchOn: true),
        contains('đủ sáng'),
      );
    });

    test('unmatched hướng sửa + Điền vào form', () {
      final hint = Anpr.hintFor(AnprFailureKind.unmatched);
      expect(hint, contains('sửa'));
      expect(hint, contains('Điền vào form'));
    });
  });

  group('Anpr.bestEffort + ocrSnippet', () {
    test('lấy dòng có chữ đầu tiên, chuẩn hóa, cắt tối đa 10', () {
      expect(Anpr.bestEffort('\n  65-ab \n829.65'), '65AB');
      expect(Anpr.bestEffort('HELLOWORLD!!!'), 'HELLOWORLD');
      expect(Anpr.bestEffort('ABCDEFGHIJK'), 'ABCDEFGHIJ');
    });

    test('rỗng → rỗng (field để trống cho user gõ)', () {
      expect(Anpr.bestEffort(''), isEmpty);
      expect(Anpr.bestEffort('\n  \n'), isEmpty);
    });

    test('snippet gộp whitespace + cắt 48 + …', () {
      expect(Anpr.ocrSnippet('65-AB\n829.65'), '65-AB 829.65');
      expect(Anpr.ocrSnippet(''), isEmpty);
      final long = List.filled(60, 'X').join();
      final snip = Anpr.ocrSnippet(long);
      expect(snip.length, 49); // 48 + '…'
      expect(snip, endsWith('…'));
    });
  });

  group('AnprCrop (toán khung overlay, pure)', () {
    test('overlay canh giữa viewfinder (số liệu layout sheet)', () {
      // Sheet: preview cao 280, overlay 260×87 (tỉ lệ biển VN ~3:1).
      final f = AnprCrop.overlayFractions(
        boxW: 400,
        boxH: 280,
        overlayW: 260,
        overlayH: 87,
      );
      expect(f[0], closeTo(0.175, 1e-9));
      expect(f[1], closeTo((280 - 87) / 2 / 280, 1e-9));
      expect(f[2], closeTo(0.825, 1e-9));
      expect(f[3], closeTo(1 - (280 - 87) / 2 / 280, 1e-9));
    });

    test('kích thước vô lý → full-frame fallback', () {
      expect(
        AnprCrop.overlayFractions(boxW: 0, boxH: 280, overlayW: 260, overlayH: 87),
        [0, 0, 1, 1],
      );
      // Overlay lớn hơn viewfinder → full-frame (không crash).
      expect(
        AnprCrop.overlayFractions(boxW: 100, boxH: 100, overlayW: 200, overlayH: 50),
        [0, 0, 1, 1],
      );
    });

    test('toPixels map đúng + kẹp biên ảnh', () {
      final box = AnprCrop.toPixels([0.175, 0.25, 0.825, 0.75], 1000, 500);
      expect(box, isNotNull);
      expect(box!.left, 175);
      expect(box.top, 125);
      expect(box.right, 825);
      expect(box.bottom, 375);
      expect(box.width, 650);
      expect(box.height, 250);
    });

    test('toPixels null khi ảnh/tỉ lệ vô lý (caller fallback)', () {
      expect(AnprCrop.toPixels([0, 0, 1, 1], 0, 500), isNull);
      expect(AnprCrop.toPixels([0.5, 0.5, 0.5, 0.5], 1000, 500), isNull);
      expect(AnprCrop.toPixels([0, 0, 1], 1000, 500), isNull);
    });
  });

  group('MlKitAnprRecognizer (lỗi typed, chạy trên VM)', () {
    test('recognize không platform → AnprEngineException (không throw thô)', () {
      final rec = MlKitAnprRecognizer();
      expect(
        rec.recognize('khong-ton-tai.jpg'),
        throwsA(isA<AnprEngineException>()),
      );
      // Không await close() ở đây — engine thật không tồn tại trên VM.
    });

    test('AnprEngineException giữ code/message gốc', () {
      final e = AnprEngineException('TextRecognizerError', 'boom');
      expect(e.code, 'TextRecognizerError');
      expect('$e', contains('boom'));
    });
  });
}
