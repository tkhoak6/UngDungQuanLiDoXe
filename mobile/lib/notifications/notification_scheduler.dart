/// MO-015 — Điều phối lập lịch V1: exact alarm (E2/E4) + workmanager
/// (daily sweep E1/E4 + fallback inexact khi thiếu quyền exact alarm).
///
/// Quyết định dep (ghi rõ theo contract): **`workmanager`** (KHÔNG
/// `background_fetch`) vì cần one-off delayed tasks cho fallback E2/E4
/// (background_fetch chỉ hỗ trợ periodic ≥15p, không one-off).
/// `timezone` là util thuần-Dart cho `zonedSchedule` (không phải scheduler).
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/timezone.dart' as tz;
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:workmanager/workmanager.dart';

import '../db/app_db.dart';
import '../models/entities.dart';
import '../repos/customer_repo.dart';
import '../repos/staff_repo.dart';
import 'notification_config.dart';
import 'notification_content.dart';
import 'notification_logic.dart';
import 'notification_service.dart';

/// Item quét E1 — tách khỏi entity để background isolate dùng chung core.
class PassSweepItem {
  const PassSweepItem({
    required this.passCode,
    required this.plate,
    required this.endDateYmd,
    required this.price,
    required this.status,
  });

  final String passCode;
  final String plate;
  final String endDateYmd;
  final int price;
  final String status;
}

/// Item quét E4.
class ShiftSweepItem {
  const ShiftSweepItem({
    required this.attendanceId,
    required this.shiftName,
    required this.endHm,
    required this.rangeHm,
    required this.checkOutAt,
    this.workDateYmd = '',
    this.endsNextDay = false,
  });

  final int attendanceId;
  final String shiftName;

  /// 'HH:mm' giờ kết thúc ca.
  final String endHm;

  /// 'HH:mm–HH:mm' hiển thị.
  final String rangeHm;
  final String? checkOutAt;

  /// work_date local 'yyyy-MM-dd' (rỗng = hôm nay).
  final String workDateYmd;

  /// true khi ca qua đêm (end thuộc hôm sau).
  final bool endsNextDay;
}

/// 1 thông báo chờ bắn (đã qua quiet-hours + dedupe).
class SweepAction {
  const SweepAction({
    required this.id,
    required this.event,
    required this.title,
    required this.body,
    required this.payload,
    required this.silent,
    required this.dedupeKey,
  });

  final int id;
  final NotifEvent event;
  final String title;
  final String body;
  final NotifPayload payload;
  final bool silent;
  final String dedupeKey;
}

/// Core thuần: lập danh sách E1 cần bắn (spec §1: D-3/D-0, ≤2 vé/vòng đời).
/// Không bắn trong quiet-hours (caller hoãn sang 06:05 — spec §6).
List<SweepAction> planPassSweep({
  required List<PassSweepItem> passes,
  required DateTime now,
  required Set<String> sentKeys,
}) {
  if (QuietHours.isQuietDateTime(now)) return <SweepAction>[];
  final out = <SweepAction>[];
  var summaryCount = 0;
  PassSweepItem? firstDue;
  String? firstMilestone;

  for (final p in passes) {
    final end = parseLocal(p.endDateYmd);
    if (end == null) continue;
    final dl = daysLeft(endDate: end, now: now);
    final ms = e1Milestone(status: p.status, daysLeftValue: dl);
    if (ms == null) continue;
    final key = 'e1.${p.passCode}.${p.endDateYmd}.$ms';
    if (sentKeys.contains(key)) continue;
    summaryCount++;
    firstDue ??= p;
    firstMilestone ??= ms;
    final copy = e1Copy(
      passCode: p.passCode,
      plate: p.plate,
      endDateYmd: p.endDateYmd,
      price: p.price,
      daysLeft: ms == 'd0' ? 0 : 3,
    );
    out.add(SweepAction(
      id: stableIdFor(NotifEvent.e1, p.passCode, ms),
      event: NotifEvent.e1,
      title: copy.title,
      body: copy.body,
      payload: NotifPayload(
        event: NotifEvent.e1,
        entityCode: p.passCode,
        deepLink:
            '${NotifConfig.linkPasses}?highlight=${Uri.encodeComponent(p.passCode)}',
        scheduledAt: now,
      ),
      silent: false,
      dedupeKey: key,
    ));
  }

  // Gộp summary khi ≥2 vé cùng mốc (spec §1.4) — thay các item lẻ.
  if (summaryCount >= 2 && firstDue != null && firstMilestone != null) {
    final ms = firstMilestone;
    final copy = e1Copy(
      passCode: firstDue.passCode,
      plate: firstDue.plate,
      endDateYmd: firstDue.endDateYmd,
      price: firstDue.price,
      daysLeft: ms == 'd0' ? 0 : 3,
    );
    final extra = summaryCount - 1;
    final summary = SweepAction(
      id: stableIdFor(NotifEvent.e1, 'summary', ms),
      event: NotifEvent.e1,
      title: copy.title,
      body:
          '${copy.body} (+$extra vé khác cũng sắp hết — xem chi tiết).',
      payload: NotifPayload(
        event: NotifEvent.e1,
        entityCode: firstDue.passCode,
        deepLink: NotifConfig.linkPasses,
        scheduledAt: now,
      ),
      silent: false,
      dedupeKey: 'e1.summary.${ymdOf(now)}.$ms',
    );
    return <SweepAction>[summary];
  }
  return out;
}

