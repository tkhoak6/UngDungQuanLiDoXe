import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/tokens.dart';
import '../models/entities.dart';
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
                builder: (c, s) => const PassesScreen()),
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
                builder: (c, s) => const AttendanceScreen()),
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

class ParkingApp extends ConsumerWidget {
  const ParkingApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: AppColors.primary),
    );
    return MaterialApp.router(
      title: 'Parking Mobile',
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
