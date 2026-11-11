import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/db/app_db.dart';
import 'package:parking_mobile/models/entities.dart';
import 'package:parking_mobile/repos/customer_repo.dart';
import 'package:parking_mobile/repos/parking_repo.dart';
import 'package:parking_mobile/screens/customer_main.dart';
import 'package:parking_mobile/screens/customer_vehicles.dart';
import 'package:parking_mobile/state/providers.dart';

/// MO-013 regression: gõ ô biển số/tìm kiếm không được mất focus.
/// Fake repo (không chạm DB thật) + delay 50ms để lộ khung `waiting`:
/// code cũ (future inline trong build) rớt về LoadingList sau mỗi ký tự.

const _testUser = AppUser(
  id: 1,
  username: '0909000001',
  fullName: 'Test User',
  phone: '0909000001',
  address: null,
  startDate: null,
  roleId: 3,
  roleName: 'customer',
  permissions: StaffPermissions.defaults,
  isActive: 1,
);

const _car1 = VehicleRow(
  id: 1,
  licensePlate: '51H-12345',
  vehicleType: 'car',
  tripCount: 0,
  totalPaid: 0,
  parked: false,
);

const _car2 = VehicleRow(
  id: 2,
  licensePlate: '51G-99999',
  vehicleType: 'car',
  tripCount: 0,
  totalPaid: 0,
  parked: false,
);

class FakeCustomerRepo extends CustomerRepo {
  FakeCustomerRepo({this.vehicles = const [_car1]}) : super(AppDb.instance);

  final List<VehicleRow> vehicles;

  @override
  Future<List<VehicleRow>> myVehicles(String phone) async {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return vehicles;
  }

  @override
  Future<List<ReservationRow>> myReservations(int userId) async {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return const [];
  }

  @override
  Future<List<SessionRow>> mySessions(
    String phone, {
    String? from,
    String? to,
    String? search,
    int limit = 50,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return const [];
  }
}

class FakeParkingRepo extends ParkingRepo {
  FakeParkingRepo() : super(AppDb.instance);

  @override
  Future<List<ZoneAvailability>> availability() async {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return const [
      ZoneAvailability(
        zoneId: 1,
        zoneCode: 'A',
        freeSpots: 5,
        occupiedSpots: 1,
        maintenanceSpots: 0,
        capacity: 6,
      ),
    ];
  }

  @override
  Future<List<ParkingZone>> zones({bool activeOnly = true}) async {
    return const [
      ParkingZone(
        id: 1,
        code: 'A',
        name: 'Khu A',
        vehicleTypeAllowed: 'all',
        capacity: 6,
        pricePerHour: 5000,
        pricePerDay: 50000,
        isActive: 1,
      ),
    ];
  }
}

EditableTextState _editableOf(WidgetTester tester) =>
    tester.state<EditableTextState>(find.byType(EditableText).first);

/// Ô nhập còn giữ focus thật (bàn phím không tự đóng — đúng triệu chứng
/// MO-013). Không dùng Focus.of vì EditableText không chèn Focus ancestor
/// cho chính element của nó.
bool _keepsFocus(WidgetTester tester) {
  if (!tester.testTextInput.isVisible) return false;
  return FocusManager.instance.primaryFocus != null;
}

void main() {
  group('MO-013 mất focus ô biển số', () {
    testWidgets('đặt chỗ: gõ biển số từng ký tự không mất focus',
        (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sessionProvider.overrideWith((ref) => _testUser),
            customerRepoProvider
                .overrideWithValue(FakeCustomerRepo()),
            parkingRepoProvider.overrideWithValue(FakeParkingRepo()),
          ],
          child: const MaterialApp(home: ReservationsScreen()),
        ),
      );
      await tester.pump(); // loading
      await tester.pump(const Duration(milliseconds: 300)); // data về

      final field = find.byType(TextField);
      expect(field, findsOneWidget);
      await tester.tap(field);
      await tester.pump();

      // Gõ từng ký tự như bàn phím thật (1 xe → ô TextField, khác prefill).
      const plate = '51G-99999';
      var typed = '';
      for (final ch in plate.split('')) {
        typed += ch;
        await tester.enterText(field, typed);
        await tester.pump();
        expect(find.byType(TextField), findsOneWidget,
            reason: 'ô biển số bị unmount sau khi gõ "$typed"');
      }
      expect(_editableOf(tester).widget.controller.text, plate);
      expect(_keepsFocus(tester), isTrue,
          reason: 'mất focus khi gõ biển số');

      // Poll 60s của timer cũng không được unmount ô nhập.
      await tester.pump(const Duration(seconds: 61));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(TextField), findsOneWidget);
      expect(_editableOf(tester).widget.controller.text, plate);
      expect(_keepsFocus(tester), isTrue,
          reason: 'poll timer làm mất focus ô biển số');

      await tester.pumpWidget(const SizedBox()); // hủy timer
    });

    testWidgets('xe của tôi: ô tìm kiếm giữ focus khi gõ', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sessionProvider.overrideWith((ref) => _testUser),
            customerRepoProvider.overrideWithValue(
                FakeCustomerRepo(vehicles: const [_car1, _car2])),
          ],
          child: const MaterialApp(home: VehiclesScreen()),
        ),
      );
      await tester.pump(); // loading
      await tester.pump(const Duration(milliseconds: 300)); // data về

      final bar = find.byType(SearchBar);
      expect(bar, findsOneWidget);
      await tester.tap(bar);
      await tester.pump();

      await tester.enterText(bar, '51H');
      await tester.pump();
      expect(find.byType(SearchBar), findsOneWidget,
          reason: 'SearchBar bị unmount sau khi gõ (mất focus)');
      expect(_keepsFocus(tester), isTrue,
          reason: 'mất focus khi gõ tìm kiếm');
      // Lọc còn đúng 1 xe.
      expect(find.text('51H-12345'), findsOneWidget);
      expect(find.text('51G-99999'), findsNothing);

      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('đối chứng: pattern cũ (future inline) mất focus đúng như báo',
        (tester) async {
      // Probe cố ý giữ anti-pattern cũ để chứng minh test bắt được bug:
      // future tạo mới trong build + onChanged setState.
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: _OldPatternProbe())),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      final field = find.byType(TextField);
      expect(field, findsOneWidget);
      await tester.tap(field);
      await tester.pump();
      await tester.enterText(field, '5');
      await tester.pump();

      // Pattern cũ: rebuild → future mới → waiting → ô nhập bị unmount.
      expect(find.byType(TextField), findsNothing);
      expect(_keepsFocus(tester), isFalse);

      await tester.pump(const Duration(milliseconds: 100)); // xả future treo
      await tester.pumpWidget(const SizedBox());
    });
  });
}

/// Anti-pattern MO-013 (chỉ dùng cho test đối chứng, KHÔNG dùng trong app):
/// `future: _load()` tạo mới mỗi build + `onChanged` setState mỗi ký tự.
class _OldPatternProbe extends StatefulWidget {
  const _OldPatternProbe();

  @override
  State<_OldPatternProbe> createState() => _OldPatternProbeState();
}

class _OldPatternProbeState extends State<_OldPatternProbe> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<List<String>> _load() async {
    await Future<void>.delayed(const Duration(milliseconds: 50));
    return const ['a'];
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<String>>(
      future: _load(), // Anti-pattern: future mới mỗi build.
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        return TextField(
          controller: _c,
          onChanged: (_) => setState(() {}), // Rebuild mỗi ký tự.
        );
      },
    );
  }
}
