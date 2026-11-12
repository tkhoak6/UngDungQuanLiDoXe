/// MO-015 — Copy tiếng Việt cho 4 sự kiện (spec DS-014 §1–§4).
///
/// Pure functions — không phụ thuộc Flutter/plugin nên unit-test trực tiếp.
/// Tiền format `vi-VN ₫` dạng đơn giản `1.234.567 ₫` (không cần intl).
library;

import 'notification_config.dart';

/// Format tiền `vi-VN ₫` — chấm phân tách nghìn.
String vndCompact(int amount) {
  final neg = amount < 0;
  var s = amount.abs().toString();
  final buf = StringBuffer();
  var count = 0;
  for (var i = s.length - 1; i >= 0; i--) {
    buf.write(s[i]);
    count++;
    if (count == 3 && i != 0) {
      buf.write('.');
      count = 0;
    }
  }
  s = buf.toString().split('').reversed.join('');
  return '${neg ? '-' : ''}$s ₫';
}

/// dd/mm/yyyy từ 'yyyy-MM-dd'.
String ddMmYyyy(String ymd) {
  final p = ymd.split('-');
  if (p.length != 3) return ymd;
  return '${p[2]}/${p[1]}/${p[0]}';
}

class NotifCopy {
  const NotifCopy({required this.title, required this.body});

  final String title;
  final String body;
}

/// E1 — vé tháng sắp hết (spec §1.2). [daysLeft] chỉ nhận 3 hoặc 0.
NotifCopy e1Copy({
  required String passCode,
  required String plate,
  required String endDateYmd,
  required int price,
  required int daysLeft,
}) {
  final money = vndCompact(price);
  if (daysLeft == 0) {
    return NotifCopy(
      title: 'Vé tháng hết hạn hôm nay',
      body: 'Vé $passCode xe $plate hết hạn hôm nay. '
          'Gia hạn trước 22:00 để giữ chỗ ưu đãi.',
    );
  }
  return NotifCopy(
    title: 'Vé tháng sắp hết hạn',
    body: 'Vé $passCode xe $plate hết hạn sau 3 ngày '
        '(${ddMmYyyy(endDateYmd)}). Mang $money ra quầy để gia hạn.',
  );
}

/// E2 — giữ chỗ sắp tới giờ (spec §2.2). Trả về title/body + 2 action label.
class E2Copy {
  const E2Copy({
    required this.title,
    required this.body,
    required this.actionView,
    required this.actionCancel,
  });

  final String title;
  final String body;
  final String actionView;
  final String actionCancel;
}

E2Copy e2Copy({
  required String code,
  required String zoneCode,
  required String startHm,
}) {
  return E2Copy(
    title: 'Sắp tới giờ giữ chỗ',
    body: 'Mã $code tại khu $zoneCode từ $startHm. '
        'Tới trước $startHm nếu không chỗ sẽ tự hủy.',
    actionView: 'Xem mã',
    actionCancel: 'Hủy giữ chỗ',
  );
}

/// E3 — bãi đầy (spec §3.2): in-app banner + toast staff 1 lần.
String e3BannerText({
  required int occupied,
  required int total,
  String? suggestZone,
  int? suggestFree,
}) {
  final base = 'Bãi đã đầy ($occupied/$total) — '
      'vui lòng quay lại sau';
  if (suggestZone != null && suggestFree != null && suggestFree > 0) {
    return '$base hoặc chọn khu $suggestZone còn $suggestFree chỗ.';
  }
  return '$base.';
}

const String e3FindButton = 'Tìm khu còn chỗ';

String e3StaffToast({required String zoneCode, String? suggestZone}) =>
    suggestZone == null
        ? 'Khu $zoneCode vừa đầy.'
        : 'Khu $zoneCode vừa đầy — chuyển sang khu $suggestZone.';

/// E4 — ca chưa chốt (spec §4.2).
NotifCopy e4Copy({
  required String shiftName,
  required String rangeHm,
}) {
  return NotifCopy(
    title: 'Bạn chưa chốt ca $shiftName',
    body: 'Ca $shiftName $rangeHm đã hết 30 phút mà chưa chốt. '
        'Vào Chấm công để chốt bù (tiền cuối ca + ghi chú).',
  );
}

