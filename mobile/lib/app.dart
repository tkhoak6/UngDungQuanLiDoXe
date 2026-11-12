import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/tokens.dart';
import '../models/entities.dart';
import '../notifications/notifications.dart';
import '../screens/auth.dart';
import '../screens/customer_main.dart';
import '../screens/customer_more.dart';
import '../screens/customer_profile.dart';
import '../screens/customer_vehicles.dart';
import '../screens/map_screen.dart';
import '../screens/server_settings.dart';
import '../screens/staff_attendance.dart';
import '../screens/staff_ops.dart';
import '../state/providers.dart';
import 'main.dart' show initialNotifAction, initialNotifLink;

final routerProvider = Provider<GoRouter>((ref) {
  final session = ref.watch(sessionProvider);
  final role = roleOf(session);

  String redirect(BuildContext context, GoRouterState state) {
    final loc = state.matchedLocation;
    final public = loc == '/map' ||
        loc == '/login' ||
        loc == '/register' ||
        loc == '/settings';
    if (session == null) {
      return public ? loc : '/map';
    }
    if (role == 'admin') {
      return loc == '/blocked' ? loc : '/blocked';
    }
    if (role == 'staff') {
      if (loc.startsWith('/s') || loc == '/settings') return loc;
      return '/s/checkin';
    }
    // customer
    if (loc.startsWith('/c')) return loc;
    if (public) return loc;
    return '/c/map';
  }

  return GoRouter(
    initialLocation:
        session == null ? '/map' : (role == 'staff' ? '/s/checkin' : '/c/map'),
    redirect: redirect,
    routes: [
      GoRoute(
          path: '/map', builder: (c, s) => const MapScreen()),
      GoRoute(
          path: '/login',
          builder: (c, s) => const LoginScreen()),
      GoRoute(
          path: '/register',
          builder: (c, s) => const RegisterScreen()),
      GoRoute(
          path: '/settings',
          builder: (c, s) => const ServerSettingsScreen()),
      GoRoute(
          path: '/blocked',
          builder: (c, s) => const AdminBlockScreen()),
      // MO-015 — alias deep-link spec DS-014 (§1.3–§4.3) → route canonical.
      GoRoute(
        path: '/passes',
        redirect: (c, s) {
          final h = s.uri.queryParameters['highlight'];
          return '/c/passes${h == null ? '' : '?highlight=$h'}';
        },
      ),
      GoRoute(
        path: '/reservations',
        redirect: (c, s) {
          final q = s.uri.queryParameters;
          final code = q['code'];
          if (code == null) return '/c/reservations';
          final cc = q['confirm_cancel'];
          return '/c/reservations?code=$code'
              '${cc == null ? '' : '&confirm_cancel=$cc'}';
        },
      ),
      GoRoute(
        path: '/staff/attendance',
        redirect: (c, s) => '/s/attendance?checkout=1',
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) =>
            CustomerShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/c/map',
                builder: (c, s) => const MapScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/c/reservations',
              builder: (c, s) => ReservationsScreen(
                zoneId: int.tryParse(
                    s.uri.queryParameters['zone'] ?? ''),
                // MO-015 E2: tap "Xem mã"/"Hủy giữ chỗ" → highlight + confirm.
                focusCode: s.uri.queryParameters['code'],
                confirmCancel:
                    s.uri.queryParameters['confirm_cancel'] == '1',
              ),
            ),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/c/vehicles',
                builder: (c, s) => const VehiclesScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/c/passes',
                // MO-015 E1: highlight row vé từ deep-link.
                builder: (c, s) => PassesScreen(
                      highlightCode:
                          s.uri.queryParameters['highlight'],
                    )),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/c/profile',
                builder: (c, s) => const ProfileScreen()),
          ]),
        ],
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) =>
            StaffShell(shell: shell, session: session),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/s/checkin',
                builder: (c, s) => const CheckinScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/s/checkout',
                builder: (c, s) => const CheckoutScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/s/attendance',
                // MO-015 E4: tap "Chốt ca ngay" → auto-mở sheet Ra ca.
                builder: (c, s) => AttendanceScreen(
                      openCheckout:
                          s.uri.queryParameters['checkout'] == '1',
                    )),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/s/me',
                builder: (c, s) => const StaffMeScreen()),
          ]),
        ],
      ),
    ],
  );
});

class CustomerShell extends StatelessWidget {
  const CustomerShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: SafeArea(
        child: NavigationBar(
          height: 64,
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) => shell.goBranch(i),
          destinations: const [
            NavigationDestination(
                icon: Icon(Icons.map_outlined),
                selectedIcon: Icon(Icons.map),
                label: 'Sơ đồ',
                tooltip: 'Sơ đồ'),
            NavigationDestination(
                icon: Icon(Icons.event_outlined),
                selectedIcon: Icon(Icons.event),
                label: 'Đặt chỗ',
                tooltip: 'Đặt chỗ'),
            NavigationDestination(
                icon: Icon(Icons.directions_car_outlined),
                selectedIcon: Icon(Icons.directions_car),
                label: 'Xe tôi',
                tooltip: 'Xe tôi'),
            NavigationDestination(
                icon: Icon(Icons.card_membership_outlined),
                selectedIcon: Icon(Icons.card_membership),
                label: 'Vé',
                tooltip: 'Vé'),
            NavigationDestination(
                icon: Icon(Icons.person_outlined),
                selectedIcon: Icon(Icons.person),
                label: 'Cá nhân',
                tooltip: 'Cá nhân'),
          ],
        ),
      ),
    );
  }
}

