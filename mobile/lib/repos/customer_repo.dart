import '../core/fee.dart';
import '../core/reservations.dart';
import '../core/validators.dart';
import '../db/app_db.dart';
import '../models/entities.dart';
import 'parking_repo.dart';

/// Xe/Vé/Đặt chỗ/Hồ sơ của khách — mine-only: mọi query ép theo me.phone/me.id.
class CustomerRepo {
  CustomerRepo(this._db);

  final AppDb _db;

  Future<List<VehicleRow>> myVehicles(String phone) async {
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT v.id, v.license_plate, v.vehicle_type,
  (SELECT COUNT(*) FROM parking_sessions ps WHERE ps.vehicle_id = v.id) AS trips,
  (SELECT COALESCE(SUM(ps.total_fee), 0) FROM parking_sessions ps
    WHERE ps.vehicle_id = v.id AND ps.status = 'completed') AS paid,
  EXISTS(SELECT 1 FROM parking_sessions ps WHERE ps.vehicle_id = v.id
    AND ps.status = 'parked') AS parked
FROM vehicles v WHERE v.owner_phone = ? ORDER BY v.license_plate
''', [phone]);
    return rows
        .map((r) => VehicleRow(
              id: r['id'] as int,
              licensePlate: r['license_plate'] as String,
              vehicleType: r['vehicle_type'] as String,
              tripCount: (r['trips'] as int?) ?? 0,
              totalPaid: (r['paid'] as int?) ?? 0,
              parked: ((r['parked'] as int?) ?? 0) == 1,
            ))
        .toList();
  }

  /// Vé đang đỗ của khách (mine-only theo owner_phone) — render QR vé
  /// (MO-009 V1a, spec §1.1C). Vé đã check-out KHÔNG trả về ở đây nên
  /// không bao giờ vẽ QR vé cũ.
  Future<List<SessionRow>> myParkedSessions(String phone) async {
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT ps.id, ps.ticket_code, v.license_plate, z.code AS zone_code,
  ps.check_in_at, ps.check_out_at, ps.total_fee, ps.monthly_pass_id,
  ps.status, ps.hourly_rate_applied, ps.daily_rate_applied, ps.qr_text
FROM parking_sessions ps
JOIN vehicles v ON v.id = ps.vehicle_id
JOIN parking_zones z ON z.id = ps.zone_id
WHERE ps.status = 'parked' AND v.owner_phone = ?
ORDER BY ps.check_in_at DESC
''', [phone]);
    return rows
        .map((r) => SessionRow(
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
              qrText: r['qr_text'] as String?,
            ))
        .toList();
  }

  Future<List<SessionRow>> mySessions(
    String phone, {
    String? from,
    String? to,
    String? search,
    int limit = 50,
  }) async {
    final d = await _db.db;
    final where = StringBuffer(
        'ps.status = ? AND v.owner_phone = ?');
    final args = <Object?>['completed', phone];
    if (from != null) {
      where.write(' AND date(ps.check_in_at) >= date(?)');
      args.add(from);
    }
    if (to != null) {
      where.write(' AND date(ps.check_in_at) <= date(?)');
      args.add(to);
    }
    if (search != null && search.trim().isNotEmpty) {
      where.write(' AND (ps.ticket_code LIKE ? OR v.license_plate LIKE ?)');
      final like = '%${Validators.normalizePlate(search)}%';
      args.addAll([like, like]);
    }
    final rows = await d.rawQuery('''
SELECT ps.id, ps.ticket_code, v.license_plate, z.code AS zone_code,
  ps.check_in_at, ps.check_out_at, ps.total_fee, ps.monthly_pass_id,
  ps.status, ps.hourly_rate_applied, ps.daily_rate_applied
FROM parking_sessions ps
JOIN vehicles v ON v.id = ps.vehicle_id
JOIN parking_zones z ON z.id = ps.zone_id
WHERE $where ORDER BY ps.check_in_at DESC LIMIT $limit
''', args);
    return rows
        .map((r) => SessionRow(
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
            ))
        .toList();
  }

  Future<List<PassRow>> myPasses(String phone) async {
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT p.id, p.pass_code, v.license_plate,
  COALESCE(z.code, 'Mọi khu') AS zone_code,
  p.start_date, p.end_date, p.price, p.status
FROM monthly_passes p
JOIN vehicles v ON v.id = p.vehicle_id
LEFT JOIN parking_zones z ON z.id = p.zone_id
WHERE p.customer_phone = ? ORDER BY p.end_date DESC
''', [phone]);
    return rows
        .map((r) => PassRow(
              id: r['id'] as int,
              passCode: r['pass_code'] as String,
              licensePlate: r['license_plate'] as String,
              zoneCode: r['zone_code'] as String,
              startDate: r['start_date'] as String,
              endDate: r['end_date'] as String,
              price: r['price'] as int,
              status: r['status'] as String,
            ))
        .toList();
  }

  Future<PassRow> requestPass({
    required String plate,
    required String vehicleType,
    int? zoneId,
    required int months,
    required int userId,
    required String customerName,
    required String customerPhone,
  }) async {
    final clean = Validators.normalizePlate(plate);
    final err = Validators.plate(clean);
    if (err != null) throw RepoException('INVALID_PLATE', err);
    if (![1, 3, 6, 12].contains(months)) {
      throw const RepoException('INVALID_PLAN', 'Chọn gói 1/3/6/12 tháng.');
    }
    final d = await _db.db;
    return d.transaction((txn) async {
      final existing = await txn.rawQuery(
          'SELECT owner_phone FROM vehicles WHERE license_plate = ? LIMIT 1',
          [clean]);
      if (existing.isNotEmpty &&
          (existing.first['owner_phone'] as String?) != customerPhone &&
          ((existing.first['owner_phone'] as String?) ?? '').isNotEmpty) {
        throw const RepoException('PLATE_OWNED',
            'Biển số này đã thuộc SĐT khác — liên hệ quầy.');
      }
      int? zoneCodePrice;
      String zoneLabel = 'Mọi khu';
      if (zoneId != null) {
        final z = (await txn.query('parking_zones',
                where: 'id = ?', whereArgs: [zoneId], limit: 1))
            .first;
        if ((z['is_active'] as int) != 1) {
          throw const RepoException('ZONE_OFF', 'Khu đã tắt.');
        }
        final allowed = z['vehicle_type_allowed'] as String;
        if (allowed != 'both' && allowed != vehicleType) {
          throw const RepoException(
              'ZONE_MISMATCH', 'Khu không nhận loại xe này.');
        }
        zoneCodePrice = z['price_per_day'] as int;
        zoneLabel = z['code'] as String;
      } else {
        zoneCodePrice = 10000;
      }
      final dup = await txn.rawQuery('''
SELECT p.id FROM monthly_passes p JOIN vehicles v ON v.id = p.vehicle_id
WHERE v.license_plate = ? AND p.status IN ('pending','active') LIMIT 1
''', [clean]);
      if (dup.isNotEmpty) {
        throw const RepoException(
            'PASS_EXISTS', 'Xe này đã có vé còn hiệu lực/chờ xác nhận.');
      }
      int vehicleId;
      if (existing.isEmpty) {
        vehicleId = await txn.insert('vehicles', {
          'license_plate': clean,
          'vehicle_type': vehicleType,
          'owner_name': customerName,
          'owner_phone': customerPhone,
        });
      } else {
        vehicleId = (await txn.query('vehicles',
                where: 'license_plate = ?',
                whereArgs: [clean],
                limit: 1))
            .first['id'] as int;
      }
      final now = DateTime.now();
      final start =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final endDate = DateTime(now.year, now.month + months, now.day);
      final end =
          '${endDate.year}-${endDate.month.toString().padLeft(2, '0')}-${endDate.day.toString().padLeft(2, '0')}';
      final price = passPrice(pricePerDay: zoneCodePrice, months: months);
      final code =
          'MT-${now.year}${now.month.toString().padLeft(2, '0')}-${now.millisecondsSinceEpoch % 100000}';
      final id = await txn.insert('monthly_passes', {
        'pass_code': code,
        'vehicle_id': vehicleId,
        'zone_id': zoneId,
        'customer_name': customerName,
        'customer_phone': customerPhone,
        'start_date': start,
        'end_date': end,
        'price': price,
        'status': 'pending',
        'created_by': userId,
      });
      return PassRow(
        id: id,
        passCode: code,
        licensePlate: clean,
        zoneCode: zoneLabel,
        startDate: start,
        endDate: end,
        price: price,
        status: 'pending',
      );
    });
  }

  Future<void> cancelPass(int passId, String phone) async {
    final d = await _db.db;
    final changed = await d.update(
      'monthly_passes',
      {'status': 'cancelled'},
      where: 'id = ? AND customer_phone = ? AND status = ?',
      whereArgs: [passId, phone, 'pending'],
    );
    if (changed == 0) {
      throw const RepoException(
          'CANNOT_CANCEL', 'Chỉ hủy được vé đang chờ xác nhận của bạn.');
    }
  }

  Future<List<ReservationRow>> myReservations(int userId) async {
    final d = await _db.db;
    await sweepExpired(d);
    final rows = await d.rawQuery('''
SELECT r.id, r.code, z.code AS zone_code, r.license_plate,
  r.date, r.start_time, r.end_time, r.status, r.expires_at
FROM reservations r JOIN parking_zones z ON z.id = r.zone_id
WHERE r.user_id = ? ORDER BY r.date, r.start_time
''', [userId]);
    return rows
        .map((r) => ReservationRow(
              id: r['id'] as int,
              code: r['code'] as String,
              zoneCode: r['zone_code'] as String,
              licensePlate: r['license_plate'] as String,
              date: r['date'] as String,
              startTime: r['start_time'] as String,
              endTime: r['end_time'] as String,
              status: r['status'] as String,
              expiresAt: r['expires_at'] as String,
            ))
        .toList();
  }

  Future<void> sweepExpired(dynamic d) async {
    await d.rawUpdate(
        "UPDATE reservations SET status = 'expired' "
        "WHERE status = 'pending' AND expires_at < datetime('now')",
        []);
  }

  /// Đặt chỗ 24/24 + qua đêm (BE-019): `toMin <= fromMin` = sang hôm sau,
  /// duration 15p–4h, `expires_at` = giờ KẾT THÚC + 20p (tràn ngày).
  /// `date` = ngày bắt đầu (= today). Không khung giờ, không clamp.
  Future<ReservationRow> createReservation({
    required int userId,
    required String phone,
    required String plate,
    required int zoneId,
    required int fromMin,
    required int toMin,
  }) async {
    final now = DateTime.now();
    final cleanPlate = Validators.normalizePlate(plate);
    if ((Validators.plate(cleanPlate)) != null) {
      throw const RepoException('INVALID_PLATE', 'Biển số chưa đúng — VD: 51H-12345.');
    }
    final err = Validators.slot(
      date: now,
      now: now,
      fromMin: fromMin,
      toMin: toMin,
    );
    if (err != null) throw RepoException('INVALID_SLOT', err);
    final d = await _db.db;
    return d.transaction((txn) async {
      await sweepExpired(txn);
      final date =
          '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final quota = await txn.rawQuery(
          "SELECT COUNT(*) AS c FROM reservations WHERE user_id = ? "
          "AND status IN ('pending','active') AND date = ?",
          [userId, date]);
      if (((quota.first['c'] as int?) ?? 0) >= 2) {
        throw const RepoException(
            'QUOTA_EXCEEDED', 'Bạn đã có 2 chỗ đang giữ.');
      }
      final free = await txn.query(
        'parking_spots',
        where: 'zone_id = ? AND status = ?',
        whereArgs: [zoneId, 'available'],
        orderBy: 'spot_number',
        limit: 1,
      );
      if (free.isEmpty) {
        throw const RepoException(
            'ZONE_FULL', 'Khu vừa hết chỗ giữ — chọn khu khác.');
      }
      final range = startEndOf(now, fromMin, toMin);
      final start = hhmm(fromMin);
      final end = hhmm(toMin);
      final code =
          'R-${now.year}${_two2(now.month)}${_two2(now.day)}-${now.millisecondsSinceEpoch % 100000}';
      final exp = range.end.add(const Duration(minutes: 20));
      final id = await txn.insert('reservations', {
        'code': code,
        'user_id': userId,
        'license_plate': cleanPlate,
        'customer_phone': phone,
        'zone_id': zoneId,
        'spot_id': free.first['id'],
        'date': date,
        'start_time': start,
        'end_time': end,
        'status': 'pending',
        'expires_at': stampOf(exp),
        'pending_sync': 1,
      });
      await txn.update(
        'parking_spots',
        {'status': 'reserved'},
        where: 'id = ?',
        whereArgs: [free.first['id']],
      );
      final z = (await txn.query('parking_zones',
              where: 'id = ?', whereArgs: [zoneId], limit: 1))
          .first;
      return ReservationRow(
        id: id,
        code: code,
        zoneCode: z['code'] as String,
        licensePlate: cleanPlate,
        date: date,
        startTime: start,
        endTime: end,
        status: 'pending',
        expiresAt: stampOf(exp),
      );
    });
  }

  String _two2(int v) => v.toString().padLeft(2, '0');

  Future<void> cancelReservation(String code, int userId) async {
    final d = await _db.db;
    await d.transaction((txn) async {
      final rows = await txn.query(
        'reservations',
        where: 'code = ? AND user_id = ? AND status = ?',
        whereArgs: [code, userId, 'pending'],
        limit: 1,
      );
      if (rows.isEmpty) {
        throw const RepoException(
            'CANNOT_CANCEL', 'Chỉ hủy được chỗ đang giữ của bạn.');
      }
      await txn.update(
        'reservations',
        {'status': 'cancelled', 'pending_sync': 1},
        where: 'id = ?',
        whereArgs: [rows.first['id']],
      );
      final spotId = rows.first['spot_id'] as int?;
      if (spotId != null) {
        await txn.update(
          'parking_spots',
          {'status': 'available'},
          where: 'id = ? AND status = ?',
          whereArgs: [spotId, 'reserved'],
        );
      }
    });
  }
}
