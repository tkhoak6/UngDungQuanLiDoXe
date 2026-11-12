import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/pb_client.dart';
import '../data/qr_key_store.dart';
import '../data/remember_session_store.dart';
import '../db/app_db.dart';
import '../models/entities.dart';
import '../repos/auth_repo.dart';
import '../repos/customer_repo.dart';
import '../repos/hybrid_auth_repo.dart';
import '../repos/parking_repo.dart';
import '../repos/qr_repo.dart';
import '../repos/staff_repo.dart';

/// Session: null = guest. Riverpod StateProvider để GoRouter redirect.
final sessionProvider = StateProvider<AppUser?>((ref) => null);

/// Nguồn phiên hiện tại: online (PocketBase) hay local ngoại tuyến.
final authSourceProvider = StateProvider<AuthSource?>((ref) => null);

/// Message "bắt login lại" sau resume fail (hết hạn/đổi pass/khóa) —
/// LoginScreen hiện 1 lần rồi xóa. Null = mở app bình thường.
final resumeNoticeProvider = StateProvider<String?>((ref) => null);

/// Tự login lại 1 lần lúc mở app (MO-018). True = đã resume session.
/// Chạy 1 lần duy nhất (FutureProvider cache) — ParkingApp hiện splash
/// trong lúc chờ, xong mới dựng router.
final sessionRestoreProvider = FutureProvider<bool>((ref) async {
  final hybrid = ref.read(hybridAuthRepoProvider);
  final attempt = await hybrid.restoreRemembered();
  if (!attempt.resumed) {
    final reason = attempt.reason;
    if (reason != null) {
      ref.read(resumeNoticeProvider.notifier).state =
          resumeMessage(reason);
    }
    return false;
  }
  ref.read(authSourceProvider.notifier).state = attempt.source;
  ref.read(sessionProvider.notifier).state = attempt.user;
  return true;
});

/// PocketBase client — khởi tạo 1 lần (đọc URL + phiên đã lưu).
final pbClientProvider = FutureProvider<PbClient>((ref) async {
  final prefs = await SharedPreferences.getInstance();
  final client = PbClient(prefs);
  await client.init();
  return client;
});

Future<PbClient?> _loadPb(Ref ref) async {
  try {
    return await ref
        .read(pbClientProvider.future)
        .timeout(const Duration(seconds: 8));
  } catch (_) {
    return null;
  }
}

final highContrastProvider = StateProvider<bool>((ref) => false);

final dbProvider = Provider<AppDb>((ref) => AppDb.instance);
final authRepoProvider =
    Provider<AuthRepo>((ref) => AuthRepo(ref.watch(dbProvider)));
final hybridAuthRepoProvider = Provider<HybridAuthRepo>((ref) =>
    HybridAuthRepo(
        ref.watch(authRepoProvider), ref.watch(dbProvider), () => _loadPb(ref)));
final parkingRepoProvider =
    Provider<ParkingRepo>((ref) => ParkingRepo(ref.watch(dbProvider)));
final customerRepoProvider =
    Provider<CustomerRepo>((ref) => CustomerRepo(ref.watch(dbProvider)));
final qrKeyStoreProvider = Provider<QrKeyStore>((ref) => QrKeyStore());
final qrRepoProvider = Provider<QrTicketRepo>(
    (ref) => QrTicketRepo(ref.watch(dbProvider), ref.watch(qrKeyStoreProvider)));
final staffRepoProvider =
    Provider<StaffRepo>((ref) => StaffRepo(ref.watch(dbProvider)));
final syncQueueProvider =
    Provider<SyncQueue>((ref) => SyncQueue(ref.watch(dbProvider)));

final offlineProvider = StreamProvider<bool>((ref) {
  final c = Connectivity();
  return c.onConnectivityChanged
      .map((results) => results.contains(ConnectivityResult.none));
});

/// Breadcrumb vai trò cho redirect: guest / customer / staff / admin.
String roleOf(AppUser? u) => u == null ? 'guest' : u.roleName;
