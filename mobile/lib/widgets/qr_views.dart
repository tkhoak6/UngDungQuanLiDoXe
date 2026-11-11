import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/tokens.dart';
import '../models/entities.dart';
import 'ui.dart';

/// Card vé đang đỗ của khách (spec §1.1C, §5): QR ≥160dp trên nền trắng
/// tinh (kể cả dark-mode) + mã vé mono + biển số mono 18 + khu + giờ vào.
/// Vé không có `qr_text` (chưa ký / offline) → card text-only + ghi chú.
class ParkedTicketCard extends StatelessWidget {
  const ParkedTicketCard({
    super.key,
    required this.session,
    required this.onExpand,
  });

  final SessionRow session;
  final VoidCallback onExpand;

  @override
  Widget build(BuildContext context) {
    final qr = session.qrText;
    return Card(
      child: InkWell(
        onTap: onExpand,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(AppGaps.s12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (qr != null && qr.isNotEmpty)
                Semantics(
                  label: 'Mã QR vé ${session.ticketCode}',
                  image: true,
                  child: Container(
                    color: Colors.white,
                    padding: const EdgeInsets.all(4),
                    child: QrImageView(
                      data: qr,
                      version: QrVersions.auto,
                      size: 160,
                      backgroundColor: Colors.white,
                      errorCorrectionLevel: QrErrorCorrectLevel.M,
                    ),
                  ),
                )
              else
                Container(
                  width: 160,
                  padding: const EdgeInsets.all(AppGaps.s12),
                  decoration: BoxDecoration(
                    color: AppColors.warningTint,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.warning),
                  ),
                  child: const Text(
                    'Chưa có mã QR — vé vẫn hiệu lực. QR sẽ hiện khi có mạng hoặc hỏi quầy.',
                    style: AppText.helper,
                  ),
                ),
              const SizedBox(width: AppGaps.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    PlateText(session.ticketCode, size: 14),
                    const SizedBox(height: AppGaps.s4),
                    PlateText(session.licensePlate, size: 18),
                    const SizedBox(height: AppGaps.s4),
                    Text(
                      'Khu ${session.zoneCode} · Vào ${session.checkInAt}',
                      style: AppText.body,
                    ),
                    const SizedBox(height: AppGaps.s4),
                    const ParkedBadge(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bottom sheet QR phóng to cho khách đưa staff quét (spec §1.1C.3).
/// Nền trắng bao quanh QR để tương phản scan ngoài nắng.
class TicketQrSheet extends StatelessWidget {
  const TicketQrSheet({super.key, required this.session});

  final SessionRow session;

  @override
  Widget build(BuildContext context) {
    final qr = session.qrText ?? '';
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Vé ${session.ticketCode}', style: AppText.cardTitle),
        const SizedBox(height: AppGaps.s8),
        if (qr.isNotEmpty)
          Center(
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.all(AppGaps.s16),
              child: QrImageView(
                data: qr,
                version: QrVersions.auto,
                size: 240,
                backgroundColor: Colors.white,
                errorCorrectionLevel: QrErrorCorrectLevel.M,
                semanticsLabel: 'Mã QR vé ${session.ticketCode}',
              ),
            ),
          )
        else
          const Text(
            'Chưa có mã QR — đưa mã vé + biển số cho nhân viên.',
            style: AppText.body,
          ),
        const SizedBox(height: AppGaps.s12),
        PlateText(session.licensePlate, size: 20),
        const SizedBox(height: AppGaps.s4),
        Text(
          'Khu ${session.zoneCode} · Vào ${session.checkInAt}',
          style: AppText.body,
        ),
        const SizedBox(height: AppGaps.s4),
        const Text(
          'Đưa mã này cho nhân viên lúc ra cổng.',
          style: AppText.helper,
        ),
        const SizedBox(height: AppGaps.s16),
      ],
    );
  }
}

/// QR trong success sheet check-in staff (spec §1.1A.2): 200dp + mã vé
/// mono 16 + biển số mono 20 + giờ vào. Không có key ký → text-only.
class CheckinQrView extends StatelessWidget {
  const CheckinQrView({super.key, required this.session, this.qrText});

  final SessionRow session;
  final String? qrText;

  @override
  Widget build(BuildContext context) {
    final qr = qrText;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Check-in thành công', style: AppText.cardTitle),
        const SizedBox(height: AppGaps.s8),
        if (qr != null && qr.isNotEmpty)
          Center(
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.all(AppGaps.s16),
              child: QrImageView(
                data: qr,
                version: QrVersions.auto,
                size: 200,
                backgroundColor: Colors.white,
                errorCorrectionLevel: QrErrorCorrectLevel.M,
                semanticsLabel: 'Mã QR vé ${session.ticketCode}',
              ),
            ),
          ),
        const SizedBox(height: AppGaps.s8),
        PlateText(session.ticketCode, size: 16),
        const SizedBox(height: AppGaps.s4),
        PlateText(session.licensePlate, size: 20),
        const SizedBox(height: AppGaps.s4),
        Text(
          'Khu ${session.zoneCode} · Vào ${session.checkInAt}',
          style: AppText.body,
        ),
        if (qr == null || qr.isEmpty) ...[
          const SizedBox(height: AppGaps.s8),
          const Text(
            'Chưa có khóa ký trên máy nên vé chưa có QR (vé vẫn hiệu lực). '
            'Nhập khóa ở màn Tôi → Khóa QR.',
            style: AppText.helper,
          ),
        ],
        const SizedBox(height: AppGaps.s16),
      ],
    );
  }
}

class ParkedBadge extends StatelessWidget {
  const ParkedBadge({super.key});

  @override
  Widget build(BuildContext context) => AppBadge.success('Đang đỗ');
}