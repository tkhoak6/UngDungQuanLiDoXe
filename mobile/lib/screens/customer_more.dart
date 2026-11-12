import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/format.dart';
import '../core/retained_future.dart';
import '../core/tokens.dart';
import '../models/entities.dart';
import '../notifications/notifications.dart';
import '../repos/parking_repo.dart';
import '../state/providers.dart';
import '../state/session_actions.dart';
import '../widgets/plate_field.dart';
import '../widgets/qr_views.dart';
import '../widgets/ui.dart';

/// Vé tháng (P3 xếp dọc): Section A vé đang dùng + Section B vé của tôi.
/// MO-015 E1: [highlightCode] từ deep-link → viền + badge pulse 1 lần.
class PassesScreen extends ConsumerStatefulWidget {
  const PassesScreen({super.key, this.highlightCode});

  final String? highlightCode;

  @override
  ConsumerState<PassesScreen> createState() => _PassesScreenState();
}

class _PassesScreenState extends ConsumerState<PassesScreen> {
  final _plate = TextEditingController();
  int? _zoneId;
  int _months = 1;
  bool _saving = false;
  String? _err;
  // MO-013: giữ Future qua rebuild — ô biển số nằm trong FutureBuilder, tạo
  // future mới mỗi build + setState (đổi khu/gói) = ô nhập bị remount.
  final _passesRet = RetainedFuture<List<PassRow>>();
  final _parkedRet = RetainedFuture<List<SessionRow>>();
  // MO-013: dropdown khu là sibling của ô biển số — giữ future để setState
  // (gõ biển số, đổi gói) không làm dropdown nháy về rỗng.
  final _zonesRet = RetainedFuture<List<ParkingZone>>();

  /// Tải lại vé (retry, sau khi gửi đăng ký). Giữ value cũ lúc chờ.
  void _refreshPasses() {
    if (!mounted) return;
    final me = ref.read(sessionProvider);
    if (me == null) return;
    final repo = ref.read(customerRepoProvider);
    final zonesRepo = ref.read(parkingRepoProvider);
    final key = me.phone ?? me.username;
    setState(() {
      _passesRet.refresh(() => repo.myPasses(key));
      _parkedRet.refresh(() => repo.myParkedSessions(key));
      _zonesRet.refresh(() => zonesRepo.zones());
    });
  }

  @override
  void dispose() {
    _plate.dispose();
    super.dispose();
  }

