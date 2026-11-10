import '../repos/auth_repo.dart';

/// Copy lỗi đăng nhập/đăng ký hiển thị trên UI (MO-006).
///
/// - Giữ gộp WRONG_PASSWORD (không lộ user có/không có — chính sách bảo mật).
/// - NOT_FOUND nói rõ "trên thiết bị này" + hướng tạo tài khoản, vì mobile
///   và desktop dùng 2 DB local độc lập: tài khoản tạo trên desktop chưa
///   chắc đã có trên mobile (chờ PB-merge mới đồng bộ thật).
String friendlyAuthMessage(AuthException e) {
  switch (e.code) {
    case 'PHONE_TAKEN':
      return 'SĐT đã được đăng ký. Hãy đăng nhập.';
    case 'INVALID_PHONE':
      return 'Số điện thoại phải 10 số, bắt đầu bằng 0.';
    case 'WRONG_PASSWORD':
      return 'Sai mật khẩu. Thử lại.';
    case 'NOT_FOUND':
      return 'Tài khoản không tồn tại trên thiết bị này. '
          'Khách đăng ký bằng SĐT, nhân viên liên hệ quản trị viên.';
    case 'LOCKED':
      return 'Tài khoản đã bị khóa — liên hệ quản trị viên.';
    default:
      return e.message;
  }
}
