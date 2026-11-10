import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Local SQLite mirror schema desktop (api-contract §1–§14) + cột phụ
/// `pending_sync` ở 4 bảng giao dịch. Không sync ngược V1.
class AppDb {
  AppDb._();

  static final AppDb instance = AppDb._();
  Database? _db;

  Future<Database> get db async {
    final existing = _db;
    if (existing != null) return existing;
    final dir = await getDatabasesPath();
    final created = await openDatabase(
      p.join(dir, 'parking_mobile.db'),
      version: 1,
      onCreate: _create,
    );
    _db = created;
    return created;
  }

  Future<void> _create(Database db, int version) async {
    final batch = db.batch();
    batch.execute('''
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  address TEXT,
  start_date TEXT,
  notes TEXT,
  permissions TEXT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('CREATE UNIQUE INDEX idx_users_phone ON users(phone)');
    batch.execute('''
CREATE TABLE parking_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vehicle_type_allowed TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  price_per_hour INTEGER NOT NULL,
  price_per_day INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE parking_spots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE CASCADE,
  spot_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (zone_id, spot_number)
)''');
    batch.execute('''
CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_plate TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE monthly_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pass_code TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  zone_id INTEGER REFERENCES parking_zones(id),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE parking_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_code TEXT NOT NULL UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  spot_id INTEGER REFERENCES parking_spots(id) ON DELETE SET NULL,
  zone_id INTEGER NOT NULL REFERENCES parking_zones(id),
  monthly_pass_id INTEGER REFERENCES monthly_passes(id),
  check_in_at TEXT NOT NULL,
  check_out_at TEXT,
  status TEXT NOT NULL DEFAULT 'parked',
  hourly_rate_applied INTEGER NOT NULL DEFAULT 0,
  daily_rate_applied INTEGER NOT NULL DEFAULT 0,
  total_fee INTEGER,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  closed_by INTEGER REFERENCES users(id),
  pending_sync INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES parking_sessions(id),
  monthly_pass_id INTEGER REFERENCES monthly_passes(id),
  amount INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_by INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  pending_sync INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  license_plate TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  zone_id INTEGER NOT NULL REFERENCES parking_zones(id),
  spot_id INTEGER REFERENCES parking_spots(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL DEFAULT '',
  pending_sync INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)''');
    batch.execute('''
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  work_date TEXT NOT NULL,
  check_in_at TEXT,
  check_out_at TEXT,
  opening_cash INTEGER NOT NULL DEFAULT 0,
  closing_cash INTEGER,
  handover_note TEXT,
  status TEXT NOT NULL DEFAULT 'present',
  pending_sync INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, shift_id, work_date)
)''');
    await batch.commit(noResult: true);
    await _seed(db);
  }

  Future<void> _seed(Database db) async {
    await db.insert('roles', {'name': 'admin', 'description': 'Admin'});
    await db.insert('roles', {'name': 'staff', 'description': 'Nhan vien'});
    await db.insert('roles', {'name': 'guest', 'description': 'Read-only'});
    await db.insert('roles', {'name': 'customer', 'description': 'SĐT'});
    final roles = await db.query('roles');
    int roleId(String name) =>
        (roles.firstWhere((r) => r['name'] == name)['id'] as int);

    // Demo hash = 'demo:<password>'. Production: bcrypt + server
    // (security review gate trước khi thay auth thật).
    await db.insert('users', {
      'username': 'admin',
      'password_hash': 'demo:admin123',
      'full_name': 'Quan tri vien',
      'role_id': roleId('admin'),
    });
    await db.insert('users', {
      'username': 'staff01',
      'password_hash': 'demo:staff123',
      'full_name': 'Nhan vien Cong',
      'phone': '0909000001',
      'role_id': roleId('staff'),
    });
    await db.insert('users', {
      'username': '0901234567',
      'password_hash': 'demo:customer123',
      'full_name': 'Khach Demo',
      'phone': '0901234567',
      'role_id': roleId('customer'),
    });

    final zoneA = await db.insert('parking_zones', {
      'code': 'A',
      'name': 'Khu A - O to',
      'vehicle_type_allowed': 'car',
      'capacity': 10,
      'price_per_hour': 20000,
      'price_per_day': 150000,
      'is_active': 1,
    });
    final zoneB = await db.insert('parking_zones', {
      'code': 'B',
      'name': 'Khu B - Xe may',
      'vehicle_type_allowed': 'motorbike',
      'capacity': 10,
      'price_per_hour': 5000,
      'price_per_day': 40000,
      'is_active': 1,
    });
    final zoneC = await db.insert('parking_zones', {
      'code': 'C',
      'name': 'Khu C - Hon hop',
      'vehicle_type_allowed': 'both',
      'capacity': 8,
      'price_per_hour': 10000,
      'price_per_day': 80000,
      'is_active': 1,
    });
    Future<void> seedSpots(int zoneId, String code, int n) async {
      for (var i = 1; i <= n; i++) {
        await db.insert('parking_spots', {
          'zone_id': zoneId,
          'spot_number': '$code-${i.toString().padLeft(2, '0')}',
          'status': 'available',
        });
      }
    }

    await seedSpots(zoneA, 'A', 10);
    await seedSpots(zoneB, 'B', 10);
    await seedSpots(zoneC, 'C', 8);

    await db.insert('shifts', {
      'code': 'MORNING',
      'name': 'Ca sang',
      'start_time': '06:00',
      'end_time': '14:00',
      'is_active': 1,
    });
    await db.insert('shifts', {
      'code': 'AFTERNOON',
      'name': 'Ca chieu',
      'start_time': '14:00',
      'end_time': '22:00',
      'is_active': 1,
    });
    await db.insert('shifts', {
      'code': 'NIGHT',
      'name': 'Ca dem',
      'start_time': '22:00',
      'end_time': '06:00',
      'is_active': 1,
    });

    // Xe demo của customer 0901234567 + 1 lượt đang đỗ tại A-01.
    final vehicleId = await db.insert('vehicles', {
      'license_plate': '51H-12345',
      'vehicle_type': 'car',
      'owner_name': 'Khach Demo',
      'owner_phone': '0901234567',
    });
    final spot = (await db.query(
      'parking_spots',
      where: 'zone_id = ?',
      whereArgs: [zoneA],
      limit: 1,
    ))
        .first;
    await db.update(
      'parking_spots',
      {'status': 'occupied'},
      where: 'id = ?',
      whereArgs: [spot['id']],
    );
    await db.insert('parking_sessions', {
      'ticket_code': 'T-DEMO-0001',
      'vehicle_id': vehicleId,
      'spot_id': spot['id'],
      'zone_id': zoneA,
      'check_in_at': '2026-11-10 08:00:00',
      'status': 'parked',
      'hourly_rate_applied': 20000,
      'daily_rate_applied': 150000,
      'pending_sync': 0,
    });
    await db.insert('monthly_passes', {
      'pass_code': 'MT-DEMO-0001',
      'vehicle_id': vehicleId,
      'zone_id': zoneA,
      'customer_name': 'Khach Demo',
      'customer_phone': '0901234567',
      'start_date': '2026-11-01',
      'end_date': '2026-11-30',
      'price': 4500000,
      'status': 'pending',
    });
  }

  /// Đếm hàng đợi đồng bộ (P2 sync thật; V1 chỉ đếm + hiển thị).
  Future<int> pendingCount() async {
    final d = await db;
    var total = 0;
    for (final t in [
      'parking_sessions',
      'payments',
      'reservations',
      'attendance'
    ]) {
      final r = await d.rawQuery(
        'SELECT COUNT(*) AS c FROM $t WHERE pending_sync = 1',
      );
      total += ((r.first['c'] as int?) ?? 0);
    }
    return total;
  }
}
