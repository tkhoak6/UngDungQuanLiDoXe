/// MO-015 — Wrapper `flutter_local_notifications` V1 (local only, KHÔNG FCM).
///
/// - Kênh: `parking_reminders` (E1/E4) + `parking_urgent` (E2 high).
/// - Tap (foreground/background/kill) → [taps] stream payload V1
///   (`NotifPayload.encode`) + actionId (E2: `view` / `cancel_hold`).
/// - Exact alarm (E2/E4): `zonedSchedule(exactAllowWhileIdle)`; từ chối
///   quyền → caller fallback workmanager one-off (inexact +15p, spec §7).
library;

import 'dart:async';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:timezone/timezone.dart' as tz;

import 'notification_config.dart';
import 'notification_content.dart';

/// 1 lần tap/action trên notification.
class NotifTap {
  const NotifTap({required this.payload, this.actionId});

  final NotifPayload? payload;
  final String? actionId;
}

@pragma('vm:entry-point')
void notifBackgroundTap(NotificationResponse r) {
  // Chạy trong isolate nền khi user bấm action lúc app kill:
  // không điều hướng được — foreground/khởi động sau sẽ đọc lại qua
  // getNotificationAppLaunchDetails() trong [NotificationService.init].
}

class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  final StreamController<NotifTap> _taps =
      StreamController<NotifTap>.broadcast();

  bool _ready = false;
  bool get isReady => _ready;

  Stream<NotifTap> get taps => _taps.stream;

  Future<void> init() async {
    if (_ready) return;
    const androidInit =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const darwinInit = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    const settings = InitializationSettings(
      android: androidInit,
      iOS: darwinInit,
      macOS: darwinInit,
    );
    await _plugin.initialize(
      settings: settings,
      onDidReceiveNotificationResponse: _onTap,
      onDidReceiveBackgroundNotificationResponse: notifBackgroundTap,
    );
    await _ensureChannels();
    _ready = true;
  }

  void _onTap(NotificationResponse r) {
    _taps.add(NotifTap(
      payload: NotifPayload.decode(r.payload),
      actionId: r.actionId,
    ));
  }

  Future<void> _ensureChannels() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return;
    await android.createNotificationChannel(const AndroidNotificationChannel(
      NotifConfig.channelRemindersId,
      NotifConfig.channelRemindersName,
      description: NotifConfig.channelRemindersDesc,
      importance: Importance.defaultImportance,
    ));
    await android.createNotificationChannel(const AndroidNotificationChannel(
      NotifConfig.channelUrgentId,
      NotifConfig.channelUrgentName,
      description: NotifConfig.channelUrgentDesc,
      importance: Importance.high,
    ));
  }

  // -- Quyền (spec §5: rationale trước, system prompt sau) ---------------

  Future<bool> areEnabled() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    final enabled = await android?.areNotificationsEnabled();
    return enabled ?? true;
  }

  /// System prompt Android 13+ (gọi SAU rationale sheet).
  Future<bool> requestPermission() async {
    final status = await Permission.notification.request();
    return status.isGranted || status.isLimited;
  }

  Future<PermissionStatus> permissionStatus() =>
      Permission.notification.status;

  Future<void> openSettings() => openAppSettings();

  Future<bool?> canScheduleExactAlarms() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return android?.canScheduleExactNotifications();
  }

  Future<void> requestExactAlarms() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await android?.requestExactAlarmsPermission();
  }

  /// Payload khi app được mở từ tap lúc kill (điều hướng 1 lần ở main).
  Future<NotifTap?> launchTap() async {
    final details = await _plugin.getNotificationAppLaunchDetails();
    if (details == null || !details.didNotificationLaunchApp) return null;
    final r = details.notificationResponse;
    if (r == null) return null;
    return NotifTap(
      payload: NotifPayload.decode(r.payload),
      actionId: r.actionId,
    );
  }

  // -- Hiện / hẹn giờ -----------------------------------------------------

  AndroidNotificationDetails _android(
    NotifEvent event, {
    bool silent = false,
    List<AndroidNotificationAction>? actions,
  }) {
    final urgent = event == NotifEvent.e2;
    if (silent) {
      return AndroidNotificationDetails(
        urgent
            ? NotifConfig.channelUrgentId
            : NotifConfig.channelRemindersId,
        urgent
            ? NotifConfig.channelUrgentName
            : NotifConfig.channelRemindersName,
        channelDescription: urgent
            ? NotifConfig.channelUrgentDesc
            : NotifConfig.channelRemindersDesc,
        importance: Importance.low,
        priority: Priority.low,
        playSound: false,
        enableVibration: false,
        actions: actions,
      );
    }
    return AndroidNotificationDetails(
      urgent ? NotifConfig.channelUrgentId : NotifConfig.channelRemindersId,
      urgent ? NotifConfig.channelUrgentName : NotifConfig.channelRemindersName,
      channelDescription: urgent
          ? NotifConfig.channelUrgentDesc
          : NotifConfig.channelRemindersDesc,
      importance:
          urgent ? Importance.high : Importance.defaultImportance,
      priority: urgent ? Priority.high : Priority.defaultPriority,
      actions: actions,
    );
  }

  /// Hiện ngay (E1 bù lúc mở app, ping test sau khi grant).
  Future<void> showNow({
    required int id,
    required NotifEvent event,
    required String title,
    required String body,
    required NotifPayload payload,
    bool silent = false,
    List<AndroidNotificationAction>? actions,
  }) async {
    await init();
    await _plugin.show(
      id: id,
      title: title,
      body: body,
      notificationDetails:
          NotificationDetails(android: _android(event, silent: silent, actions: actions)),
      payload: payload.encode(),
    );
  }

  /// Hẹn exact (E2/E4). Ném [ExactAlarmDenied] khi thiếu quyền exact
  /// để caller fallback workmanager one-off (spec §7).
  Future<void> scheduleExact({
    required int id,
    required NotifEvent event,
    required String title,
    required String body,
    required DateTime when,
    required NotifPayload payload,
    bool silent = false,
    List<AndroidNotificationAction>? actions,
  }) async {
    await init();
    final canExact = await canScheduleExactAlarms();
    if (canExact == false) throw const ExactAlarmDenied();
    await _plugin.zonedSchedule(
      id: id,
      title: title,
      body: body,
      scheduledDate: tz.TZDateTime.from(when, tz.local),
      notificationDetails:
          NotificationDetails(android: _android(event, silent: silent, actions: actions)),
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      payload: payload.encode(),
    );
  }

  Future<void> cancel(int id) async {
    await init();
    await _plugin.cancel(id: id);
  }

  Future<void> cancelAll() async {
    await init();
    await _plugin.cancelAll();
  }
}

class ExactAlarmDenied implements Exception {
  const ExactAlarmDenied();

  @override
  String toString() =>
      'ExactAlarmDenied: thiếu SCHEDULE_EXACT_ALARM — dùng fallback inexact.';
}
