import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'notifications/notification_scheduler.dart';
import 'notifications/notification_service.dart';

/// Deep-link chờ điều hướng khi app mở từ tap lúc kill (main → app).
String? initialNotifLink;
String? initialNotifAction;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final svc = NotificationService.instance;
  try {
    await svc.init();
  } catch (_) {
    // Plugin chưa sẵn (web/test) — app vẫn chạy, chỉ không có push local.
  }
  try {
    await NotificationScheduler.init();
  } catch (_) {
    // Workmanager không hỗ trợ nền tảng này — E1/E4 chỉ quét foreground.
  }
  try {
    final tap = await svc.launchTap();
    initialNotifLink = tap?.payload?.deepLink;
    initialNotifAction = tap?.actionId;
  } catch (_) {
    // Bỏ qua — user vào app bình thường.
  }
  runApp(const ProviderScope(child: ParkingApp()));
}
