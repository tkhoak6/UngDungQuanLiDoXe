import 'package:shared_preferences/shared_preferences.dart';

import '../db/app_db.dart';
import '../models/entities.dart';
import 'parking_repo.dart';

/// Ca làm việc + chấm công (mine-only) + SyncQueue stub (P2 sync thật).
class StaffRepo {
  StaffRepo(this._db);

  final AppDb _db;

  Future<List<ShiftRow>> shifts() async {
    final d = await _db.db;
    final rows = await d.query('shifts',
        where: 'is_active = 1', orderBy: 'start_time');
    return rows.map(ShiftRow.fromMap).toList();
  }

  /// Quy ước ca đêm (api-contract §14): work_date = ngày bắt đầu ca.
  /// 00:00–06:00 → NIGHT hôm qua; 06–14 MORNING; 14–22 AFTERNOON; 22–24 NIGHT.
  static Map<String, String> currentShift(DateTime now) {
    String two(int v) => v.toString().padLeft(2, '0');
    String day(DateTime d) => '${d.year}-${two(d.month)}-${two(d.day)}';
    final mins = now.hour * 60 + now.minute;
    if (mins < 6 * 60) {
      return {
        'code': 'NIGHT',
        'work_date': day(now.subtract(const Duration(days: 1)))
      };
    }
    if (mins < 14 * 60) return {'code': 'MORNING', 'work_date': day(now)};
    if (mins < 22 * 60) return {'code': 'AFTERNOON', 'work_date': day(now)};
    return {'code': 'NIGHT', 'work_date': day(now)};
  }

  Future<AttendanceRow?> today(int userId) async {
    final d = await _db.db;
    final cur = currentShift(DateTime.now());
    final rows = await d.rawQuery('''
SELECT a.id, s.name AS shift_name, a.work_date, a.check_in_at,
  a.check_out_at, a.status
FROM attendance a JOIN shifts s ON s.id = a.shift_id
JOIN shifts sc ON sc.code = ?
WHERE a.user_id = ? AND a.work_date = ? AND a.shift_id = sc.id LIMIT 1
''', [cur['code'], userId, cur['work_date']]);
    if (rows.isEmpty) return null;
    final r = rows.first;
    return AttendanceRow(
      id: r['id'] as int,
      shiftName: r['shift_name'] as String,
      workDate: r['work_date'] as String,
      checkInAt: r['check_in_at'] as String?,
      checkOutAt: r['check_out_at'] as String?,
      status: r['status'] as String,
    );
  }

  Future<void> checkInShift(int userId, {int openingCash = 0}) async {
    final d = await _db.db;
    final cur = currentShift(DateTime.now());
    final shift = (await d.query('shifts',
            where: 'code = ?', whereArgs: [cur['code']], limit: 1))
        .first;
    try {
      await d.insert('attendance', {
        'user_id': userId,
        'shift_id': shift['id'],
        'work_date': cur['work_date'],
        'check_in_at': _stamp(DateTime.now()),
        'opening_cash': openingCash,
        'status': 'present',
        'pending_sync': 1,
      });
    } catch (_) {
      throw const RepoException(
          'ALREADY_CHECKED_IN', 'Đã chấm ca này.');
    }
  }

  Future<int> checkOutShift(
    int userId, {
    required int closingCash,
    String? note,
  }) async {
    final d = await _db.db;
    final cur = currentShift(DateTime.now());
    final rows = await d.rawQuery('''
SELECT a.* FROM attendance a JOIN shifts s ON s.id = a.shift_id
WHERE a.user_id = ? AND a.work_date = ? AND s.code = ? LIMIT 1
''', [userId, cur['work_date'], cur['code']]);
    if (rows.isEmpty) {
      throw const RepoException('NOT_CHECKED_IN', 'Chưa vào ca.');
    }
    final a = rows.first;
    if (a['check_out_at'] != null) {
      throw const RepoException('ALREADY_CLOSED', 'Ca đã chốt.');
    }
    final opening = (a['opening_cash'] as int?) ?? 0;
    await d.update(
      'attendance',
      {
        'check_out_at': _stamp(DateTime.now()),
        'closing_cash': closingCash,
        'handover_note': (note ?? '').trim(),
        'pending_sync': 1,
      },
      where: 'id = ?',
      whereArgs: [a['id']],
    );
    return closingCash - opening; // variance thô (đối soát doanh thu ở P2)
  }

  Future<List<AttendanceRow>> history(int userId, {int days = 7}) async {
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT a.id, s.name AS shift_name, a.work_date, a.check_in_at,
  a.check_out_at, a.status
FROM attendance a JOIN shifts s ON s.id = a.shift_id
WHERE a.user_id = ? ORDER BY a.work_date DESC LIMIT ?
''', [userId, days]);
    return rows
        .map((r) => AttendanceRow(
              id: r['id'] as int,
              shiftName: r['shift_name'] as String,
              workDate: r['work_date'] as String,
              checkInAt: r['check_in_at'] as String?,
              checkOutAt: r['check_out_at'] as String?,
              status: r['status'] as String,
            ))
        .toList();
  }

  Future<String?> yesterdayOpen(int userId) async {
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT work_date FROM attendance
WHERE user_id = ? AND check_out_at IS NULL
ORDER BY work_date DESC LIMIT 1
''', [userId]);
    if (rows.isEmpty) return null;
    return rows.first['work_date'] as String;
  }

  String _stamp(DateTime n) =>
      '${n.year}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')} '
      '${n.hour.toString().padLeft(2, '0')}:${n.minute.toString().padLeft(2, '0')}:${n.second.toString().padLeft(2, '0')}';
}

/// SyncQueue stub V1: đếm pending + nút "Đồng bộ ngay" (P2 sync thật).
/// Conflict chốt trước: server thắng cho giá/zone, client thắng cho
/// giao dịch trong hàng đợi (payments append-only).
class SyncQueue {
  SyncQueue(this._db);

  final AppDb _db;

  Future<int> pending() => _db.pendingCount();

  Future<DateTime?> lastSyncAt() async {
    final prefs = await SharedPreferences.getInstance();
    final v = prefs.getString('last_sync_at');
    return v == null ? null : DateTime.tryParse(v);
  }

  Future<void> pushNow() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('last_sync_at', DateTime.now().toIso8601String());
  }
}
