/// MO-015 — Hằng số cấu hình thông báo local V1 (khớp spec DS-014 §6–§7).
///
/// - Quiet-hours: 22:00–06:00 (cùng chỗ ParkingSettings local).
/// - Channels Android: `parking_reminders` (E1/E4, default) +
///   `parking_urgent` (E2, high — time-critical).
/// - Payload local chung V1 (để P2 thay scheduler bằng FCM mà không đổi UI):
///   `{event: E1|E2|E4, entity_code, deep_link, scheduled_at}`.
///   Encode gọn `k=v;` để parse không cần json.
library;

import 'package:flutter/material.dart';

/// Giờ im lặng — spec §6: 22:00–06:00.
class QuietHours {
  QuietHours._();

  static const int startHour = 22;
  static const int endHour = 6;

  /// Giờ quét bù E1 sau quiet-hours (spec §6: 06:05).
  static const int morningSweepHour = 6;
  static const int morningSweepMinute = 5;

  /// true khi [time] rơi vào khung 22:00–06:00 (so theo giờ địa phương).
  static bool isQuiet(TimeOfDay time) {
    final m = time.hour * 60 + time.minute;
    const start = startHour * 60;
    const end = endHour * 60;
    if (start <= end) return m >= start && m < end;
    return m >= start || m < end;
  }

  static bool isQuietDateTime(DateTime t) =>
      isQuiet(TimeOfDay(hour: t.hour, minute: t.minute));
}

/// Kênh + task names + prefs keys — 1 chỗ duy nhất.
class NotifConfig {
  NotifConfig._();

  static const String channelRemindersId = 'parking_reminders';
  static const String channelRemindersName = 'Nhắc việc bãi xe';
  static const String channelRemindersDesc =
      'Nhắc vé sắp hết, ca chưa chốt (E1, E4).';

  static const String channelUrgentId = 'parking_urgent';
  static const String channelUrgentName = 'Giữ chỗ sắp tới giờ';
  static const String channelUrgentDesc =
      'Nhắc giữ chỗ trước 20 phút (E2, time-critical).';

  /// Workmanager: quét E1 (+ bù E4) mỗi ngày sau quiet-hours.
  static const String wmDailyTask = 'parking.daily_sweep';
  static const String wmDailyUnique = 'parking-daily-sweep';

  /// Workmanager fallback inexact cho E2/E4 khi user từ chối exact alarm.
  static const String wmFallbackTask = 'parking.fallback_fire';

  // -- SharedPreferences keys -------------------------------------------
  static const String _p = 'notif.';

  /// Đã gửi theo key dedupe `sent.<dedupeKey>` = '1'.
  static String sentKey(String dedupeKey) => '${_p}sent.$dedupeKey';

  /// Số lần đã hiện rationale (tối đa 2 — spec §5.1).
  static const String rationaleCount = '${_p}rationale.count';

  /// Lần hiện rationale cuối (ms epoch) — chỉ đọc khi cần giãn cách.
  static const String rationaleLastAt = '${_p}rationale.last_at';

  /// Lần user đóng fallback banner (ms epoch) — nhớ 7 ngày (spec §5.2).
  static const String fallbackDismissedAt = '${_p}fallback.dismissed_at';

  /// Toast E3 "vừa đầy" mỗi zone: `fulltoast.<zoneCode>` = ms epoch.
  static String fullToastKey(String zoneCode) => '${_p}fulltoast.$zoneCode';

  // -- Deep-link spec (§1.3–§4.3) ----------------------------------------
  static const String linkPasses = '/passes';
  static const String linkReservations = '/reservations';
  static const String linkMap = '/map';
  static const String linkAttendance = '/staff/attendance';
}

/// Sự kiện V1 — E1 vé, E2 giữ chỗ, E4 ca (E3 in-app only, không push).
enum NotifEvent { e1, e2, e4 }

extension NotifEventX on NotifEvent {
  String get code => switch (this) {
        NotifEvent.e1 => 'E1',
        NotifEvent.e2 => 'E2',
        NotifEvent.e4 => 'E4',
      };

  static NotifEvent? fromCode(String? c) => switch (c) {
        'E1' => NotifEvent.e1,
        'E2' => NotifEvent.e2,
        'E4' => NotifEvent.e4,
        _ => null,
      };
}
