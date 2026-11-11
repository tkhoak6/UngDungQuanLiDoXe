import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/tokens.dart';

/// Bottom sheet quét QR check-out (spec §1.1B, §3).
///
/// Luồng quyền camera: dialog giải thích tiếng Việt (do app hiện, trước
/// system prompt) → system request → từ chối 1 lần: fallback nhập tay;
/// từ chối vĩnh viễn: nút Mở Cài đặt (deep-link), không loop xin quyền.
/// Quét trúng → haptic + đóng camera ngay, trả `rawValue` cho caller
/// verify (không hiện màn trung gian).
class QrScannerSheet extends StatefulWidget {
  const QrScannerSheet({super.key});

  @override
  State<QrScannerSheet> createState() => _QrScannerSheetState();
}

class _QrScannerSheetState extends State<QrScannerSheet> {
  final _controller = MobileScannerController(
    formats: [BarcodeFormat.qrCode],
    autoStart: false,
  );
  _CamState _state = _CamState.checking;
  bool _torch = false;
  bool _done = false;
  Timer? _timeout;

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  @override
  void dispose() {
    _timeout?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _prepare() async {
    if (kIsWeb) {
      setState(() => _state = _CamState.unsupported);
      return;
    }
    final status = await Permission.camera.status;
    if (status.isGranted || status.isLimited) {
      _start();
      return;
    }
    if (status.isPermanentlyDenied) {
      setState(() => _state = _CamState.blocked);
      return;
    }
    // Lần đầu / từ chối 1 lần: dialog giải thích của app trước (spec §3).
    if (!mounted) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cho phép camera?'),
        content: const Text(
          'Để quét mã QR lúc thu phí và đọc biển số. '
          'Ảnh biển số chỉ xử lý trên máy, không tải lên mạng.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Để sau'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Tiếp tục'),
          ),
        ],
      ),
    );
    if (go != true) {
      if (mounted) Navigator.of(context).pop();
      return;
    }
    final next = await Permission.camera.request();
    if (!mounted) return;
    if (next.isGranted || next.isLimited) {
      _start();
    } else if (next.isPermanentlyDenied) {
      setState(() => _state = _CamState.blocked);
    } else {
      // Từ chối 1 lần → đóng sheet, caller ở sẵn tab Nhập tay.
      Navigator.of(context).pop();
    }
  }

  void _start() {
    setState(() => _state = _CamState.scanning);
    unawaited(_controller.start());
    _timeout?.cancel();
    _timeout = Timer(const Duration(seconds: 30), () {
      if (mounted && !_done && _state == _CamState.scanning) {
        setState(() => _state = _CamState.slow);
      }
    });
  }

  void _onDetect(BarcodeCapture cap) {
    if (_done) return;
    final raw = cap.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;
    _done = true;
    HapticFeedback.lightImpact();
    unawaited(_controller.stop());
    if (mounted) Navigator.of(context).pop(raw);
  }

  Future<void> _toggleTorch() async {
    await _controller.toggleTorch();
    if (mounted) setState(() => _torch = !_torch);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppGaps.s16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Quét mã QR vé', style: AppText.cardTitle),
            const SizedBox(height: AppGaps.s8),
            _body(),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    switch (_state) {
      case _CamState.checking:
        return const Padding(
          padding: EdgeInsets.all(AppGaps.s24),
          child: Center(child: CircularProgressIndicator()),
        );
      case _CamState.unsupported:
        return _fallbackNote(
          'Quét QR cần chạy trên thiết bị thật. '
          'Nhập mã vé / biển số ở tab Nhập tay.',
        );
      case _CamState.blocked:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(AppGaps.s12),
              decoration: BoxDecoration(
                color: AppColors.warningTint,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.warning),
              ),
              child: const Text(
                'Camera đang tắt nên không quét được. Bạn vẫn nhập tay '
                'bình thường — hoặc bật camera trong Cài đặt.',
                style: AppText.body,
              ),
            ),
            const SizedBox(height: AppGaps.s12),
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: openAppSettings,
                icon: const Icon(Icons.settings_outlined),
                label: const Text('Mở Cài đặt'),
              ),
            ),
          ],
        );
      case _CamState.scanning:
      case _CamState.slow:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              label: 'Khung quét',
              image: true,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  height: 320,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      MobileScanner(
                        controller: _controller,
                        onDetect: _onDetect,
                      ),
                      // Khung ngắm 220×220 góc bo 12 (spec §1.1B.2).
                      Center(
                        child: Container(
                          width: 220,
                          height: 220,
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: AppColors.primary,
                              width: 2,
                            ),
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppGaps.s8),
            Text(
              _state == _CamState.slow
                  ? 'Lau camera, tăng sáng vé khách. Quá lâu? Nhập mã vé tay.'
                  : 'Đưa mã QR vào khung',
              style: AppText.helper,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: AppGaps.s8),
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: _toggleTorch,
                      icon: Icon(
                        _torch
                            ? Icons.flash_on
                            : Icons.flash_off_outlined,
                        semanticLabel: 'Đèn flash',
                      ),
                      label:
                          Text(_torch ? 'Tắt đèn' : 'Bật đèn'),
                    ),
                  ),
                ),
                const SizedBox(width: AppGaps.s8),
                Expanded(
                  child: SizedBox(
                    height: 48,
                    child: TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Nhập tay'),
                    ),
                  ),
                ),
              ],
            ),
          ],
        );
    }
  }

  Widget _fallbackNote(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppGaps.s12),
      child: Text(text, style: AppText.body),
    );
  }
}

enum _CamState { checking, scanning, slow, blocked, unsupported }
