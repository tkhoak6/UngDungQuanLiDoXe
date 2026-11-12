import 'dart:async';

/// ANPR on-device helpers (MO-014, spec `./specs/qr-anpr.md` §2.3).
///
/// Pure Dart — không chạm camera/ML Kit để unit-test được. Luồng thật:
/// OCR text → [extractCandidates] → user confirm/sửa → điền form.
/// V1 KHÔNG tự sửa lỗi OCR (giữ nguyên để user sửa tay), chỉ gợi ý fuzzy
/// 1-tap ("Ý bạn là {gợi ý}?"). P2 mới tự sửa.
///
/// MO-017: thêm phân loại thất bại ([AnprFailureKind]/[classify]/[hintFor]),
/// ghép biển 2 dòng ([extractCandidates] ghép cặp dòng kề — biển xe máy
/// "65-AB / 829.65" OCR hay tách 2 dòng), và toán khung crop ([AnprCrop]).
class Anpr {
  Anpr._();

  /// Biển VN sau chuẩn hóa: 2 số đầu + 1-2 chữ + 4-6 số, tổng 7-10 ký tự.
  /// VD: 51H12345, 51H123456, 29AB12345 (biển dài mới 2 chữ).
  static final RegExp vnPlate = RegExp(r'^(\d{2}[A-Z]{1,2})(\d{4,6})$');

  /// Chuẩn hóa (spec §2.3): UPPERCASE → bỏ mọi ký tự ngoài [A-Z0-9].
  /// `51H 123.45` → `51H12345`.
  static String normalize(String raw) =>
      raw.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');

  /// Trả biển chuẩn hóa nếu đúng pattern VN, ngược lại null.
  static String? parse(String raw) {
    final norm = normalize(raw);
    if (norm.length < 7 || norm.length > 10) return null;
    return vnPlate.hasMatch(norm) ? norm : null;
  }

  /// Hiển thị cho user: chèn "-" sau cụm chữ (DB vẫn UPPERCASE như cũ).
  /// `51H12345` → `51H-12345`, `29AB12345` → `29AB-12345`.
  /// Không match pattern → trả nguyên (để user sửa tay).
  static String display(String norm) {
    final m = vnPlate.firstMatch(norm);
    if (m == null) return norm;
    return '${m.group(1)}-${m.group(2)}';
  }

  /// Trích ứng viên từ OCR text: match theo dòng → token → cặp token kề
  /// nhau (OCR hay tách `51H 12345` thành 2 token). Giữ thứ tự, khử trùng.
  static List<String> extractCandidates(String ocrText) {
    final found = <String>[];
    void add(String norm) {
      if (!found.contains(norm)) found.add(norm);
    }

    for (final line in ocrText.split(RegExp(r'[\r\n]+'))) {
      final whole = parse(line);
      if (whole != null) add(whole);
      final tokens = line
          .split(RegExp(r'[^A-Za-z0-9]+'))
          .where((t) => t.isNotEmpty)
          .toList();
      for (final t in tokens) {
        final p = parse(t);
        if (p != null) add(p);
      }
      // OCR hay tách "51h-123.45" thành 3-4 token — thử ghép các cụm
      // token liên tiếp (tối đa 4) rồi mới bỏ.
      for (var w = 2; w <= 4 && w <= tokens.length; w++) {
        for (var i = 0; i + w <= tokens.length; i++) {
          final p = parse(tokens.sublist(i, i + w).join());
          if (p != null) add(p);
        }
      }
    }
    // MO-017: biển xe máy 2 dòng ("65-AB" / "829.65") — OCR giữ 2 dòng
    // nên ghép trong-dòng không bao giờ trúng. Thử ghép chuẩn hóa của
    // từng cặp dòng kề (theo thứ tự, tối đa 2 dòng — đúng thực tế VN).
    // Dòng rác ghép vào sẽ quá dài/sai pattern nên tự rớt ở [parse].
    final lineNorms = ocrText
        .split(RegExp(r'[\r\n]+'))
        .map(normalize)
        .where((s) => s.isNotEmpty)
        .toList();
    for (var i = 0; i + 1 < lineNorms.length; i++) {
      final joined = parse(lineNorms[i] + lineNorms[i + 1]);
      if (joined != null) add(joined);
    }
    return found;
  }

