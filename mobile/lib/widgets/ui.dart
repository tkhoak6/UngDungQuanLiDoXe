import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/tokens.dart';

/// Badge trạng thái — luôn có text (không màu-only), text darkened ≥4.5:1.
class AppBadge extends StatelessWidget {
  const AppBadge({
    super.key,
    required this.text,
    required this.color,
    required this.tint,
    this.textColor,
  });

  final String text;
  final Color color;
  final Color tint;
  final Color? textColor;

  factory AppBadge.success(String t) => AppBadge(
      text: t, color: AppColors.success, tint: AppColors.successTint,
      textColor: AppColors.successText);
  factory AppBadge.warning(String t) => AppBadge(
      text: t, color: AppColors.warning, tint: AppColors.warningTint,
      textColor: AppColors.warningText);
  factory AppBadge.danger(String t) =>
      AppBadge(text: t, color: AppColors.danger, tint: AppColors.dangerTint);
  factory AppBadge.info(String t) => AppBadge(
      text: t, color: AppColors.primary, tint: AppColors.primaryTint);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: tint,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        text,
        style: AppText.helper.copyWith(
          color: textColor ?? color,
          fontWeight: FontWeight.w600,
        ),
        semanticsLabel: text,
      ),
    );
  }
}

/// Biển số / mã / tiền — mono tabular.
class PlateText extends StatelessWidget {
  const PlateText(this.value,
      {super.key, this.size = 18, this.weight = FontWeight.w700});

  final String value;
  final double size;
  final FontWeight weight;

  @override
  Widget build(BuildContext context) {
    return Text(value.toUpperCase(),
        style: AppText.mono(size, weight: weight), softWrap: true);
  }
}

class MoneyText extends StatelessWidget {
  const MoneyText(this.amount, {super.key, this.size = 16});

  final int amount;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Text(vnd(amount), style: AppText.mono(size));
  }
}

/// CTA chính — min height 48 (check-in/check-out 52 theo spec).
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.danger = false,
    this.minHeight = 48,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final bool danger;
  final double minHeight;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        style: FilledButton.styleFrom(
          minimumSize: Size(48, minHeight),
          backgroundColor:
              danger ? AppColors.danger : AppColors.primary,
        ),
        onPressed: loading ? null : onPressed,
        child: loading
            ? SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Theme.of(context).colorScheme.onPrimary,
                ),
              )
            : Text(label),
      ),
    );
  }
}

class LoadingList extends StatelessWidget {
  const LoadingList({super.key, this.rows = 4});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: 'Đang tải',
      child: Column(
        children: List.generate(
          rows,
          (_) => const Padding(
            padding: EdgeInsets.only(bottom: AppGaps.s12),
            child: _SkeletonRow(),
          ),
        ),
      ),
    );
  }
}

class _SkeletonRow extends StatefulWidget {
  const _SkeletonRow();

  @override
  State<_SkeletonRow> createState() => _SkeletonRowState();
}

class _SkeletonRowState extends State<_SkeletonRow>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) => Opacity(
        opacity: 0.45 + 0.35 * _c.value,
        child: Container(
          height: 72,
          decoration: BoxDecoration(
            color: AppColors.text.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView(
      {super.key,
      required this.title,
      required this.hint,
      this.actionLabel,
      this.onAction});

  final String title;
  final String hint;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppGaps.s24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(title,
              style: AppText.cardTitle, textAlign: TextAlign.center),
          const SizedBox(height: AppGaps.s8),
          Text(hint, style: AppText.body, textAlign: TextAlign.center),
          if (actionLabel != null) ...[
            const SizedBox(height: AppGaps.s16),
            PrimaryButton(label: actionLabel!, onPressed: onAction),
          ],
        ],
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  const ErrorBanner(
      {super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppGaps.s12),
      padding: const EdgeInsets.all(AppGaps.s12),
      decoration: BoxDecoration(
        color: AppColors.dangerTint,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.danger),
      ),
      child: Row(
        children: [
          Expanded(child: Text(message, style: AppText.body)),
          const SizedBox(width: AppGaps.s8),
          SizedBox(
            height: 48,
            child: TextButton(
              onPressed: onRetry,
              child: const Text('Thử lại'),
            ),
          ),
        ],
      ),
    );
  }
}

class OfflineStrip extends StatelessWidget {
  const OfflineStrip({super.key, required this.queue, this.onSync});

  final int queue;
  final VoidCallback? onSync;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
          horizontal: AppGaps.s16, vertical: AppGaps.s8),
      color: AppColors.warningTint,
      child: Row(
        children: [
          const Icon(Icons.cloud_off, size: 20, color: AppColors.warningText),
          const SizedBox(width: AppGaps.s8),
          Expanded(
            child: Text(
              'Mất mạng — đã lưu local, sẽ đồng bộ ($queue)',
              style: AppText.helper
                  .copyWith(color: AppColors.warningText),
            ),
          ),
          if (onSync != null)
            TextButton(onPressed: onSync, child: const Text('Đồng bộ')),
        ],
      ),
    );
  }
}

void showAppSheet(BuildContext context, Widget child) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    constraints: const BoxConstraints(maxWidth: 640),
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: AppGaps.s16,
          right: AppGaps.s16,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + AppGaps.s16,
        ),
        child: child,
      ),
    ),
  );
}
