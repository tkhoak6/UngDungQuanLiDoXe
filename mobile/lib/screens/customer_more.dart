import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/format.dart';
import '../core/tokens.dart';
import '../models/entities.dart';
import '../repos/parking_repo.dart';
import '../state/providers.dart';
import '../widgets/qr_views.dart';
import '../widgets/ui.dart';

/// Vé tháng (P3 xếp dọc): Section A vé của tôi + Section B đăng ký mới.
class PassesScreen extends ConsumerStatefulWidget {
  const PassesScreen({super.key});

  @override
  ConsumerState<PassesScreen> createState() => _PassesScreenState();
}

class _PassesScreenState extends ConsumerState<PassesScreen> {
  final _plate = TextEditingController();
  int? _zoneId;
  int _months = 1;
  bool _saving = false;
  String? _err;
  int _reload = 0;

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
        setState(() => _reload++);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                'Đã gửi đăng ký — mang tiền ra quầy để kích hoạt.'),
          ),
        );
      }
    } on RepoException catch (e) {
      setState(() => _err = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // ignore: unused_local_variable
    final reload = _reload;
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Đăng nhập để xem vé.'));
    }
    final repo = ref.watch(customerRepoProvider);
    final zonesRepo = ref.watch(parkingRepoProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Vé', style: AppText.appBar)),
      body: FutureBuilder<List<PassRow>>(
        future: repo.myPasses(me.phone ?? me.username),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Padding(
              padding: EdgeInsets.all(AppGaps.s16),
              child: LoadingList(),
            );
          }
          if (snap.hasError) {
            return Padding(
              padding: const EdgeInsets.all(AppGaps.s16),
              child: ErrorBanner(
                message: 'Không tải được vé.',
                onRetry: () => setState(() => _reload++),
              ),
            );
          }
          final passes = snap.data ?? <PassRow>[];
          final warn = passes.any((p) =>
              p.status == 'pending' || _expiringSoon(p.endDate));
          return ListView(
            padding: const EdgeInsets.all(AppGaps.s16),
            children: [
              const Text('Vé đang dùng', style: AppText.cardTitle),
              const SizedBox(height: AppGaps.s12),
              FutureBuilder<List<SessionRow>>(
                future: repo.myParkedSessions(me.phone ?? me.username),
                builder: (context, parkSnap) {
                  if (parkSnap.connectionState ==
                      ConnectionState.waiting) {
                    return const LoadingList(rows: 1);
                  }
                  if (parkSnap.hasError) {
                    return ErrorBanner(
                      message: 'Không tải được vé đang dùng.',
                      onRetry: () => setState(() => _reload++),
                    );
                  }
                  final parked = parkSnap.data ?? <SessionRow>[];
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
                ...passes.map((p) => Card(
                      child: ListTile(
                        minVerticalPadding: AppGaps.s12,
                        title: PlateText(p.passCode, size: 14),
                        subtitle: Text(
                            '${p.licensePlate} · ${p.zoneCode}\n${p.startDate} → ${p.endDate} · ${vnd(p.price)}'),
                        isThreeLine: true,
                        trailing: _passBadge(p.status),
                      ),
                    )),
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
              TextField(
                controller: _plate,
                textCapitalization:
                    TextCapitalization.characters,
                decoration: const InputDecoration(
                  labelText: 'Biển số (VD 51H-12345)',
                ),
              ),
              const SizedBox(height: AppGaps.s12),
              FutureBuilder<List<ParkingZone>>(
                future: zonesRepo.zones(),
                builder: (context, zSnap) {
                  final zones = zSnap.data ?? [];
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
