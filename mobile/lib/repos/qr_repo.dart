import '../core/qr_ticket.dart';
import '../data/qr_key_store.dart';
import '../db/app_db.dart';
import '../models/entities.dart';

/// Ký + verify vé QR trên mobile (V1a).
///
/// - Ký: chỉ STAFF device có key (secure storage) lúc check-in; key vắng
///   → trả null để UI fallback text-only (mã vé + biển số + “hiện QR khi
///   có mạng”). KHÔNG throw để không chặn luồng check-in.
/// - Verify: SIG offline bằng key + đối soát `status` trong DB local
///   (parked mới valid; completed/cancelled → ALREADY_USED) — mirror
///   `tickets:verify-qr` BE-018 + spec §1.3. Thu offline → `pending_sync`.
class QrTicketRepo {
  QrTicketRepo(this._db, this._keys);

  final AppDb _db;
  final QrKeyStore _keys;

  Future<bool> get hasKey => _keys.hasKey;

  /// Ký + lưu `qr_text` cho session vừa check-in. Null = chưa có key.
  Future<String?> signForSession(int sessionId) async {
    final keyB64 = await _keys.readKeyB64();
    if (keyB64 == null) return null;
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT ps.ticket_code, v.license_plate, ps.check_in_at
FROM parking_sessions ps JOIN vehicles v ON v.id = ps.vehicle_id
WHERE ps.id = ? LIMIT 1
''', [sessionId]);
    if (rows.isEmpty) return null;
    final r = rows.first;
    late final String qr;
    try {
      qr = QrTicket.signTicket(
        ticketCode: r['ticket_code'] as String,
        licensePlate: r['license_plate'] as String,
        checkInAt: r['check_in_at'] as String,
        keyB64: keyB64,
      );
    } on QrTicketException {
      return null;
    }
    await d.update(
      'parking_sessions',
      {'qr_text': qr, 'pending_sync': 1},
      where: 'id = ?',
      whereArgs: [sessionId],
    );
    return qr;
  }

  /// Verify QR quét được: SIG offline + đối soát DB local.
  Future<QrCheckResult> verify(String qrText) async {
    final keyB64 = await _keys.readKeyB64();
    if (keyB64 == null) {
      return const QrCheckResult(
        valid: false,
        reason: QrFailReason.noKey,
        message: 'Chưa có khóa xác thực — đăng nhập khi có mạng 1 lần.',
      );
    }
    final sig = QrTicket.verifySignature(qrText, keyB64);
    if (!sig.ok) {
      final reason = sig.reason ?? QrFailReason.invalidFormat;
      return QrCheckResult(
        valid: false,
        reason: reason,
        message: QrTicket.messageFor(reason),
      );
    }
    final payload = sig.payload!;
    final d = await _db.db;
    final rows = await d.rawQuery('''
SELECT ps.id, ps.ticket_code, v.license_plate, z.code AS zone_code,
  ps.check_in_at, ps.check_out_at, ps.total_fee, ps.monthly_pass_id,
  ps.status, ps.hourly_rate_applied, ps.daily_rate_applied, ps.qr_text
FROM parking_sessions ps
JOIN vehicles v ON v.id = ps.vehicle_id
JOIN parking_zones z ON z.id = ps.zone_id
WHERE ps.ticket_code = ? LIMIT 1
''', [payload.ticketCode]);
    if (rows.isEmpty) {
      return QrCheckResult(
        valid: false,
        reason: QrFailReason.notFound,
        message: QrTicket.messageFor(QrFailReason.notFound),
      );
    }
    final r = rows.first;
    final dbPlate =
        QrTicket.normalizePlateForQr(r['license_plate'] as String);
    if (dbPlate != payload.plateNorm) {
      return QrCheckResult(
        valid: false,
        reason: QrFailReason.plateMismatch,
        message: QrTicket.messageFor(QrFailReason.plateMismatch),
      );
    }
    if ((r['status'] as String) != 'parked') {
      final out = (r['check_out_at'] as String?) ?? '';
      final hhmm = out.length >= 16 ? out.substring(11, 16) : out;
      return QrCheckResult(
        valid: false,
        reason: QrFailReason.alreadyUsed,
        message: 'Vé ${payload.ticketCode} đã check-out lúc $hhmm.',
      );
    }
    return QrCheckResult(
      valid: true,
      session: SessionRow(
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
      ),
    );
  }
}

/// Kết quả verify QR phía staff — `valid` + session → prefill check-out;
/// fail → inline banner với [message] tiếng Việt (không màn trung gian).
class QrCheckResult {
  const QrCheckResult({
    required this.valid,
    this.reason,
    this.message,
    this.session,
  });

  final bool valid;
  final QrFailReason? reason;
  final String? message;
  final SessionRow? session;
}
