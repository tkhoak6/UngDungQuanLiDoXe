/// Validation + copy lỗi — copy từ customer-area P1.3/P3.3/P4.4.
class Validators {
  Validators._();

  static final RegExp _phone = RegExp(r'^0\d{9}$');
  static final RegExp _plateChars = RegExp(r'^[A-Z0-9][A-Z0-9.\-]{3,11}$');

  static String normalizePlate(String raw) =>
      raw.trim().toUpperCase().replaceAll(RegExp(r'\s+'), '');

  static String? phone(String? v) {
    final t = (v ?? '').trim();
    if (t.isEmpty) return 'Vui lòng nhập số điện thoại.';
    if (!_phone.hasMatch(t)) return 'Số điện thoại phải 10 số, bắt đầu bằng 0.';
    return null;
  }

  static String? password(String? v) {
    if ((v ?? '').isEmpty) return 'Vui lòng nhập mật khẩu.';
    if (v!.length < 6) return 'Mật khẩu phải ≥6 ký tự.';
    return null;
  }

  static String? fullName(String? v) {
    final t = (v ?? '').trim();
    if (t.isEmpty) return 'Vui lòng nhập họ và tên.';
    if (t.length < 2) return 'Họ tên phải ≥2 ký tự.';
    if (t.length > 50) return 'Họ tên tối đa 50 ký tự.';
    return null;
  }

  static String? plate(String? v) {
    final t = normalizePlate(v ?? '');
    if (t.isEmpty) return 'Vui lòng nhập biển số.';
    if (!_plateChars.hasMatch(t)) {
      return 'Biển số chưa đúng — VD: 51H-12345.';
    }
    return null;
  }

  static String? newPassword(String? v, String current) {
    final base = password(v);
    if (base != null) return base;
    if (v == current) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
    return null;
  }

  static String? confirmPassword(String? v, String fresh) {
    if ((v ?? '').isEmpty) return 'Vui lòng xác nhận mật khẩu.';
    if (v != fresh) return 'Mật khẩu xác nhận chưa khớp.';
    return null;
  }

  /// Slot đặt chỗ 24/24 + qua đêm (BE-019): không khung giờ, end <= start
  /// = sang hôm sau (+24h), mỗi lượt 15 phút–4 giờ, hết hạn = giờ kết
  /// thúc + 20p. `date` = ngày bắt đầu (= today, backend ép).
  static String? slot({
    required DateTime date,
    required DateTime now,
    required int fromMin,
    required int toMin,
  }) {
    if (!_sameDay(date, now)) return 'V1 chỉ giữ chỗ trong ngày.';
    if (toMin == fromMin) return 'Giờ kết thúc phải sau giờ bắt đầu.';
    final dur = toMin > fromMin
        ? toMin - fromMin
        : toMin - fromMin + 24 * 60;
    if (dur < 15 || dur > 4 * 60) {
      return 'Mỗi lượt giữ chỗ từ 15 phút đến 4 giờ.';
    }
    final nowMin = now.hour * 60 + now.minute;
    if (fromMin < nowMin - 15) {
      return 'Giờ bắt đầu đã qua — vui lòng chọn khung giờ khác.';
    }
    return null;
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}
