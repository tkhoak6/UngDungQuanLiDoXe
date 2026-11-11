/// Helpers thuần đặt chỗ 24/24 + qua đêm (BE-019, nối FE-023).
/// `end <= start` = sang hôm sau (+24h). Không khung giờ, không clamp.
library;

/// true khi khung giờ tràn sang hôm sau.
bool isOvernight(int fromMin, int toMin) => toMin <= fromMin;

/// Số phút giữ chỗ — qua đêm tự +24h.
int reservationDurationMin(int fromMin, int toMin) =>
    toMin > fromMin ? toMin - fromMin : toMin - fromMin + 24 * 60;

/// 'HH:MM' — tự vòng 24h (qua đêm 25:30 → 01:30).
String hhmm(int totalMin) {
  final m = ((totalMin % 1440) + 1440) % 1440;
  return '${(m ~/ 60).toString().padLeft(2, '0')}:'
      '${(m % 60).toString().padLeft(2, '0')}';
}

/// '45 phút' / '2 giờ' / '2 giờ 30 phút'.
String fmtDur(int min) {
  if (min < 60) return '$min phút';
  final h = min ~/ 60;
  final r = min % 60;
  return r == 0 ? '$h giờ' : '$h giờ $r phút';
}

/// start/end DateTime từ ngày bắt đầu + phút; qua đêm end tự +1 ngày.
({DateTime start, DateTime end}) startEndOf(
    DateTime day, int fromMin, int toMin) {
  final start = DateTime(
      day.year, day.month, day.day, fromMin ~/ 60, fromMin % 60);
  var end =
      DateTime(day.year, day.month, day.day, toMin ~/ 60, toMin % 60);
  if (toMin <= fromMin) end = end.add(const Duration(days: 1));
  return (start: start, end: end);
}

String _two(int v) => v.toString().padLeft(2, '0');

/// 'YYYY-MM-DD HH:MM:SS' local — khớp `expires_at` trong DB.
String stampOf(DateTime n) =>
    '${n.year}-${_two(n.month)}-${_two(n.day)} '
    '${_two(n.hour)}:${_two(n.minute)}:${_two(n.second)}';

/// Phút còn lại tới `expires_at` (âm = đã hết); null khi parse lỗi.
int? minutesToExpiry(String expiresAt, DateTime now) {
  final t = DateTime.tryParse(expiresAt.replaceAll(' ', 'T'));
  if (t == null) return null;
  return t.difference(now).inMinutes;
}
