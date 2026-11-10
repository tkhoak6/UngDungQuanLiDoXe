import '../core/fee.dart';
import '../core/validators.dart';
import '../db/app_db.dart';
import '../models/entities.dart';

class RepoException implements Exception {
  const RepoException(this.code, this.message);

  final String code;
  final String message;
}

/// Zones / spots / check-in / check-out (staff + map read-only).
class ParkingRepo {
  ParkingRepo(this._db);

  final AppDb _db;

  Future<List<ParkingZone>> zones({bool activeOnly = true}) async {
    final d = await _db.db;
    final rows = await d.query(
      'parking_zones',
      where: activeOnly ? 'is_active = 1' : null,
      orderBy: 'code',
    );
    return rows.map(ParkingZone.fromMap).toList();
  }

  Future<List<ZoneAvailability>> availability() async {
    final d = await _db.db;
    final zones = await d.query('parking_zones',
        where: 'is_active = 1', orderBy: 'code');
    final out = <ZoneAvailability>[];
    for (final z in zones) {
      final counts = await d.rawQuery('''
SELECT
  SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS free,
  SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occ,
  SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maint
FROM parking_spots WHERE zone_id = ?
''', [z['id']]);
      out.add(ZoneAvailability(
        zoneId: z['id'] as int,
        zoneCode: z['code'] as String,
        freeSpots: ((counts.first['free'] as int?) ?? 0),
        occupiedSpots: ((counts.first['occ'] as int?) ?? 0),
        maintenanceSpots: ((counts.first['maint'] as int?) ?? 0),
        capacity: z['capacity'] as int,
      ));
    }
    return out;
  }

