import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/anpr.dart';
import '../core/tokens.dart';
import '../data/anpr_recognizer.dart';
import '../widgets/ui.dart';

/// Mở sheet quét biển số ANPR (spec §2.2). Trả biển **chuẩn hóa**
/// ([Anpr.normalize]) khi user xác nhận, hoặc null khi hủy / từ chối
/// quyền / lỗi (caller giữ nhập tay — không kẹt).
Future<String?> openAnprSheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    constraints: const BoxConstraints(maxWidth: 640),
    builder: (_) => const FractionallySizedBox(
      heightFactor: 0.9,
      child: AnprSheet(),
    ),
  );
}

enum _Phase {
  checking,
  blocked,
  unsupported,
  nocam,
  ready,
  processing,
  confirm,
  pick,
}

/// Bottom sheet camera ANPR: viewfinder + khung overlay 3:1 + [Chụp] thủ
/// công (V1, không auto-capture) → nhận diện on-device → confirm/sửa tay
/// hoặc chọn khi nhiều ứng viên → trả biển chuẩn hóa cho caller điền form.
///
/// Ảnh chụp là file tạm, **xóa trong `finally`** sau nhận diện (spec §2.2.5).
/// Không gửi ảnh lên mạng, không log ảnh.
class AnprSheet extends StatefulWidget {
  const AnprSheet({super.key});

  @override
  State<AnprSheet> createState() => _AnprSheetState();
}

class _AnprSheetState extends State<AnprSheet> {
  CameraController? _cam;
  AnprRecognizer? _rec;
  _Phase _phase = _Phase.checking;
  bool _torch = false;
  String? _warn;
  // MO-017: OCR thô khi có chữ nhưng không khớp biển số — hiện cho user
  // sửa/dùng thay vì rớt về "Chưa đọc được" chung chung.
  String? _rawOcr;
  List<String> _candidates = const [];
  String? _picked;
  final _edit = TextEditingController();

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  @override
  void dispose() {
    unawaited(_cam?.dispose());
    unawaited(_rec?.close());
    _edit.dispose();
    super.dispose();
  }

  /// Luồng quyền camera (spec §3): dialog giải thích của app trước →
  /// system request → từ chối 1 lần: đóng sheet (caller ở sẵn nhập tay);
  /// từ chối vĩnh viễn: nút Mở Cài đặt, không loop xin quyền.
  Future<void> _prepare() async {
    if (kIsWeb) {
      setState(() => _phase = _Phase.unsupported);
      return;
    }
    final status = await Permission.camera.status;
    if (status.isGranted || status.isLimited) {
      await _openCamera();
      return;
    }
    if (status.isPermanentlyDenied) {
      setState(() => _phase = _Phase.blocked);
      return;
    }
    if (!mounted) return;
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cho phép camera?'),
        content: const Text(
          'Để đọc biển số tự động. '
          'Ảnh chỉ xử lý trên máy, không tải lên mạng.',
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
      await _openCamera();
    } else if (next.isPermanentlyDenied) {
      setState(() => _phase = _Phase.blocked);
    } else {
      Navigator.of(context).pop();
    }
  }

  Future<void> _openCamera() async {
    try {
      final cams = await availableCameras();
      if (cams.isEmpty) {
        if (mounted) setState(() => _phase = _Phase.nocam);
        return;
      }
      final back =
          cams.where((c) => c.lensDirection == CameraLensDirection.back);
      final desc = back.isNotEmpty ? back.first : cams.first;
      final cam = CameraController(
        desc,
        ResolutionPreset.medium,
        enableAudio: false,
      );
      await cam.initialize();
      if (!mounted) {
        await cam.dispose();
        return;
      }
      _rec ??= MlKitAnprRecognizer();
      setState(() {
        _cam = cam;
        _phase = _Phase.ready;
      });
    } catch (_) {
      if (mounted) setState(() => _phase = _Phase.nocam);
    }
  }

  Future<void> _toggleTorch() async {
    final cam = _cam;
    if (cam == null) return;
    try {
      await cam.setFlashMode(_torch ? FlashMode.off : FlashMode.torch);
      if (mounted) setState(() => _torch = !_torch);
    } catch (_) {
      // Máy không có flash — bỏ qua, giữ camera chạy.
    }
  }

