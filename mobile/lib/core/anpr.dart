/// ANPR on-device helpers (MO-014, spec `./specs/qr-anpr.md` §2.3).
///
/// Pure Dart — không chạm camera/ML Kit để unit-test được. Luồng thật:
/// OCR text → [extractCandidates] → user confirm/sửa → điền form.
/// V1 KHÔNG tự sửa lỗi OCR (giữ nguyên để user sửa tay), chỉ gợi ý fuzzy
/// 1-tap ("Ý bạn là {gợi ý}?"). P2 mới tự sửa.
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