class StaffShell extends ConsumerWidget {
  const StaffShell({super.key, required this.shell, required this.session});

  final StatefulNavigationShell shell;
  final AppUser? session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final perms = session?.permissions ?? StaffPermissions.defaults;
    final roleName = session?.roleName ?? 'staff';
    final canCheckin =
        resolvePerm(roleName: roleName, perms: perms, key: 'checkin') == 1;
    final items = <NavigationDestination>[
      NavigationDestination(
        icon: const Icon(Icons.login_outlined),
        selectedIcon: const Icon(Icons.login),
        label: canCheckin ? 'Check-in' : 'Check-in (khóa)',
        tooltip: 'Check-in',
      ),
      NavigationDestination(
        icon: const Icon(Icons.payments_outlined),
        selectedIcon: const Icon(Icons.payments),
        label: canCheckin ? 'Thu phí' : 'Thu phí (khóa)',
        tooltip: 'Thu phí',
      ),
      const NavigationDestination(
        icon: Icon(Icons.schedule_outlined),
        selectedIcon: Icon(Icons.schedule),
        label: 'Chấm công',
        tooltip: 'Chấm công',
      ),
      const NavigationDestination(
        icon: Icon(Icons.person_outlined),
        selectedIcon: Icon(Icons.person),
        label: 'Tôi',
        tooltip: 'Tôi',
      ),
    ];
    return Scaffold(
      body: shell,
      bottomNavigationBar: SafeArea(
        child: NavigationBar(
          height: 64,
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) {
            if ((i == 0 || i == 1) && !canCheckin) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                    content:
                        Text('Không có quyền check-in (NO_PERMISSION).')),
              );
              return;
            }
            shell.goBranch(i);
          },
          destinations: items,
        ),
      ),
    );
  }
}

/// MO-015 — nghe tap notification (foreground) + deep-link lúc kill +
/// quét bù launch sweep sau login.
class ParkingApp extends ConsumerStatefulWidget {
  const ParkingApp({super.key});

  @override
  ConsumerState<ParkingApp> createState() => _ParkingAppState();
}

class _ParkingAppState extends ConsumerState<ParkingApp> {
  StreamSubscription<NotifTap>? _sub;
  int? _sweptForUser;
  bool _initialConsumed = false;

  @override
  void initState() {
    super.initState();
    _sub = NotificationService.instance.taps.listen(_onTap);
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _consumeInitial());
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _consumeInitial() {
    if (_initialConsumed) return;
    _initialConsumed = true;
    final link = initialNotifLink;
    if (link == null || !mounted) return;
    initialNotifLink = null;
    final action = initialNotifAction;
    initialNotifAction = null;
    _goLink(_withAction(link, action));
  }

  void _onTap(NotifTap tap) {
    final p = tap.payload;
    if (p == null || !mounted) return;
    _goLink(_withAction(p.deepLink, tap.actionId));
  }

  /// E2 action "Hủy giữ chỗ" → mở màn confirm hủy (không hủy trực tiếp).
  String _withAction(String link, String? actionId) {
    if (actionId == 'cancel_hold' && !link.contains('confirm_cancel')) {
      return '$link${link.contains('?') ? '&' : '?'}confirm_cancel=1';
    }
    return link;
  }

  void _goLink(String link) {
    final session = ref.read(sessionProvider);
    if (session == null) return; // guest: redirect giữ /map.
    ref
        .read(routerProvider)
        .go(resolveTapLink(link, role: roleOf(session)));
  }

  /// Quét bù E1/E4 sau login (spec §7.1) — 1 lần/user id.
  Future<void> _maybeLaunchSweep(AppUser? session) async {
    if (session == null || _sweptForUser == session.id) return;
    _sweptForUser = session.id;
    try {
      await NotificationScheduler.runLaunchSweep(
        customerRepo: ref.read(customerRepoProvider),
        staffRepo: ref.read(staffRepoProvider),
        userId: session.id,
        ownerPhone: session.phone ?? session.username,
      );
    } catch (_) {
      // Daily sweep + lần mở sau bù tiếp — không chặn UI.
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    // MO-018: kích hoạt resume remember-me 1 lần lúc mở app.
    final restore = ref.watch(sessionRestoreProvider);
    ref.listen<AppUser?>(sessionProvider, (_, next) {
      _maybeLaunchSweep(next);
      if (initialNotifLink != null) _consumeInitial();
    });
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
    );
    // MO-018: đang verify remember token → splash, chưa dựng router để
    // không nháy màn guest trước khi session resume xong.
    if (restore.isLoading) {
      return MaterialApp(
        title: 'Bãi Xe Thông Minh',
        theme: base,
        home: const Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 16),
                Text('Đang mở…'),
              ],
            ),
          ),
        ),
      );
    }
    return MaterialApp.router(
      title: 'Bãi Xe Thông Minh',
      theme: base.copyWith(
        appBarTheme: base.appBarTheme.copyWith(
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.text,
          elevation: 0,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.primary,
          brightness: Brightness.dark,
        ),
      ),
      routerConfig: router,
    );
  }
}
