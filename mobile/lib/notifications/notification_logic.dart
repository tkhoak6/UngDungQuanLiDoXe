/// MO-015 — Logic lập lịch thuần (không plugin): tính toán E1/E2/E3/E4,
/// quiet-hours, dedupe, rationale, deep-link. Tất cả pure + unit-test được.
///
/// Quy ước thời gian: DB local lưu wall-clock VN dạng naive
/// ('yyyy-MM-dd', 'HH:mm', 'yyyy-MM-dd HH:mm:ss') → parse thành DateTime
/// local trực tiếp (app chạy trên máy VN, Asia/Ho_Chi_Minh).
library;

import 'notification_config.dart';
import 'notification_content.dart';

/// Ép DateTime naive 'yyyy-MM-dd HH:mm:ss' / 'yyyy-MM-dd' thành local.
DateTime? parseLocal(String? raw) {
  if (raw == null || raw.trim().isEmpty) return null;
  final s = raw.trim().replaceAll('T', ' ');
  try {
    if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) {
      final p = s.split('-').map(int.parse).toList();
      return DateTime(p[0], p[1], p[2]);
    }
    final d = s.split(' ');
    final ymd = d[0].split('-').map(int.parse).toList();
    final hms = (d.length > 1 ? d[1] : '00:00:00').split(':');
    final h = hms.isNotEmpty ? int.parse(hms[0]) : 0;
    final m = hms.length > 1 ? int.parse(hms[1]) : 0;
    final sec = hms.length > 2 ? int.parse(hms[2]) : 0;
    return DateTime(ymd[0], ymd[1], ymd[2], h, m, sec);
  } catch (_) {
    return null;
  }
}

/// Số ngày lịch từ hôm nay tới [endDate] (spec §1.2 `days_left`):
/// cùng ngày → 0 (ngày hết), sau 3 ngày → 3, quá hạn → âm.
int daysLeft({required DateTime endDate, required DateTime now}) {
  final e = DateTime(endDate.year, endDate.month, endDate.day);
  final n = DateTime(now.year, now.month, now.day);
  return e.difference(n).inDays;
}

/// Milestone E1 cho 1 vé: 'd3' | 'd0' | null (không bắn).
/// Không bắn khi status != active. Tối đa 2 push/vé/vòng đời — dedupe bằng
/// key `e1.<passId>.d3|d0` lưu prefs (caller kiểm tra qua [alreadySent]).
String? e1Milestone({
  required String status,
  required int daysLeftValue,
}) {
  if (status != 'active') return null;
  if (daysLeftValue == 3) return 'd3';
  if (daysLeftValue == 0) return 'd0';
  return null;
}

/// E2: giờ bắn = time_from − 20p (spec §2.1).
/// Tạo muộn (cách giờ bắt đầu <20p) → bắn sau khi giữ thành công 30s.
DateTime e2FireTime({
  required DateTime start,
  required DateTime createdNow,
}) {
  final early = start.subtract(const Duration(minutes: 20));
  if (early.isAfter(createdNow)) return early;
  return createdNow.add(const Duration(seconds: 30));
}

/// E4: giờ nhắc = shift.end + 30p (spec §4.1). Ca đêm end 06:00 → 06:30.
/// [workDate] neo ngày ca (work_date local); [endsNextDay] true khi ca qua
/// đêm (end thuộc hôm sau — VD ca NIGHT 22:00–06:00).
DateTime e4FireTime({
  required String endHm,
  required DateTime workDate,
  bool endsNextDay = false,
}) {
  final p = endHm.split(':');
  final eh = int.parse(p[0]);
  final em = int.parse(p[1]);
  var end = DateTime(workDate.year, workDate.month, workDate.day, eh, em);
  if (endsNextDay) {
    end = end.add(const Duration(days: 1));
  }
  return end.add(const Duration(minutes: 30));
}

/// Hành vi quiet-hours theo spec §6.
enum QuietBehavior {
  /// E1: hoãn tới 06:05 sáng hôm sau.
  deferToMorning,

  /// E2: vẫn hiện tray nhưng silent/low (không âm thanh/rung).
  silentBypass,