  /// Gợi ý fuzzy 1 ký tự OCR hay nhầm: 0↔O/D, 1↔I/L, 8↔B, 5↔S, 2↔Z.
  /// Đã hợp lệ → null (không gợi ý). Không tự áp dụng — caller hiện
  /// "Ý bạn là {gợi ý}?" để user 1-tap xác nhận (spec §2.3).
  static String? suggest(String raw) {
    final norm = normalize(raw);
    if (norm.length < 7 || norm.length > 10) return null;
    if (vnPlate.hasMatch(norm)) return null;
    for (var i = 0; i < norm.length; i++) {
      for (final alt in _alts(norm[i])) {
        final cand = norm.replaceRange(i, i + 1, alt);
        if (vnPlate.hasMatch(cand)) return cand;
      }
    }
    return null;
  }

  /// MO-017: chữ đọc được nhưng chưa khớp biển số — lấy dòng có chữ
  /// đầu tiên làm điểm xuất phát cho user sửa (chuẩn hóa + cắt tối đa
  /// 10 ký tự = độ dài biển VN dài nhất). Rỗng → '' (field để trống).
  static String bestEffort(String ocrText) {
    for (final line in ocrText.split(RegExp(r'[\r\n]+'))) {
      final norm = normalize(line);
      if (norm.isEmpty) continue;
      return norm.length > 10 ? norm.substring(0, 10) : norm;
    }
    return '';
  }

  /// MO-017: đoạn OCR gọn để hiện trong màn confirm ("Máy đọc được …").
  /// Gộp khoảng trắng/dòng, cắt [max] ký tự + '…'. Rỗng → ''.
  static String ocrSnippet(String ocrText, [int max = 48]) {
    final flat =
        ocrText.split(RegExp(r'\s+')).where((t) => t.isNotEmpty).join(' ');
    if (flat.length <= max) return flat;
    return '${flat.substring(0, max)}…';
  }

  /// MO-017: phân loại 1 lần đọc — lỗi engine/timeout thắng (kể cả khi
  /// có text dở), rồi mới xét text rỗng / không khớp. Caller (sheet) chỉ
  /// cần 1 gọi này để chọn message + nút.
  static AnprFailureKind classify({Object? error, String text = ''}) {
    if (error != null) {
      if (error is TimeoutException) return AnprFailureKind.timeout;
      return AnprFailureKind.engine;
    }
    if (text.trim().isEmpty) return AnprFailureKind.empty;
    return AnprFailureKind.unmatched;
  }

  /// MO-017: copy Việt theo từng nguyên nhân (sheet hiện nguyên văn).
  /// [torchOn] để gợi ý bật flash đúng lúc (ảnh đêm thiếu sáng).
  static String hintFor(AnprFailureKind kind, {bool torchOn = false}) {
    switch (kind) {
      case AnprFailureKind.engine:
        return 'Không khởi tạo được nhận diện (lần đầu có thể chậm) — '
            'bấm Thử lại.';
      case AnprFailureKind.timeout:
        return 'Xử lý quá lâu — giữ máy chắc rồi bấm Thử lại.';
      case AnprFailureKind.empty:
        if (!torchOn) {
          return 'Chưa thấy chữ — thử bật đèn flash, đưa gần, giữ chắc.';
        }
        return 'Chưa thấy chữ — thử đưa gần hơn, giữ chắc, đủ sáng.';
      case AnprFailureKind.unmatched:
        return 'Đã thấy chữ nhưng chưa khớp biển số — sửa lại rồi '
            'Điền vào form.';
    }
  }