  Future<void> _submit(AppUser me) async {
    setState(() {
      _saving = true;
      _err = null;
    });
    try {
      await ref.read(customerRepoProvider).requestPass(
            plate: _plate.text,
            vehicleType: 'car',
            zoneId: _zoneId,
            months: _months,
            userId: me.id,
            customerName: me.fullName,
            customerPhone: me.phone ?? me.username,
          );
      _plate.clear();
      if (mounted) {
        _refreshPasses();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                'Đã gửi đăng ký — mang tiền ra quầy để kích hoạt.'),
          ),
        );
        // MO-015: rationale xin quyền sau hành động liên quan đầu tiên.
        await maybeShowRationale(context, ref);
      }
    } on RepoException catch (e) {
      setState(() => _err = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Đăng nhập để xem vé.'));
    }
    final repo = ref.watch(customerRepoProvider);
    final zonesRepo = ref.watch(parkingRepoProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Vé', style: AppText.appBar),
        // MO-018: đăng xuất ngay từ màn chính (thu hồi remember token).
        actions: [
          IconButton(
            tooltip: 'Đăng xuất',
            onPressed: () {
              signOut(ref);
              context.go('/map');
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: FutureBuilder<List<PassRow>>(
        // MO-013: future giữ qua rebuild — setState (đổi khu/gói/retry)
        // không tạo future mới, ô biển số không bị remount/mất focus.
        future: _passesRet.of(
            me.phone ?? me.username,
            () => repo.myPasses(me.phone ?? me.username)),
        builder: (context, snap) {
          // Fetch lại thì vẽ tiếp dữ liệu cũ trong lúc chờ.
          final passes = snap.data ?? _passesRet.value;
          if (passes == null) {
            if (snap.hasError) {
              return Padding(
                padding: const EdgeInsets.all(AppGaps.s16),
                child: ErrorBanner(
                  message: 'Không tải được vé.',
                  onRetry: _refreshPasses,
                ),
              );
            }
            return const Padding(
              padding: EdgeInsets.all(AppGaps.s16),
              child: LoadingList(),
            );
          }
          final warn = passes.any((p) =>
              p.status == 'pending' || _expiringSoon(p.endDate));
          return ListView(
            padding: const EdgeInsets.all(AppGaps.s16),
            children: [
              // MO-015 §5.2: fallback khi user tắt thông báo.
              const NotifFallbackBanner(
                message:
                    'Thông báo đang tắt — có thể lỡ nhắc vé sắp hết hạn.',
              ),
              const Text('Vé đang dùng', style: AppText.cardTitle),
              const SizedBox(height: AppGaps.s12),
              FutureBuilder<List<SessionRow>>(
                future: _parkedRet.of(me.phone ?? me.username,
                    () => repo.myParkedSessions(me.phone ?? me.username)),
                builder: (context, parkSnap) {
                  final parked =
                      parkSnap.data ?? _parkedRet.value ?? <SessionRow>[];
                  if (parkSnap.connectionState ==
                          ConnectionState.waiting &&
                      parkSnap.data == null &&
                      _parkedRet.value == null) {
                    return const LoadingList(rows: 1);
                  }
                  if (parkSnap.hasError && parked.isEmpty) {
                    return ErrorBanner(
                      message: 'Không tải được vé đang dùng.',
                      onRetry: _refreshPasses,
                    );
                  }
                  if (parked.isEmpty) {
                    return const Text(
                      'Không có xe nào đang đỗ.',
                      style: AppText.helper,
                    );
                  }
                  return Column(
                    children: parked
                        .map((s) => Padding(
                              padding: const EdgeInsets.only(
                                  bottom: AppGaps.s8),
                              child: ParkedTicketCard(
                                session: s,
                                onExpand: () => showAppSheet(
                                  context,
                                  TicketQrSheet(session: s),
                                ),
                              ),
                            ))
                        .toList(),
                  );
                },
              ),
              const SizedBox(height: AppGaps.s24),
              const Text('Vé của tôi', style: AppText.cardTitle),
              const SizedBox(height: AppGaps.s12),
              if (passes.isEmpty)
                const EmptyView(
                  title: 'Chưa có vé tháng nào',
                  hint:
                      'Đăng ký ở dưới — không thanh toán online, trả tiền tại quầy khi nhận vé.',
                )
              else
                ...passes.map((p) {
                  final focused =
                      p.passCode == widget.highlightCode;
                  final tile = ListTile(
                    minVerticalPadding: AppGaps.s12,
                    title: PlateText(p.passCode, size: 14),
                    subtitle: Text(
                        '${p.licensePlate} · ${p.zoneCode}\n${p.startDate} → ${p.endDate} · ${vnd(p.price)}'),
                    isThreeLine: true,
                    trailing: focused
                        ? _PulseBadge(child: _passBadge(p.status))
                        : _passBadge(p.status),
                  );
                  if (!focused) return Card(child: tile);
                  // MO-015 E1: highlight row từ deep-link.
                  return Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: AppColors.primary, width: 2),
                    ),
                    child: Card(margin: EdgeInsets.zero, child: tile),
                  );
                }),
              if (warn) ...[
                const SizedBox(height: AppGaps.s8),
                const Text(
                  'Vé sắp hết hạn (≤7 ngày) hoặc đang chờ xác nhận.',
                  style: AppText.helper,
                ),
              ],
              const SizedBox(height: AppGaps.s24),
              const Text('Đăng ký vé mới',
                  style: AppText.cardTitle),
              const SizedBox(height: AppGaps.s12),
              PlateField(
                controller: _plate,
                labelText: 'Biển số (VD 51H-12345)',
              ),
              const SizedBox(height: AppGaps.s12),
              FutureBuilder<List<ParkingZone>>(
                future: _zonesRet.of('zones', () => zonesRepo.zones()),
                builder: (context, zSnap) {
                  final zones =
                      zSnap.data ?? _zonesRet.value ?? <ParkingZone>[];
                  return DropdownButtonFormField<int>(
                    key: ValueKey(_zoneId),
                    initialValue: _zoneId,
                    decoration: const InputDecoration(
                        labelText: 'Khu'),
                    items: zones
                        .map((z) => DropdownMenuItem<int>(
                              value: z.id,
                              child: Text(
                                  '${z.code} · ${z.name}'),
                            ))
                        .toList(),
                    onChanged: (v) =>
                        setState(() => _zoneId = v),
                  );
                },
              ),
              const SizedBox(height: AppGaps.s12),
              const Text('Gói', style: AppText.body),
              RadioGroup<int>(
                groupValue: _months,
                onChanged: (v) =>
                    setState(() => _months = v ?? _months),
                child: Column(
                  children: [1, 3, 6, 12]
                      .map((m) => RadioListTile<int>(
                            value: m,
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                                '$m tháng${m == 12 ? ' · -10%' : ''}'),
                          ))
                      .toList(),
                ),
              ),
              if (_err != null)
                Text(_err!,
                    style: AppText.helper.copyWith(
                        color: AppColors.danger)),
              const SizedBox(height: AppGaps.s12),
              PrimaryButton(
                label: _saving ? 'Đang gửi…' : 'Gửi đăng ký',
                loading: _saving,
                onPressed: () => _submit(me),
              ),
              const SizedBox(height: AppGaps.s8),
              const Text(
                'Không thanh toán online — trả tiền mặt/chuyển khoản tại quầy.',
                style: AppText.helper,
              ),
            ],
          );
        },
      ),
    );
  }

  bool _expiringSoon(String endDate) {
    try {
      final end = DateTime.parse(endDate);
      final diff = end.difference(DateTime.now()).inDays;
      return diff >= 0 && diff <= 7;
    } catch (_) {
      return false;
    }
  }

  Widget _passBadge(String s) {
    switch (s) {
      case 'active':
        return AppBadge.success('Còn hiệu lực');
      case 'pending':
        return AppBadge.warning('Chờ xác nhận');
      case 'expired':
        return AppBadge.danger('Hết hạn');
      default:
        return AppBadge.warning(s);
    }
  }
}

/// MO-015 E1: badge pulse 1 lần khi mở từ deep-link.
/// Tôn `disableAnimations` (reduced motion).
class _PulseBadge extends StatefulWidget {
  const _PulseBadge({required this.child});

  final Widget child;

  @override
  State<_PulseBadge> createState() => _PulseBadgeState();
}

class _PulseBadgeState extends State<_PulseBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..forward();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.of(context).disableAnimations) return widget.child;
    return ScaleTransition(
      scale: TweenSequence<double>([
        TweenSequenceItem(
            tween: Tween(begin: 1, end: 1.12), weight: 1),
        TweenSequenceItem(
            tween: Tween(begin: 1.12, end: 1), weight: 1),
      ]).animate(CurvedAnimation(parent: _c, curve: Curves.easeOut)),
      child: widget.child,
    );
  }
}
