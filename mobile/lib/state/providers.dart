import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../db/app_db.dart';
import '../models/entities.dart';
import '../repos/auth_repo.dart';
import '../repos/customer_repo.dart';
import '../repos/parking_repo.dart';
import '../repos/staff_repo.dart';

/// Session: null = guest. Riverpod StateProvider để GoRouter redirect.
final sessionProvider = StateProvider<AppUser?>((ref) => null);

final highContrastProvider = StateProvider<bool>((ref) => false);

final dbProvider = Provider<AppDb>((ref) => AppDb.instance);
final authRepoProvider =
    Provider<AuthRepo>((ref) => AuthRepo(ref.watch(dbProvider)));
final parkingRepoProvider =
    Provider<ParkingRepo>((ref) => ParkingRepo(ref.watch(dbProvider)));
final customerRepoProvider =
    Provider<CustomerRepo>((ref) => CustomerRepo(ref.watch(dbProvider)));
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