  /// Chụp thủ công (V1) → ML Kit on-device, timeout 8s → phân nhánh
  /// MO-017 (mỗi nguyên nhân 1 message + hành động riêng):
  /// - engine/timeout: ở lại camera + warning + nút chính thành "Thử lại".
  /// - empty: gợi ý đủ sáng/gần/chắc (+ bật flash nếu đang tắt).
  /// - unmatched (có chữ, không khớp biển): sang màn confirm với text gốc
  ///   để user sửa/dùng — không rớt về "Chưa đọc được" chung chung.
  /// - 1 ứng viên: confirm/sửa; nhiều: sheet chọn.
  Future<void> _capture() async {
    final cam = _cam;
    if (cam == null || !cam.value.isInitialized || _phase != _Phase.ready) {
      return;
    }
    setState(() {
      _phase = _Phase.processing;
      _warn = null;
      _rawOcr = null;
    });
    String? path;
    try {
      final shot = await cam.takePicture();
      path = shot.path;
      final rec = _rec;
      if (rec == null) throw StateError('recognizer chưa sẵn sàng');
      final text = await rec.recognize(path).timeout(
            const Duration(seconds: 8),
          );
      final kind = Anpr.classify(text: text);
      if (!mounted) return;
      if (kind == AnprFailureKind.empty) {
        setState(() {
          _phase = _Phase.ready;
          _warn = Anpr.hintFor(kind, torchOn: _torch);
        });
        return;
      }
      final cands = Anpr.extractCandidates(text);
      if (!mounted) return;
      if (cands.isEmpty) {
        // Có chữ nhưng không khớp biển VN (VD nhòe 1 ký tự, biển 2 dòng
        // đọc thiếu) — cho user sửa/dùng, giữ text gốc để đối chiếu.
        _rawOcr = text;
        _edit.text = Anpr.display(Anpr.bestEffort(text));
        setState(() {
          _candidates = const [];
          _phase = _Phase.confirm;
        });
      } else if (cands.length == 1) {
        _rawOcr = null;
        _edit.text = Anpr.display(cands.single);
        setState(() {
          _candidates = cands;
          _phase = _Phase.confirm;
        });
      } else {
        _rawOcr = null;
        setState(() {
          _candidates = cands;
          _picked = cands.first;
          _phase = _Phase.pick;
        });
      }
    } on TimeoutException {
      if (mounted) {
        setState(() {
          _phase = _Phase.ready;
          _warn = Anpr.hintFor(AnprFailureKind.timeout);
        });
      }
    } on AnprEngineException {
      // Engine lỗi (khởi tạo lạnh/model/native) — khác "ảnh xấu".
      if (mounted) {
        setState(() {
          _phase = _Phase.ready;
          _warn = Anpr.hintFor(AnprFailureKind.engine);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _phase = _Phase.ready;
          _warn = Anpr.hintFor(AnprFailureKind.engine);
        });
      }
    } finally {
      // Xóa file tạm ngay sau nhận diện (spec §2.2.5).
      if (path != null) {
        try {
          await File(path).delete();
        } catch (_) {}
      }
    }
  }

  void _submitConfirm() {
    final norm = Anpr.normalize(_edit.text);
    if (norm.isEmpty) {
      setState(() => _warn = 'Nhập biển số rồi bấm Điền vào form.');
      return;
    }
    HapticFeedback.lightImpact();
    Navigator.of(context).pop(norm);
  }

  void _submitPick() {
    final picked = _picked;
    if (picked == null) return;
    HapticFeedback.lightImpact();
    Navigator.of(context).pop(picked);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppGaps.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Quét biển số', style: AppText.cardTitle),
            const SizedBox(height: AppGaps.s4),
            const Text(
              'Ảnh chỉ xử lý trên máy, xóa ngay sau khi đọc.',
              style: AppText.helper,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: AppGaps.s8),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    switch (_phase) {
      case _Phase.checking:
        return const Center(child: CircularProgressIndicator());
      case _Phase.unsupported:
        return _note(
          'Quét biển số cần chạy trên thiết bị thật. Nhập biển số tay.',
        );
      case _Phase.nocam:
        return _note(
          'Không mở được camera — nhập biển số tay bình thường.',
        );
      case _Phase.blocked:
        return _blocked();
      case _Phase.ready:
      case _Phase.processing:
        return _camera();
      case _Phase.confirm:
        return _confirm();
      case _Phase.pick:
        return _pick();
    }
  }

