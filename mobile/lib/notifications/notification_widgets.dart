/// MO-015 — UI xin quyền + fallback (spec §5): rationale sheet (VN),
/// hướng dẫn Settings khi denied, fallback banner persistent, toggle trạng
/// thái trong Cá nhân/Tôi. A11y: role dialog/status/switch, Esc đóng.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/tokens.dart';
import '../state/providers.dart';
import '../widgets/ui.dart';
import 'notification_config.dart';
import 'notification_content.dart';
import 'notification_logic.dart';
import 'notification_scheduler.dart';
import 'notification_service.dart';

/// Hiện rationale VN sau hành động liên quan đầu tiên (spec §5.1).
/// Tối đa 2 lần — lần 3 im luôn. Trả về true nếu user vừa grant.
Future<bool> maybeShowRationale(
  BuildContext context,
  WidgetRef ref, {
  String? fromAction,
}) async {
  final prefs = await SharedPreferences.getInstance();
  final count = prefs.getInt(NotifConfig.rationaleCount) ?? 0;
  if (!shouldShowRationale(count)) return false;
  final svc = NotificationService.instance;
  if (await svc.areEnabled()) return true; // đã bật → không hỏi.
  await prefs.setInt(NotifConfig.rationaleCount, count + 1);
  await prefs.setInt(
    NotifConfig.rationaleLastAt,
    DateTime.now().millisecondsSinceEpoch,
  );
  if (!context.mounted) return false;
  final granted = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    constraints: const BoxConstraints(maxWidth: 640),
    builder: (ctx) => const _RationaleSheet(),
  );
  if (granted == true && context.mounted) {
    final ok = await svc.requestPermission();
    if (ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text(PermissionRationaleCopy.grantedOk)),
      );
      // Ping test: quét bù E1/E2 hiện có ngay (spec §5.1 bước 3).
      await pingSweepAfterGrant(ref);
    } else if (context.mounted) {
      await showDeniedGuide(context);
    }
    return ok;
  }
  return false;
}

/// Chạy quét bù sau grant — cần session hiện tại.
Future<void> pingSweepAfterGrant(WidgetRef ref) async {
  final session = ref.read(sessionProvider);
  if (session == null) return;
  try {
    await NotificationScheduler.runLaunchSweep(
      customerRepo: ref.read(customerRepoProvider),
      staffRepo: ref.read(staffRepoProvider),
      userId: session.id,
      ownerPhone: session.phone ?? session.username,
    );
  } catch (_) {
    // Quét bù thất bại → bỏ qua, daily sweep + lần mở app sau bù tiếp.
  }
}