/// Core thuần: E4 — ca chưa chốt khi hết ca 30p (spec §4, tối đa 1 push +
/// banner in-app; ca đêm end 06:00 → 06:30 ngoài quiet-hours nên phát
/// bình thường; ca ngày kéo qua 22:00 → hoãn 06:05).
List<SweepAction> planShiftSweep({
  required List<ShiftSweepItem> shifts,
  required DateTime now,
  required Set<String> sentKeys,
}) {
  final out = <SweepAction>[];
  for (final s in shifts) {
    if (s.checkOutAt != null) continue;
    final wd = parseLocal(s.workDateYmd) ??
        DateTime(now.year, now.month, now.day);
    final fire = e4FireTime(
      endHm: s.endHm,
      workDate: wd,
      endsNextDay: s.endsNextDay,
    );
    if (now.isBefore(fire)) continue;
    final key = 'e4.${s.attendanceId}';
    if (sentKeys.contains(key)) continue;
    if (QuietHours.isQuietDateTime(now)) continue; // hoãn 06:05 + banner.
    final copy = e4Copy(shiftName: s.shiftName, rangeHm: s.rangeHm);
    out.add(SweepAction(
      id: stableIdFor(NotifEvent.e4, '${s.attendanceId}'),
      event: NotifEvent.e4,
      title: copy.title,
      body: copy.body,
      payload: NotifPayload(
        event: NotifEvent.e4,
        entityCode: '${s.attendanceId}',
        deepLink: NotifConfig.linkAttendance,
        scheduledAt: now,
      ),
      silent: false,
      dedupeKey: key,
    ));
  }
  return out;
}

/// Entry-point workmanager (top-level, bắt buộc).
@pragma('vm:entry-point')
void notifCallbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    WidgetsFlutterBinding.ensureInitialized();
    tzdata.initializeTimeZones();
    try {
      tz.setLocalLocation(tz.getLocation('Asia/Ho_Chi_Minh'));
    } catch (_) {
      // Giữ tz.local mặc định nếu DB múi giờ thiếu.
    }
    if (task == NotifConfig.wmDailyTask) {
      await NotificationScheduler.runBackgroundDaily();
    } else if (task == NotifConfig.wmFallbackTask) {
      await NotificationScheduler.runFallbackFire(inputData);
    }
    return Future.value(true);
  });
}

class NotificationScheduler {
  NotificationScheduler._();

  static bool _tzReady = false;

  static void _ensureTz() {
    if (_tzReady) return;
    tzdata.initializeTimeZones();
    try {
      tz.setLocalLocation(tz.getLocation('Asia/Ho_Chi_Minh'));
    } catch (_) {
      // Giữ mặc định.
    }
    _tzReady = true;
  }

  /// Gọi 1 lần ở main(): tz + workmanager init + đăng ký daily sweep.
  static Future<void> init() async {
    _ensureTz();
    await Workmanager().initialize(notifCallbackDispatcher);
    await ensureDaily();
  }

  /// Daily sweep 06:35 sau quiet-hours (spec §1.1/§7.1).
  static Future<void> ensureDaily() async {
    final now = DateTime.now();
    var next = DateTime(now.year, now.month, now.day, 6, 35);
    if (!next.isAfter(now)) {
      next = next.add(const Duration(days: 1));
    }
    await Workmanager().registerPeriodicTask(
      NotifConfig.wmDailyUnique,
      NotifConfig.wmDailyTask,
      frequency: const Duration(hours: 24),
      initialDelay: next.difference(now),
    );
  }