  static List<String> _alts(String ch) {
    switch (ch) {
      case '0':
        return ['O', 'D'];
      case 'O':
        return ['0', 'D'];
      case 'D':
        return ['0', 'O'];
      case '1':
        return ['I', 'L'];
      case 'I':
        return ['1', 'L'];
      case 'L':
        return ['1', 'I'];
      case '8':
        return ['B'];
      case 'B':
        return ['8'];
      case '5':
        return ['S'];
      case 'S':
        return ['5'];
      case '2':
        return ['Z'];
      case 'Z':
        return ['2'];
      default:
        return [];
    }
  }
}

/// MO-017: nguyên nhân đọc ANPR thất bại — mỗi loại 1 message + hành
/// động riêng (xem [Anpr.hintFor]), thay cho message chung "Chưa đọc
/// được" gây hiểu lầm trước đây.
enum AnprFailureKind {
  /// Recognizer ném lỗi (khởi tạo/model/native). Thử lại, không đổi ảnh.
  engine,

  /// Quá 8s (lần đầu khởi tạo model chậm, máy yếu). Giữ chắc + thử lại.
  timeout,

  /// OCR trả rỗng — khung hình không có chữ đọc được. Đủ sáng/gần/chắc.
  empty,

  /// OCR có chữ nhưng không khớp biển VN — hiện text + cho sửa/dùng.
  unmatched,
}

/// MO-017: toán khung crop vùng overlay — pure Dart để unit-test được.
///
/// V1 chỉ tính toán + kiểm chứng bằng test (P2 mới cắt byte ảnh thật vì
/// cần thêm dep `image` + đo trên thiết bị thật). Công thức: overlay canh
/// giữa viewfinder → tỉ lệ 0..1 → map sang pixel ảnh chụp, kẹp biên.
/// Ảnh gốc luôn giữ để fallback full-frame (không bao giờ crop mất).
class AnprCrop {
  AnprCrop._();

  /// Tỉ lệ [left, top, right, bottom] (0..1) của khung overlay canh giữa
  /// trong viewfinder [boxW]×[boxH]. Kích thước không hợp lệ → full-frame
  /// [0, 0, 1, 1] (fallback an toàn, không crash).
  static List<double> overlayFractions({
    required double boxW,
    required double boxH,
    required double overlayW,
    required double overlayH,
  }) {
    if (boxW <= 0 ||
        boxH <= 0 ||
        overlayW <= 0 ||
        overlayH <= 0 ||
        overlayW > boxW ||
        overlayH > boxH) {
      return const [0, 0, 1, 1];
    }
    final left = (boxW - overlayW) / 2 / boxW;
    final top = (boxH - overlayH) / 2 / boxH;
    return [left, top, 1 - left, 1 - top];
  }

  /// Map tỉ lệ [f] sang pixel ảnh [imgW]×[imgH], kẹp biên trong ảnh.
  /// Trả null khi ảnh/tỉ lệ không hợp lệ (caller fallback full-frame).
  static CropBox? toPixels(List<double> f, int imgW, int imgH) {
    if (f.length != 4 || imgW <= 0 || imgH <= 0) return null;
    var left = (f[0] * imgW).round();
    var top = (f[1] * imgH).round();
    var right = (f[2] * imgW).round();
    var bottom = (f[3] * imgH).round();
    left = left.clamp(0, imgW);
    top = top.clamp(0, imgH);
    right = right.clamp(0, imgW);
    bottom = bottom.clamp(0, imgH);
    if (left >= right || top >= bottom) return null;
    return CropBox(left: left, top: top, right: right, bottom: bottom);
  }
}

/// Hộp pixel bất biến sau [AnprCrop.toPixels].
class CropBox {
  const CropBox({
    required this.left,
    required this.top,
    required this.right,
    required this.bottom,
  });

  final int left;
  final int top;
  final int right;
  final int bottom;

  int get width => right - left;
  int get height => bottom - top;
}