const String e4ActionClose = 'Chốt ca ngay';

/// Rationale xin quyền — spec §5.1 (bottom sheet, tiếng Việt).
class PermissionRationaleCopy {
  const PermissionRationaleCopy._();

  static const String title = 'Bật thông báo để không lỡ việc?';
  static const List<String> bullets = [
    'Vé tháng sắp hết (trước 3 ngày + ngày hết)',
    'Giữ chỗ sắp tới giờ (nhắc trước 20 phút)',
    'Ca chưa chốt sau hết ca 30 phút',
  ];
  static const String note =
      'Chỉ 4 việc quan trọng, không quảng cáo. Tắt bất kỳ lúc nào trong Cài đặt.';
  static const String allow = 'Bật thông báo';
  static const String later = 'Để sau';
  static const String grantedOk = 'Đã bật thông báo.';
}

/// Hướng dẫn mở Cài đặt khi denied — spec §5.2 (Android V1).
class PermissionDeniedCopy {
  const PermissionDeniedCopy._();

  static const String title = 'Thông báo đang tắt';
  static const String androidSteps =
      'Cài đặt → Ứng dụng → Bãi Xe Thông Minh → Thông báo → Bật';
  static const String openSettings = 'Mở cài đặt';
  static const String close = 'Đóng';

  static String fallbackPass({
    required String passCode,
    required String endDateYmd,
  }) =>
      'Vé $passCode hết hạn $endDateYmd — thông báo đang tắt.';

  static const String fallbackReservation =
      'Thông báo tắt — hãy tự canh giờ tới trước 20 phút.';

  static const String fallbackAttendance = 'Thông báo tắt — nhớ chốt ca.';
}

/// Payload V1 chung — `{event, entity_code, deep_link, scheduled_at}`.
/// Encode `k=v;` để native + background isolate parse không cần json.
class NotifPayload {
  const NotifPayload({
    required this.event,
    required this.entityCode,
    required this.deepLink,
    required this.scheduledAt,
  });

  final NotifEvent event;
  final String entityCode;
  final String deepLink;
  final DateTime scheduledAt;

  String encode() =>
      'event=${event.code};code=$entityCode;link=$deepLink;'
      'at=${scheduledAt.toIso8601String()}';

  static NotifPayload? decode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    final map = <String, String>{};
    for (final part in raw.split(';')) {
      final i = part.indexOf('=');
      if (i <= 0) continue;
      map[part.substring(0, i)] = part.substring(i + 1);
    }
    final event = NotifEventX.fromCode(map['event']);
    final link = map['link'];
    if (event == null || link == null) return null;
    DateTime at;
    try {
      at = DateTime.parse(map['at'] ?? '');
    } catch (_) {
      at = DateTime.now();
    }
    return NotifPayload(
      event: event,
      entityCode: map['code'] ?? '',
      deepLink: link,
      scheduledAt: at,
    );
  }

  /// Link deep-link spec → route canonical theo role (cho GoRouter).
  static String resolveLink(String link, {required String role}) {
    final uri = Uri.parse(link);
    if (uri.path == NotifConfig.linkPasses) {
      final q = uri.queryParameters['highlight'];
      final suffix = q == null ? '' : '?highlight=$q';
      return role == 'staff' ? '/s/attendance$suffix' : '/c/passes$suffix';
    }
    if (uri.path == NotifConfig.linkReservations) {
      final code = uri.queryParameters['code'];
      final suffix = code == null ? '' : '?code=$code';
      return '/c/reservations$suffix';
    }
    if (uri.path == NotifConfig.linkAttendance) return '/s/attendance';
    if (uri.path == NotifConfig.linkMap) {
      return role == 'staff' ? '/s/checkin' : '/c/map';
    }
    return role == 'staff' ? '/s/checkin' : '/c/map';
  }
}