  /// E3: n/a (in-app only).
  notApplicable,

  /// E4 ca đêm end 06:00 → 06:30 ngoài quiet-hours → phát bình thường;
  /// ca ngày kéo qua 22:00 → hoãn 06:05 + banner trong app.
  normalOrDefer,
}

QuietBehavior quietBehavior(NotifEvent event, DateTime fireTime) {
  if (!QuietHours.isQuietDateTime(fireTime)) {
    return event == NotifEvent.e2
        ? QuietBehavior.silentBypass
        : QuietBehavior.normalOrDefer;
  }
  return switch (event) {
    NotifEvent.e1 => QuietBehavior.deferToMorning,
    NotifEvent.e2 => QuietBehavior.silentBypass,
    NotifEvent.e4 => QuietBehavior.normalOrDefer,
  };
}

/// Dời giờ bắn E1/E4 trong quiet-hours sang 06:05 sáng hôm sau (spec §6).
DateTime deferToMorning(DateTime fireTime) {
  final next = fireTime.add(const Duration(days: 1));
  return DateTime(next.year, next.month, next.day,
      QuietHours.morningSweepHour, QuietHours.morningSweepMinute);
}

/// E3 toast "vừa đầy" 1 lần/phiên/zone, cooldown ≥15p (spec §3.4).
/// [lastShownMsByZone] map zone → ms epoch lần hiện trước.
bool shouldShowFullToast({
  required String zoneCode,
  required DateTime now,
  required Map<String, int> lastShownMsByZone,
}) {
  final last = lastShownMsByZone[zoneCode];
  if (last == null) return true;
  final elapsed = now.millisecondsSinceEpoch - last;
  return elapsed >= const Duration(minutes: 15).inMilliseconds;
}

/// Rationale: hiện sau hành động liên quan đầu tiên, tối đa 2 lần,
/// lần 3 im luôn (spec §5.1). [shownCount] đọc từ prefs.
bool shouldShowRationale(int shownCount) => shownCount < 2;

/// Fallback banner khi permission denied: hiện khi [denied] và chưa đóng
/// trong 7 ngày ([dismissedAtMs] null = chưa từng đóng → hiện).
bool shouldShowFallbackBanner({
  required bool denied,
  required int? dismissedAtMs,
  required DateTime now,
}) {
  if (!denied) return false;
  if (dismissedAtMs == null) return true;
  final elapsed = now.millisecondsSinceEpoch - dismissedAtMs;
  return elapsed >= const Duration(days: 7).inMilliseconds;
}

/// Deep-link tap → route canonical (bọc NotifPayload.resolveLink cho test).
String resolveTapLink(String link, {required String role}) =>
    NotifPayload.resolveLink(link, role: role);

/// Id theo event + key: E1 10xxx, E2 20xxx, E4 30xxx.
int stableIdFor(NotifEvent event, String entityCode, [String extra = '']) {
  final base = switch (event) {
    NotifEvent.e1 => 10000,
    NotifEvent.e2 => 20000,
    NotifEvent.e4 => 30000,
  };
  final h = '$event:$entityCode:$extra'.hashCode & 0x7fffffff;
  return base + (h % 9000);
}

/// 'HH:mm' → phút từ 00:00 (parse lỗi → 0). Dùng so sánh start/end ca đêm.
int hmToMin(String hm) {
  final p = hm.split(':');
  if (p.length < 2) return 0;
  return (int.tryParse(p[0]) ?? 0) * 60 + (int.tryParse(p[1]) ?? 0);
}

/// Hôm nay dạng 'yyyy-MM-dd' (work_date local).
String ymdOf(DateTime t) =>
    '${t.year.toString().padLeft(4, '0')}-'
    '${t.month.toString().padLeft(2, '0')}-'
    '${t.day.toString().padLeft(2, '0')}';

/// Deadline chốt ca hiển thị trong banner E4 ('HH:mm' end + 30p).
String e4DeadlineHm(String endHm) {
  final p = endHm.split(':');
  final total = int.parse(p[0]) * 60 + int.parse(p[1]) + 30;
  final h = (total ~/ 60) % 24;
  final m = total % 60;
  return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
}