  // -- E2: giữ chỗ trước 20p (exact alarm + silent khi quiet) -------------

  /// Gọi sau khi giữ chỗ thành công (spec §2.1). [createdNow] để tính
  /// trường hợp tạo muộn (<20p → bắn sau 30s).
  static Future<void> scheduleReservation({
    required ReservationRow row,
    required DateTime createdNow,
  }) async {
    _ensureTz();
    final start = _reservationStart(row, createdNow);
    final fire = e2FireTime(start: start, createdNow: createdNow);
    final quiet = QuietHours.isQuietDateTime(fire);
    final copy = e2Copy(
      code: row.code,
      zoneCode: row.zoneCode,
      startHm: row.startTime,
    );
    final payload = NotifPayload(
      event: NotifEvent.e2,
      entityCode: row.code,
      deepLink:
          '${NotifConfig.linkReservations}?code=${Uri.encodeComponent(row.code)}',
      scheduledAt: fire,
    );
    final id = stableIdFor(NotifEvent.e2, row.code);
    final svc = NotificationService.instance;
    try {
      await svc.scheduleExact(
        id: id,
        event: NotifEvent.e2,
        title: copy.title,
        body: copy.body,
        when: fire,
        payload: payload,
        silent: quiet, // spec §5.9: bypass quiet nhưng silent/low.
        actions: const [
          AndroidNotificationAction(
            'view',
            'Xem mã',
            showsUserInterface: true,
          ),
          AndroidNotificationAction(
            'cancel_hold',
            'Hủy giữ chỗ',
            showsUserInterface: true,
          ),
        ],
      );
    } on ExactAlarmDenied {
      // Fallback inexact +15p khi user từ chối exact alarm (spec §7).
      final delay = fire.difference(DateTime.now());
      await Workmanager().registerOneOffTask(
        'e2.${row.code}',
        NotifConfig.wmFallbackTask,
        initialDelay:
            delay.isNegative ? Duration.zero : delay,
        inputData: <String, dynamic>{
          'event': 'E2',
          'id': id,
          'title': copy.title,
          'body': copy.body,
          'payload': payload.encode(),
          'silent': quiet,
        },
      );
    }
  }

  static Future<void> cancelReservation(String code) async {
    await NotificationService.instance
        .cancel(stableIdFor(NotifEvent.e2, code));
    try {
      await Workmanager().cancelByUniqueName('e2.$code');
    } catch (_) {
      // Workmanager chưa init (test) — bỏ qua.
    }
  }

  /// 'HH:mm:ss' → 'HH:mm'.
  static String _trimHm(String v) =>
      v.length >= 5 ? v.substring(0, 5) : v;

  static DateTime _reservationStart(ReservationRow row, DateTime fallback) {    final d = parseLocal(row.date);
    final t = row.startTime.split(':');
    if (d == null || t.length != 2) return fallback;
    final h = int.tryParse(t[0]) ?? fallback.hour;
    final m = int.tryParse(t[1]) ?? fallback.minute;
    return DateTime(d.year, d.month, d.day, h, m);
  }

  // -- E4: ca chưa chốt end+30p -------------------------------------------

