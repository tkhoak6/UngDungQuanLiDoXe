import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/tokens.dart';
import '../models/entities.dart';
import '../repos/parking_repo.dart';
import '../state/providers.dart';
import '../widgets/ui.dart';

int _toMin(TimeOfDay t) => t.hour * 60 + t.minute;

/// Đặt chỗ trong ngày (P4 thu gọn 1 cột) — form + list "Giữ chỗ của tôi".
class ReservationsScreen extends ConsumerStatefulWidget {
  const ReservationsScreen({super.key, this.zoneId});

  final int? zoneId;

  @override
  ConsumerState<ReservationsScreen> createState() =>
      _ReservationsScreenState();
}

class _ReservationsScreenState
    extends ConsumerState<ReservationsScreen> {
  int? _zoneId;
  TimeOfDay _from = const TimeOfDay(hour: 9, minute: 0);
  TimeOfDay _to = const TimeOfDay(hour: 11, minute: 0);
  bool _saving = false;
  String? _formErr;
  int _reload = 0;

  @override
  void initState() {
    super.initState();
    _zoneId = widget.zoneId;
  }

  Future<void> _pick(bool isFrom) async {
    final v = await showTimePicker(
      context: context,
      initialTime: isFrom ? _from : _to,
    );
    if (v != null) {
      setState(() {
        if (isFrom) {
          _from = v;
        } else {
          _to = v;
        }
        _formErr = null;
      });
    }
  }

  Future<void> _submit(AppUser me) async {
    setState(() {
      _saving = true;
      _formErr = null;
    });
    try {
      final repo = ref.read(customerRepoProvider);
      final row = await repo.createReservation(
        userId: me.id,
        phone: me.phone ?? me.username,
        zoneId: _zoneId!,
        fromMin: _toMin(_from),
        toMin: _toMin(_to),
      );
      if (!mounted) return;
      setState(() => _reload++);
      showAppSheet(
        context,
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Giữ chỗ thành công',
                style: AppText.cardTitle),
            const SizedBox(height: AppGaps.s8),
            PlateText(row.code, size: 20),
            const SizedBox(height: AppGaps.s8),
            Text(
              'Khu ${row.zoneCode} · ${row.startTime}–${row.endTime} '
              '· Hết hạn lúc ${row.expiresAt}',
              style: AppText.body,
            ),
            const SizedBox(height: AppGaps.s16),
            PrimaryButton(
              label: 'Đã hiểu',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      );
    } on RepoException catch (e) {
      setState(() => _formErr = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // ignore: unused_local_variable
    final reload = _reload;
    final repo = ref.watch(customerRepoProvider);
    final zonesRepo = ref.watch(parkingRepoProvider);
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Đăng nhập để đặt chỗ.'));
    }
    final dur = _toMin(_to) - _toMin(_from);

    return Scaffold(
      appBar: AppBar(
          title: const Text('Đặt chỗ', style: AppText.appBar)),
      body: FutureBuilder<List<ReservationRow>>(
        future: repo.myReservations(me.id),
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
                message: 'Không tải được danh sách giữ chỗ.',
                onRetry: () => setState(() => _reload++),
              ),
            );
          }
          final rows = snap.data ?? <ReservationRow>[];
          final pending =
              rows.where((r) => r.status == 'pending').length;
          return ListView(
            padding: const EdgeInsets.all(AppGaps.s16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppGaps.s16),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.stretch,
                    children: [
                      const Text('Giữ chỗ trong ngày',
                          style: AppText.cardTitle),
                      const SizedBox(height: AppGaps.s12),
                      FutureBuilder<List<ParkingZone>>(
                        future: zonesRepo.zones(),
                        builder: (context, zSnap) {
                          final zones = zSnap.data ?? [];
                          if (_zoneId == null && zones.isNotEmpty) {
                            _zoneId = zones.first.id;
                          }
                          return DropdownButtonFormField<int>(
                            key: ValueKey(_zoneId),
                            initialValue: _zoneId,
                            decoration: const InputDecoration(
                                labelText: 'Khu'),
                            items: zones
                                .map((z) =>
                                    DropdownMenuItem<int>(
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
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                  minimumSize:
                                      const Size(48, 48)),
                              onPressed: () => _pick(true),
                              child: Text('Từ ${_from.format(context)}'),
                            ),
                          ),
                          const SizedBox(width: AppGaps.s8),
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                  minimumSize:
                                      const Size(48, 48)),
                              onPressed: () => _pick(false),
                              child: Text('Đến ${_to.format(context)}'),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppGaps.s8),
                      Text(
                        dur > 0
                            ? '${dur ~/ 60}h${dur % 60 == 0 ? '' : '${dur % 60}p'} · trong 06:00–22:00'
                            : 'Chọn khoảng 1–4 giờ',
                        style: AppText.helper,
                      ),
                      if (_formErr != null) ...[
                        const SizedBox(height: AppGaps.s8),
                        Text(_formErr!,
                            style: AppText.helper.copyWith(
                                color: AppColors.danger)),
                      ],
                      const SizedBox(height: AppGaps.s12),
                      PrimaryButton(
                        label: _saving ? 'Đang giữ…' : 'Giữ chỗ',
                        loading: _saving,
                        onPressed: _zoneId == null || pending >= 2
                            ? null
                            : () => _submit(me),
                      ),
                      if (pending >= 2)
                        const Padding(
                          padding:
                              EdgeInsets.only(top: AppGaps.s8),
                          child: Text(
                            'Bạn đã có 2 chỗ đang giữ.',
                            style: AppText.helper,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: AppGaps.s24),
              const Text('Giữ chỗ của tôi',
                  style: AppText.cardTitle),
              const SizedBox(height: AppGaps.s12),
              if (rows.isEmpty)
                const EmptyView(
                  title: 'Chưa có chỗ giữ nào',
                  hint:
                      'Chọn khu + giờ ở trên để giữ chỗ trong ngày.',
                )
              else
                ...rows.map((r) => _ReservationCard(
                      row: r,
                      onCancelled: () =>
                          setState(() => _reload++),
                    )),
            ],
          );
        },
      ),
    );
  }
}

class _ReservationCard extends ConsumerWidget {
  const _ReservationCard({required this.row, required this.onCancelled});

  final ReservationRow row;
  final VoidCallback onCancelled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: ListTile(
        minVerticalPadding: AppGaps.s12,
        title: PlateText(row.code, size: 14),
        subtitle: Text(
            'Khu ${row.zoneCode} · ${row.startTime}–${row.endTime} · ${row.date}'),
        trailing: row.status == 'pending'
            ? SizedBox(
                width: 48,
                height: 48,
                child: IconButton(
                  tooltip: 'Hủy giữ chỗ',
                  onPressed: () async {
                    final me = ref.read(sessionProvider);
                    if (me == null) return;
                    await ref
                        .read(customerRepoProvider)
                        .cancelReservation(row.code, me.id);
                    onCancelled();
                  },
                  icon: const Icon(Icons.cancel_outlined,
                      color: AppColors.danger),
                ),
              )
            : _statusBadge(row.status),
      ),
    );
  }

  Widget _statusBadge(String s) {
    switch (s) {
      case 'pending':
        return AppBadge.warning('Giữ');
      case 'active':
        return AppBadge.info('Đã nhận');
      case 'completed':
        return AppBadge.success('Xong');
      case 'expired':
        return AppBadge.danger('Hết hạn');
      default:
        return AppBadge.warning(s);
    }
  }
}
