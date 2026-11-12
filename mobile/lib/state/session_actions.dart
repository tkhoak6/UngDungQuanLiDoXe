import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';

/// Đăng xuất tập trung (MO-018): thu hồi remember token của máy
/// (mirror BE-023 `auth:logout {token}`) + xóa phiên PB + null session.
///
/// Mọi nút Đăng xuất trong app PHẢI gọi hàm này (không tự null session
/// lẻ — sẽ quên thu hồi token và lần mở sau tự resume lại).
/// Điều hướng (`context.go('/map')`) do caller quyết sau khi gọi.
Future<void> signOut(WidgetRef ref) async {
  await ref.read(hybridAuthRepoProvider).clearRemembered();
  unawaited(ref.read(hybridAuthRepoProvider).logoutRemote());
  ref.read(authSourceProvider.notifier).state = null;
  ref.read(sessionProvider.notifier).state = null;
}