  Future<List<SpotCell>> spots(int zoneId) async {
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT s.id AS spot_id, s.zone_id, z.code AS zone_code, s.spot_number,
  s.status,
  (SELECT v.license_plate FROM parking_sessions ps
    JOIN vehicles v ON v.id = ps.vehicle_id
    WHERE ps.spot_id = s.id AND ps.status = 'parked' LIMIT 1) AS occupying_plate
FROM parking_spots s JOIN parking_zones z ON z.id = s.zone_id
WHERE s.zone_id = ? ORDER BY s.spot_number
''', [zoneId]);
    return rows.map(SpotCell.fromMap).toList();
  }

  /// Check-in: tạo vehicle nếu mới + session parked + spot occupied (1 txn).
  Future<SessionRow> checkIn({
    required String plate,
    required String vehicleType,
    required int zoneId,
    int? spotId,
    int? monthlyPassId,
    String? reservationCode,
    required int byUserId,
  }) async {
    final clean = Validators.normalizePlate(plate);
    final plateErr = Validators.plate(clean);
    if (plateErr != null) throw RepoException('INVALID_PLATE', plateErr);
    final d = await _db.db;
    return d.transaction((txn) async {
      final dup2 = await txn.rawQuery('''
SELECT ps.id FROM parking_sessions ps JOIN vehicles v ON v.id = ps.vehicle_id
WHERE v.license_plate = ? AND ps.status = 'parked' LIMIT 1
''', [clean]);
      if (dup2.isNotEmpty) {
        throw const RepoException(
            'ALREADY_PARKED', 'Xe đang đỗ — chuyển sang Thu phí.');
      }
      final zone = (await txn.query('parking_zones',
              where: 'id = ?', whereArgs: [zoneId], limit: 1))
          .first;
      if ((zone['is_active'] as int) != 1) {
        throw const RepoException('ZONE_OFF', 'Khu đã tắt.');
      }
      final allowed = zone['vehicle_type_allowed'] as String;
      if (allowed != 'both' && allowed != vehicleType) {
        throw RepoException(
            'ZONE_MISMATCH', 'Khu ${zone['code']} không nhận loại xe này.');
      }
      int resolvedSpot;
      if (spotId != null) {
        final s = (await txn.query('parking_spots',
                where: 'id = ?', whereArgs: [spotId], limit: 1))
            .first;
        if (s['status'] != 'available') {
          throw const RepoException('SPOT_TAKEN', 'Ô đã có xe.');
        }
        resolvedSpot = spotId;
      } else {
        final free = await txn.query(
          'parking_spots',
          where: 'zone_id = ? AND status = ?',
          whereArgs: [zoneId, 'available'],
          orderBy: 'spot_number',
          limit: 1,
        );
        if (free.isEmpty) {
          throw const RepoException('ZONE_FULL', 'Khu đã đầy.');
        }
        resolvedSpot = free.first['id'] as int;
      }
      var vehicleRows = await txn.query('vehicles',
          where: 'license_plate = ?', whereArgs: [clean], limit: 1);
      int vehicleId;
      if (vehicleRows.isEmpty) {
        vehicleId = await txn.insert('vehicles', {
          'license_plate': clean,
          'vehicle_type': vehicleType,
        });
      } else {
        vehicleId = vehicleRows.first['id'] as int;
      }
      final now = DateTime.now();
      final code =
          'T-${now.year}${_two(now.month)}${_two(now.day)}-${now.millisecondsSinceEpoch % 100000}';
      final sessionId = await txn.insert('parking_sessions', {
        'ticket_code': code,
        'vehicle_id': vehicleId,
        'spot_id': resolvedSpot,
        'zone_id': zoneId,
        'monthly_pass_id': monthlyPassId,
        'check_in_at': _stamp(now),
        'status': 'parked',
        'hourly_rate_applied': zone['price_per_hour'],
        'daily_rate_applied': zone['price_per_day'],
        'created_by': byUserId,
        'pending_sync': 1,
      });
      await txn.update(
        'parking_spots',
        {'status': 'occupied'},
        where: 'id = ?',
        whereArgs: [resolvedSpot],
      );
      if (reservationCode != null && reservationCode.isNotEmpty) {
        await txn.update(
          'reservations',
          {'status': 'active', 'pending_sync': 1},
          where: 'code = ? AND status = ?',
          whereArgs: [reservationCode, 'pending'],
        );
      }
      return SessionRow(
        id: sessionId,
        ticketCode: code,
        licensePlate: clean,
        zoneCode: zone['code'] as String,
        checkInAt: _stamp(now),
        checkOutAt: null,
        totalFee: null,
        isMonthly: false,
        status: 'parked',
        hourlyRate: zone['price_per_hour'] as int,
        dailyRate: zone['price_per_day'] as int,
      );
    });
  }

  Future<SessionRow?> findParked(String query) async {
    final d = await _db.db;
    final q = Validators.normalizePlate(query);
    final rows = await d.rawQuery('''
SELECT ps.id, ps.ticket_code, v.license_plate, z.code AS zone_code,
  ps.check_in_at, ps.check_out_at, ps.total_fee, ps.monthly_pass_id,
  ps.status, ps.hourly_rate_applied, ps.daily_rate_applied
FROM parking_sessions ps
JOIN vehicles v ON v.id = ps.vehicle_id
JOIN parking_zones z ON z.id = ps.zone_id
WHERE ps.status = 'parked' AND (ps.ticket_code = ? OR v.license_plate = ?)
LIMIT 1
''', [query.trim(), q]);
    if (rows.isEmpty) return null;
    final r = rows.first;
    return SessionRow(
      id: r['id'] as int,
      ticketCode: r['ticket_code'] as String,
      licensePlate: r['license_plate'] as String,
      zoneCode: r['zone_code'] as String,
      checkInAt: r['check_in_at'] as String,
      checkOutAt: r['check_out_at'] as String?,
      totalFee: r['total_fee'] as int?,
      isMonthly: r['monthly_pass_id'] != null,
      status: r['status'] as String,
      hourlyRate: r['hourly_rate_applied'] as int,
      dailyRate: r['daily_rate_applied'] as int,
    );
  }

  /// Check-out: chốt phí + spot available + payment (1 txn, append-only).
  Future<int> checkOut({
    required int sessionId,
    required int discount,
    String? discountReason,
    required String method,
    required int byUserId,
    ParkingSettings settings = ParkingSettings.defaults,
    DateTime? nowOverride,
  }) async {
    if (discount > 0 &&
        (discountReason == null || discountReason.trim().isEmpty)) {
      throw const RepoException(
          'REASON_REQUIRED', 'Giảm giá cần lý do (bắt buộc).');
    }
    final d = await _db.db;
    return d.transaction((txn) async {
      final rows = await txn.query('parking_sessions',
          where: 'id = ?', whereArgs: [sessionId], limit: 1);
      if (rows.isEmpty) {
        throw const RepoException('NOT_FOUND', 'Không tìm thấy vé.');
      }
      final s = rows.first;
      if (s['status'] != 'parked') {
        throw const RepoException('NOT_PARKED', 'Vé đã chốt trước đó.');
      }
      final now = nowOverride ?? DateTime.now();
      final fee = computeFee(
        checkIn: DateTime.parse((s['check_in_at'] as String).replaceAll(' ', 'T')),
        checkOut: now,
        hourlyRate: s['hourly_rate_applied'] as int,
        dailyRate: s['daily_rate_applied'] as int,
        graceMinutes: settings.feeGraceMinutes,
        dayThresholdHours: settings.feeDayThresholdHours,
        hasValidPass: s['monthly_pass_id'] != null,
        discount: discount,
      );
      await txn.update(
        'parking_sessions',
        {
          'check_out_at': _stamp(now),
          'status': 'completed',
          'total_fee': fee.total,
          'discount_amount': discount,
          'closed_by': byUserId,
          'pending_sync': 1,
        },
        where: 'id = ?',
        whereArgs: [sessionId],
      );
      final spotId = s['spot_id'] as int?;
      if (spotId != null) {
        await txn.update(
          'parking_spots',
          {'status': 'available'},
          where: 'id = ?',
          whereArgs: [spotId],
        );
      }
      await txn.insert('payments', {
        'session_id': sessionId,
        'amount': fee.total,
        'payment_method': method,
        'paid_at': _stamp(now),
        'received_by': byUserId,
        'note': discount > 0 ? 'Giam ${discountReason!.trim()}' : '',
        'pending_sync': 1,
      });
      return fee.total;
    });
  }

  String _stamp(DateTime n) =>
      '${n.year}-${_two(n.month)}-${_two(n.day)} ${_two(n.hour)}:${_two(n.minute)}:${_two(n.second)}';

  String _two(int v) => v.toString().padLeft(2, '0');
}