  /// Gọi sau khi Vào ca (spec §4 + §7.1). [endHm]/[rangeHm]/[shiftName]
  /// lấy từ `shifts` qua [staffRepo]; [checkInAt] neo ngày ca đêm.
  static Future<void> scheduleShiftReminder({
    required StaffRepo staffRepo,
    required int userId,
    required DateTime checkInAt,
  }) async {
    _ensureTz();
    final shifts = await staffRepo.shifts();
    final cur = StaffRepo.currentShift(checkInAt);
    ShiftRow? match;
    for (final s in shifts) {
      if (s.code == cur['code']) match = s;
    }
    if (match == null) return;
    final endHm = match.endTime.length >= 5
        ? match.endTime.substring(0, 5)
        : match.endTime;
    final startHm = match.startTime.length >= 5
        ? match.startTime.substring(0, 5)
        : match.startTime;
    final endsNextDay = hmToMin(endHm) <= hmToMin(startHm);
    final workDate = parseLocal(cur['work_date']) ??
        DateTime(checkInAt.year, checkInAt.month, checkInAt.day);
    var fire = e4FireTime(
      endHm: endHm,
      workDate: workDate,
      endsNextDay: endsNextDay,
    );
    if (QuietHours.isQuietDateTime(fire)) {
      fire = deferToMorning(fire); // ca ngày kéo qua 22:00 → 06:05.
    }
    final today = await staffRepo.today(userId);
    if (today == null || today.checkOutAt != null) return;
    final copy = e4Copy(
      shiftName: match.name,
      rangeHm: '$startHm–$endHm',
    );
    final payload = NotifPayload(
      event: NotifEvent.e4,
      entityCode: '${today.id}',
      deepLink: NotifConfig.linkAttendance,
      scheduledAt: fire,
    );
    final id = stableIdFor(NotifEvent.e4, '${today.id}');
    try {
      await NotificationService.instance.scheduleExact(
        id: id,
        event: NotifEvent.e4,
        title: copy.title,
        body: copy.body,
        when: fire,
        payload: payload,
      );
    } on ExactAlarmDenied {
      final delay = fire.difference(DateTime.now());
      await Workmanager().registerOneOffTask(
        'e4.${today.id}',
        NotifConfig.wmFallbackTask,
        initialDelay:
            delay.isNegative ? Duration.zero : delay,
        inputData: <String, dynamic>{
          'event': 'E4',
          'id': id,
          'title': copy.title,
          'body': copy.body,
          'payload': payload.encode(),
          'silent': false,
        },
      );
    }
  }

  static Future<void> cancelShiftReminder(int attendanceId) async {
    await NotificationService.instance
        .cancel(stableIdFor(NotifEvent.e4, '$attendanceId'));
    try {
      await Workmanager().cancelByUniqueName('e4.$attendanceId');
    } catch (_) {
      // Chưa init — bỏ qua.
    }
  }

  // -- Foreground catch-up lúc mở app (spec §7.1: "check bù lúc mở app") ---

  /// Quét bù E1 (+E4 ca hôm nay) khi app mở — tôn quiet-hours (đang quiet
  /// chỉ badge, không push). Gọi sau login + sau khi grant quyền (ping test).
  static Future<int> runLaunchSweep({
    required CustomerRepo customerRepo,
    required StaffRepo staffRepo,
    required int userId,
    required String ownerPhone,
    DateTime? nowOverride,
  }) async {
    final now = nowOverride ?? DateTime.now();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('notif.owner_phone', ownerPhone);
    await prefs.setInt('notif.owner_userid', userId);
    var shown = 0;

    final passes = await customerRepo.myPasses(ownerPhone);
    final passItems = <PassSweepItem>[
      for (final p in passes)
        PassSweepItem(
          passCode: p.passCode,
          plate: p.licensePlate,
          endDateYmd: p.endDate,
          price: p.price,
          status: p.status,
        ),
    ];
    final sent = _sentKeys(prefs);
    for (final a in planPassSweep(
        passes: passItems, now: now, sentKeys: sent)) {
      await NotificationService.instance.showNow(
        id: a.id,
        event: a.event,
        title: a.title,
        body: a.body,
        payload: a.payload,
        silent: a.silent,
      );
      await prefs.setBool(NotifConfig.sentKey(a.dedupeKey), true);
      shown++;
    }

    final today = await staffRepo.today(userId);
    if (today != null && today.checkOutAt == null) {
      final shifts = await staffRepo.shifts();
      final items = <ShiftSweepItem>[
        for (final s in shifts)
          ShiftSweepItem(
            attendanceId: today.id,
            shiftName: today.shiftName,
            endHm: _trimHm(s.endTime),
            rangeHm: '${s.startTime}–${s.endTime}',
            checkOutAt: today.checkOutAt,
            workDateYmd: today.workDate,
            endsNextDay:
                hmToMin(_trimHm(s.endTime)) <=
                    hmToMin(_trimHm(s.startTime)),
          ),
      ];
      // Chỉ item đúng ca hiện tại mới qua được planShiftSweep theo giờ;
      // rút gọn: giữ item có endHm khớp giờ fire đã qua (dedupe theo id).
      for (final a in planShiftSweep(
          shifts: items, now: now, sentKeys: _sentKeys(prefs))) {
        await NotificationService.instance.showNow(
          id: a.id,
          event: a.event,
          title: a.title,
          body: a.body,
          payload: a.payload,
          silent: a.silent,
        );
        await prefs.setBool(NotifConfig.sentKey(a.dedupeKey), true);
        shown++;
      }
    }
    return shown;
  }