class _RationaleSheet extends StatelessWidget {
  const _RationaleSheet();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: PermissionRationaleCopy.title,
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            left: AppGaps.s16,
            right: AppGaps.s16,
            bottom:
                MediaQuery.of(context).viewInsets.bottom + AppGaps.s16,
          ),
          child: FocusTraversalGroup(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  PermissionRationaleCopy.title,
                  style: AppText.cardTitle,
                ),
                const SizedBox(height: AppGaps.s12),
                ...PermissionRationaleCopy.bullets.map((b) => Padding(
                      padding:
                          const EdgeInsets.only(bottom: AppGaps.s4),
                      child: Row(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          const Text('• ',
                              style: AppText.body),
                          Expanded(
                              child: Text(b,
                                  style: AppText.body)),
                        ],
                      ),
                    )),
                const SizedBox(height: AppGaps.s8),
                const Text(
                  PermissionRationaleCopy.note,
                  style: AppText.helper,
                ),
                const SizedBox(height: AppGaps.s16),
                PrimaryButton(
                  label: PermissionRationaleCopy.allow,
                  onPressed: () =>
                      Navigator.of(context).pop(true),
                ),
                const SizedBox(height: AppGaps.s8),
                SizedBox(
                  height: 48,
                  child: TextButton(
                    onPressed: () =>
                        Navigator.of(context).pop(false),
                    child: const Text(
                        PermissionRationaleCopy.later),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Hướng dẫn mở Cài đặt khi denied (spec §5.2) + nút Mở cài đặt.
Future<void> showDeniedGuide(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    constraints: const BoxConstraints(maxWidth: 640),
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: AppGaps.s16,
          right: AppGaps.s16,
          bottom:
              MediaQuery.of(ctx).viewInsets.bottom + AppGaps.s16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              PermissionDeniedCopy.title,
              style: AppText.cardTitle,
            ),
            const SizedBox(height: AppGaps.s8),
            Text(
              PermissionDeniedCopy.androidSteps,
              style: AppText.mono(13),
            ),
            const SizedBox(height: AppGaps.s16),
            PrimaryButton(
              label: PermissionDeniedCopy.openSettings,
              onPressed: () async {
                Navigator.of(ctx).pop();
                await NotificationService.instance.openSettings();
              },
            ),
            const SizedBox(height: AppGaps.s8),
            SizedBox(
              height: 48,
              child: TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child:
                    const Text(PermissionDeniedCopy.close),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Fallback banner persistent khi permission denied (spec §5.2):
/// Warning strip + nút Hướng dẫn bật + Đóng (nhớ 7 ngày). role=status.
class NotifFallbackBanner extends ConsumerStatefulWidget {
  const NotifFallbackBanner({super.key, required this.message});

  final String message;

  @override
  ConsumerState<NotifFallbackBanner> createState() =>
      _NotifFallbackBannerState();
}

class _NotifFallbackBannerState
    extends ConsumerState<NotifFallbackBanner> {
  bool _denied = false;
  bool _dismissed = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    final prefs = await SharedPreferences.getInstance();
    final status =
        await NotificationService.instance.permissionStatus();
    final denied = status.isDenied || status.isPermanentlyDenied;
    final dismissedAt =
        prefs.getInt(NotifConfig.fallbackDismissedAt);
    final show = shouldShowFallbackBanner(
      denied: denied,
      dismissedAtMs: dismissedAt,
      now: DateTime.now(),
    );
    if (mounted) {
      setState(() {
        _denied = denied;
        _dismissed = !show;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || !_denied || _dismissed) {
      return const SizedBox.shrink();
    }
    return Semantics(
      liveRegion: true,
      label: widget.message,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: AppGaps.s12),
        padding: const EdgeInsets.all(AppGaps.s12),
        decoration: BoxDecoration(
          color: AppColors.warningTint,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.warning),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.message,
              style: AppText.helper.copyWith(
                color: AppColors.warningText,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: AppGaps.s8),
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 44,
                    child: OutlinedButton(
                      onPressed: () =>
                          showDeniedGuide(context),
                      child: const Text('Hướng dẫn bật'),
                    ),
                  ),
                ),
                const SizedBox(width: AppGaps.s8),
                SizedBox(
                  height: 44,
                  child: TextButton(
                    onPressed: () async {
                      final prefs =
                          await SharedPreferences.getInstance();
                      await prefs.setInt(
                        NotifConfig.fallbackDismissedAt,
                        DateTime.now().millisecondsSinceEpoch,
                      );
                      if (mounted) {
                        setState(() => _dismissed = true);
                      }
                    },
                    child: const Text('Đóng'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Toggle trạng thái Thông báo trong Cá nhân/Tôi (spec §5.2):
/// switch + nút Mở cài đặt. A11y role=switch.
class NotifStatusTile extends ConsumerStatefulWidget {
  const NotifStatusTile({super.key});

  @override
  ConsumerState<NotifStatusTile> createState() =>
      _NotifStatusTileState();
}

class _NotifStatusTileState extends ConsumerState<NotifStatusTile> {
  bool _enabled = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final on = await NotificationService.instance.areEnabled();
    if (mounted) {
      setState(() {
        _enabled = on;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppGaps.s12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Thông báo'),
              subtitle: Text(
                _loading
                    ? 'Đang kiểm tra…'
                    : (_enabled ? 'Đang bật' : 'Đang tắt'),
                style: AppText.helper,
              ),
              value: _enabled,
              onChanged: (_) async {
                if (_enabled) {
                  await NotificationService.instance
                      .openSettings();
                  if (mounted) _refresh();
                } else {
                  final ok = await NotificationService.instance
                      .requestPermission();
                  if (context.mounted) {
                    setState(() => _enabled = ok);
                    if (!ok) {
                      await showDeniedGuide(context);
                    }
                  }
                }
              },
            ),
            SizedBox(
              height: 44,
              child: OutlinedButton(
                onPressed: () async {
                  await NotificationService.instance
                      .openSettings();
                  if (mounted) _refresh();
                },
                child: const Text('Mở cài đặt'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Toast E3 staff 1 lần/phiên/zone + cooldown 15p (spec §3.4).
/// Gọi sau khi phát hiện zone vừa đầy; trả về true nếu đã hiện toast.
Future<bool> maybeToastZoneFull(
  BuildContext context, {
  required String zoneCode,
  String? suggestZone,
}) async {
  final prefs = await SharedPreferences.getInstance();
  final last = <String, int>{};
  for (final k in prefs.getKeys()) {
    const prefix = 'notif.fulltoast.';
    if (k.startsWith(prefix)) {
      last[k.substring(prefix.length)] = prefs.getInt(k) ?? 0;
    }
  }
  if (!shouldShowFullToast(
    zoneCode: zoneCode,
    now: DateTime.now(),
    lastShownMsByZone: last,
  )) {
    return false;
  }
  await prefs.setInt(NotifConfig.fullToastKey(zoneCode),
      DateTime.now().millisecondsSinceEpoch);
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(e3StaffToast(
            zoneCode: zoneCode, suggestZone: suggestZone)),
      ),
    );
  }
  return true;
}