  Widget _note(String text) {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(text, style: AppText.body),
          const SizedBox(height: AppGaps.s16),
          SizedBox(
            height: 48,
            child: OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Nhập tay'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _blocked() {
    return SingleChildScrollView(
      child: Column(
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
          const SizedBox(height: AppGaps.s8),
          SizedBox(
            height: 48,
            child: TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Nhập tay'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _camera() {
    final cam = _cam;
    final processing = _phase == _Phase.processing;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label: 'Khung quét biển số',
          image: true,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              height: 280,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (cam != null && cam.value.isInitialized)
                    CameraPreview(cam)
                  else
                    const Center(child: CircularProgressIndicator()),
                  // Khung overlay tỷ lệ biển VN ~3:1 (spec §2.2.2).
                  Center(
                    child: Container(
                      width: 260,
                      height: 87,
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: AppColors.primary,
                          width: 2,
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                  ),
                  if (processing)
                    Container(
                      color: AppColors.text.withValues(alpha: 0.35),
                      child: const Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator(
                              color: AppColors.surface,
                            ),
                            SizedBox(height: AppGaps.s8),
                            Text(
                              'Đang đọc biển số…',
                              style: TextStyle(color: AppColors.surface),
                            ),
                          ],
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
          _warn ?? 'Đặt biển số vào khung',
          style: _warn == null
              ? AppText.helper
              : AppText.helper.copyWith(color: AppColors.warningText),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        const Spacer(),
        Row(
          children: [
            SizedBox(
              width: 48,
              height: 48,
              child: IconButton(
                tooltip: 'Đèn flash',
                onPressed: processing ? null : _toggleTorch,
                icon: Icon(
                  _torch ? Icons.flash_on : Icons.flash_off_outlined,
                  semanticLabel: 'Đèn flash',
                ),
              ),
            ),
            const SizedBox(width: AppGaps.s8),
            Expanded(
              child: PrimaryButton(
                // MO-017: sau thất bại, nút chính thành "Thử lại".
                label: processing
                    ? 'Đang đọc…'
                    : (_warn == null ? 'Chụp' : 'Thử lại'),
                loading: processing,
                minHeight: 56,
                onPressed: processing ? null : _capture,
              ),
            ),
            const SizedBox(width: AppGaps.s8),
            SizedBox(
              width: 48,
              height: 48,
              child: IconButton(
                tooltip: 'Đóng',
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close, semanticLabel: 'Đóng'),
              ),
            ),
          ],
        ),
        SizedBox(
          height: 48,
          child: TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Nhập tay'),
          ),
        ),
      ],
    );
  }

  /// 1 ứng viên: user sửa tay + gợi ý fuzzy rồi mới điền (spec §2.2.3-4).
  /// MO-017: nhánh unmatched (có chữ, không khớp biển) tái dùng màn này —
  /// thêm dòng "Máy đọc được …" + field prefill best-effort để sửa/dùng.
  Widget _confirm() {
    final raw = _rawOcr;
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Kiểm tra lại biển số trước khi tiếp tục.',
            style: AppText.body,
          ),
          if (raw != null && raw.trim().isNotEmpty) ...[
            const SizedBox(height: AppGaps.s8),
            Container(
              padding: const EdgeInsets.all(AppGaps.s12),
              decoration: BoxDecoration(
                color: AppColors.warningTint,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.warning),
              ),
              child: Text(
                'Máy đọc được: «${Anpr.ocrSnippet(raw)}» — '
                'chưa khớp biển số. Sửa lại rồi bấm Điền vào form.',
                style: AppText.body,
              ),
            ),
          ],
          const SizedBox(height: AppGaps.s12),
          ListenableBuilder(
            listenable: _edit,
            builder: (context, _) {
              final liveSug = Anpr.suggest(_edit.text);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: _edit,
                    textCapitalization: TextCapitalization.characters,
                    style: AppText.mono(18),
                    decoration: const InputDecoration(
                      labelText: 'Biển số đọc được',
                    ),
                  ),
                  if (liveSug != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton(
                        onPressed: () =>
                            _edit.text = Anpr.display(liveSug),
                        child: Text(
                          'Ý bạn là ${Anpr.display(liveSug)}?',
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
          if (_warn != null) ...[
            const SizedBox(height: AppGaps.s4),
            Text(
              _warn!,
              style: AppText.helper.copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: AppGaps.s12),
          PrimaryButton(
            label: 'Điền vào form',
            minHeight: 56,
            onPressed: _submitConfirm,
          ),
          const SizedBox(height: AppGaps.s8),
          SizedBox(
            height: 48,
            child: OutlinedButton(
              onPressed: () => setState(() {
                _phase = _Phase.ready;
                _warn = null;
                _rawOcr = null;
              }),
              child: const Text('Chụp lại'),
            ),
          ),
        ],
      ),
    );
  }

  /// Nhiều ứng viên: radio list chọn (mỗi dòng mono 18 — spec §2.2.3).
  Widget _pick() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Chọn biển số đúng.', style: AppText.body),
        const SizedBox(height: AppGaps.s8),
        Expanded(
          child: ListView(
            children: [
              RadioGroup<String>(
                groupValue: _picked,
                onChanged: (v) => setState(() => _picked = v),
                child: Column(
                  children: _candidates
                      .map(
                        (c) => RadioListTile<String>(
                          value: c,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            Anpr.display(c),
                            style: AppText.mono(
                              18,
                              weight: FontWeight.w700,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
              ),
            ],
          ),
        ),
        PrimaryButton(
          label: 'Điền vào form',
          minHeight: 56,
          onPressed: _submitPick,
        ),
        const SizedBox(height: AppGaps.s8),
        SizedBox(
          height: 48,
          child: OutlinedButton(
            onPressed: () => setState(() {
              _phase = _Phase.ready;
              _warn = null;
              _rawOcr = null;
            }),
            child: const Text('Chụp lại'),
          ),
        ),
      ],
    );
  }
}