  static Set<String> _sentKeys(SharedPreferences prefs) {
    final out = <String>{};
    for (final k in prefs.getKeys()) {
      const prefix = 'notif.sent.';
      if (k.startsWith(prefix) && prefs.getBool(k) == true) {
        out.add(k.substring(prefix.length));
      }
    }
    return out;
  }

  // -- Background tasks (workmanager isolate) -----------------------------

  /// Daily sweep khi app kill: quét TẤT CẢ vé active của owner đã lưu +
  /// ca chưa chốt của owner. Không có owner → thoát (đợi foreground).
  static Future<void> runBackgroundDaily() async {
    final prefs = await SharedPreferences.getInstance();
    final phone = prefs.getString('notif.owner_phone');
    final userId = prefs.getInt('notif.owner_userid');
    final now = DateTime.now();
    if (QuietHours.isQuietDateTime(now)) return; // tôn quiet-hours.
    final svc = NotificationService.instance;
    await svc.init();
    final sent = _sentKeys(prefs);

    if (phone != null && phone.isNotEmpty) {
      final db = await AppDb.instance.db;
      final rows = await db.rawQuery('''
SELECT mp.pass_code AS code, v.license_plate AS plate,
       mp.end_date AS end_date, mp.price AS price, mp.status AS status
FROM monthly_passes mp
LEFT JOIN vehicles v ON v.id = mp.vehicle_id
WHERE mp.customer_phone = ? AND mp.status = 'active'
''', [phone]);
      final items = <PassSweepItem>[
        for (final r in rows)
          PassSweepItem(
            passCode: (r['code'] as String?) ?? '',
            plate: (r['plate'] as String?) ?? '',
            endDateYmd: (r['end_date'] as String?) ?? '',
            price: (r['price'] as int?) ?? 0,
            status: (r['status'] as String?) ?? '',
          ),
      ];
      for (final a in planPassSweep(
          passes: items, now: now, sentKeys: sent)) {
        await svc.showNow(
          id: a.id,
          event: a.event,
          title: a.title,
          body: a.body,
          payload: a.payload,
          silent: a.silent,
        );
        await prefs.setBool(NotifConfig.sentKey(a.dedupeKey), true);
      }
    }

    if (userId != null) {
      final db = await AppDb.instance.db;
      final rows = await db.rawQuery('''
SELECT a.id AS id, s.name AS name, s.start_time AS st, s.end_time AS et,
       a.check_out_at AS cout, a.work_date AS wd
FROM attendance a JOIN shifts s ON s.id = a.shift_id
WHERE a.user_id = ? AND a.check_out_at IS NULL
ORDER BY a.work_date DESC LIMIT 3
''', [userId]);
      String trimHm(String? v) =>
          (v ?? '').length >= 5 ? (v ?? '').substring(0, 5) : (v ?? '');
      final items = <ShiftSweepItem>[
        for (final r in rows)
          ShiftSweepItem(
            attendanceId: (r['id'] as int?) ?? 0,
            shiftName: (r['name'] as String?) ?? '',
            endHm: trimHm(r['et'] as String?),
            rangeHm: '${r['st']}–${r['et']}',
            checkOutAt: r['cout'] as String?,
            workDateYmd: (r['wd'] as String?) ?? '',
            endsNextDay: hmToMin(trimHm(r['et'] as String?)) <=
                hmToMin(trimHm(r['st'] as String?)),
          ),
      ];
      for (final a in planShiftSweep(
          shifts: items, now: now, sentKeys: _sentKeys(prefs))) {
        await svc.showNow(
          id: a.id,
          event: a.event,
          title: a.title,
          body: a.body,
          payload: a.payload,
          silent: a.silent,
        );
        await prefs.setBool(NotifConfig.sentKey(a.dedupeKey), true);
      }
    }
  }

  /// Fallback inexact E2/E4 (one-off workmanager khi thiếu exact alarm).
  static Future<void> runFallbackFire(Map<String, dynamic>? input) async {
    if (input == null) return;
    final event =
        NotifEventX.fromCode(input['event'] as String?) ?? NotifEvent.e2;
    final payload =
        NotifPayload.decode(input['payload'] as String?);
    if (payload == null) return;
    await NotificationService.instance.showNow(
      id: (input['id'] as int?) ?? 0,
      event: event,
      title: (input['title'] as String?) ?? '',
      body: (input['body'] as String?) ?? '',
      payload: payload,
      silent: (input['silent'] as bool?) ?? false,
    );
  }
}
