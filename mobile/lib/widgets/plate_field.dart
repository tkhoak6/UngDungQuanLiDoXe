import 'package:flutter/material.dart';

import '../core/anpr.dart';
import '../core/tokens.dart';
import '../screens/anpr_sheet.dart';

/// Toast xác nhận sau khi điền biển quét được (spec §2.2.3).
void toastPlateFilled(BuildContext context, String norm) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('Đã điền ${Anpr.display(norm)} — kiểm tra lại.')),
  );
}

/// Ô Biển số dùng chung: nhập tay + nút camera ANPR 48dp + gợi ý fuzzy.
///
/// Gắn ở: check-in staff, đặt chỗ customer, đăng ký vé P3 (spec §2.1).
/// Quét xong: điền display-form, toast, focus vào field để user sửa ngay.
/// Gợi ý fuzzy ("Ý bạn là …?") chỉ gợi ý — KHÔNG tự sửa (spec §2.3).
/// Hủy/từ chối/lỗi → giữ nhập tay, không kẹt.
class PlateField extends StatefulWidget {
  const PlateField({
    super.key,
    required this.controller,
    this.labelText = 'Biển số (VD 51H-12345)',
    this.hintText,
    this.helperText,
    this.textInputAction,
    this.onChanged,
  });

  final TextEditingController controller;
  final String labelText;
  final String? hintText;
  final String? helperText;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onChanged;

  @override
  State<PlateField> createState() => _PlateFieldState();
}

class _PlateFieldState extends State<PlateField> {
  final _focus = FocusNode();
  String? _filledNorm;
  bool _scheduled = false;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onText);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onText);
    _focus.dispose();
    super.dispose();
  }

  /// Vẽ lại gợi ý fuzzy theo từng ký tự. Luôn hoãn qua post-frame để
  /// không `setState` giữa build (prefill trong FutureBuilder builder).
  void _onText() {
    if (!mounted || _scheduled) return;
    _scheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scheduled = false;
      if (mounted) setState(() {});
    });
  }

  Future<void> _scan() async {
    final norm = await openAnprSheet(context);
    if (norm == null || norm.isEmpty || !mounted) return;
    widget.controller.text = Anpr.display(norm);
    setState(() => _filledNorm = norm);
    if (mounted) {
      toastPlateFilled(context, norm);
      _focus.requestFocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = widget.controller.text;
    final showCheck = _filledNorm != null &&
        Anpr.normalize(text) == _filledNorm &&
        text.isNotEmpty;
    final sug = Anpr.suggest(text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          controller: widget.controller,
          focusNode: _focus,
          textCapitalization: TextCapitalization.characters,
          style: AppText.mono(18),
          textInputAction: widget.textInputAction,
          onChanged: widget.onChanged,
          decoration: InputDecoration(
            labelText: widget.labelText,
            hintText: widget.hintText,
            helperText: widget.helperText,
            suffixIcon: SizedBox(
              width: 48,
              height: 48,
              child: IconButton(
                tooltip: 'Quét biển số',
                onPressed: _scan,
                icon: const Icon(
                  Icons.photo_camera_outlined,
                  semanticLabel: 'Quét biển số',
                ),
              ),
            ),
          ),
        ),
        if (showCheck) ...[
          const SizedBox(height: AppGaps.s4),
          const Text(
            'Kiểm tra lại biển số trước khi tiếp tục.',
            style: AppText.helper,
          ),
        ],
        if (sug != null)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () => widget.controller.text = Anpr.display(sug),
              child: Text('Ý bạn là ${Anpr.display(sug)}?'),
            ),
          ),
      ],
    );
  }
}
