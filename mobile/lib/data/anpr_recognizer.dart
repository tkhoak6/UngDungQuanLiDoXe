import 'package:flutter/services.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

/// Wrapper mỏng quanh ML Kit Text Recognition (Latin, **on-device** —
/// không gửi ảnh lên mạng, spec §2.1). Tách interface để test mock được
/// mà không cần camera/model thật.
///
/// Vòng đời (spec §2.4): tạo khi mở sheet camera, `close()` ngay khi đóng.
/// V1 xử lý 1 frame/lần chụp (không stream realtime — tiết kiệm pin).
///
/// MO-017 (xác minh bằng source plugin 1.0.2):
/// - Kênh native chỉ có `vision#startTextRecognizer` / `vision#close…` —
///   KHÔNG có API pre-check trạng thái model, nên sheet đi nhánh "bắt
///   lỗi/timeout" thay vì kiểm tra trước.
/// - Android dùng `com.google.mlkit:text-recognition:16.0.1` (**bundled**,
///   model đi kèm APK — không tải qua Play Services, không cần mạng lần
///   đầu). Lỗi lần đầu thường là khởi tạo lạnh chậm → caller timeout 8s,
///   hoặc ảnh tối/nhòe → text rỗng. Xem `AnprFailureKind`.
abstract class AnprRecognizer {
  /// Nhận diện ảnh tại [imagePath] (file tạm), trả OCR raw text.
  /// Timeout 8s do caller đặt. File tạm do caller xóa trong `finally`.
  ///
  /// Ném [AnprEngineException] khi ML Kit lỗi (khởi tạo/model/native) —
  /// caller phân loại qua [AnprFailureKind.engine], KHÔNG gộp với "ảnh
  /// xấu".
  Future<String> recognize(String imagePath);

  Future<void> close();
}

/// Lỗi typed từ engine nhận diện (MO-017). Giữ [code]/[message] gốc của
/// native (`TextRecognizerError` + `e.toString()` bên Kotlin) để chẩn
/// đoán đúng nguyên nhân mà không cần đoán mò.
class AnprEngineException implements Exception {
  AnprEngineException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'AnprEngineException($code): $message';
}

/// Implement thật bằng Google ML Kit (Latin script, model bundle theo app).
/// Chỉ khởi tạo trên thiết bị thật (caller guard `kIsWeb` trước).
class MlKitAnprRecognizer implements AnprRecognizer {
  MlKitAnprRecognizer()
      : _rec = TextRecognizer(script: TextRecognitionScript.latin);

  final TextRecognizer _rec;

  @override
  Future<String> recognize(String imagePath) async {
    try {
      final input = InputImage.fromFilePath(imagePath);
      final out = await _rec.processImage(input);
      return out.text;
    } on AnprEngineException {
      rethrow;
    } on PlatformException catch (e) {
      // Native `result.error("TextRecognizerError", e.toString(), null)`.
      throw AnprEngineException(e.code, e.message ?? e.toString());
    } on Exception catch (e) {
      // VD: MissingPluginException khi gọi sai môi trường.
      throw AnprEngineException('recognize_failed', e.toString());
    }
  }

  @override
  Future<void> close() => _rec.close();
}
