import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/format.dart';
import '../core/retained_future.dart';
import '../core/tokens.dart';
import '../models/entities.dart';
import '../repos/customer_repo.dart';
import '../state/providers.dart';
import '../state/session_actions.dart';
import '../widgets/ui.dart';

/// Xe của tôi + Lịch sử — segmented 2 trang trong 1 tab.
class VehiclesScreen extends ConsumerStatefulWidget {
  const VehiclesScreen({super.key});

  @override
  ConsumerState<VehiclesScreen> createState() => _VehiclesScreenState();
}

class _VehiclesScreenState extends ConsumerState<VehiclesScreen> {
  int _segment = 0;
  String _search = '';
  int _range = 7;
  // MO-013: giữ Future qua rebuild — ô tìm kiếm setState mỗi ký tự, tạo
  // future mới mỗi build = SearchBar bị unmount, mất focus sau 1 ký tự.
  final _vehiclesRet = RetainedFuture<List<VehicleRow>>();
  final _historyRet = RetainedFuture<List<SessionRow>>();

  /// Tải lại cả 2 tab (retry). Giữ value cũ lúc chờ nên không blink.
  void _refresh() {
    if (!mounted) return;
    final me = ref.read(sessionProvider);
    if (me == null || me.phone == null) return;
    final repo = ref.read(customerRepoProvider);
    final phone = me.phone!;
    setState(() {
      _vehiclesRet.refresh(() => repo.myVehicles(phone));
      _historyRet.refresh(() => repo.mySessions(phone, from: _day(_from())));
    });
  }

  DateTime _from() => DateTime.now().subtract(Duration(days: _range));

  static String _day(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(sessionProvider);
    if (me == null || me.phone == null) {
      return const Center(child: Text('Đăng nhập để xem xe.'));
    }
    final repo = ref.watch(customerRepoProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Xe tôi', style: AppText.appBar),
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
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(AppGaps.s16),
            child: SegmentedButton<int>(
              segments: const [
                ButtonSegment(
                    value: 0,
                    label: Text('Xe của tôi'),
                    icon: Icon(Icons.directions_car)),
                ButtonSegment(
                    value: 1,
                    label: Text('Lịch sử'),
                    icon: Icon(Icons.history)),
              ],
              selected: {_segment},
              onSelectionChanged: (s) =>
                  setState(() => _segment = s.first),
              style: ButtonStyle(
                minimumSize: WidgetStateProperty.all(
                    const Size(48, 48)),
              ),
            ),
          ),
          Expanded(
            child: _segment == 0
                ? _vehicles(repo, me)
                : _history(repo, me),
          ),
        ],
      ),
    );
  }

  Widget _vehicles(CustomerRepo repo, AppUser me) {
    return FutureBuilder<List<VehicleRow>>(
      // MO-013: future giữ qua rebuild — gõ ô tìm kiếm không tạo future mới,
      // SearchBar không bị unmount, không mất focus.
      future:
          _vehiclesRet.of(me.phone!, () => repo.myVehicles(me.phone!)),
      builder: (context, snap) {
        // Tải lại (retry) thì vẽ tiếp dữ liệu cũ trong lúc chờ.
        final cached = snap.data ?? _vehiclesRet.value;
        if (cached == null) {
          if (snap.hasError) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: AppGaps.s16),
              child: ErrorBanner(
                message: 'Không tải được xe.',
                onRetry: _refresh,
              ),
            );
          }
          return const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppGaps.s16),
            child: LoadingList(),
          );
        }
        var rows = cached;
        if (_search.trim().isNotEmpty) {
          final q = _search.trim().toUpperCase();
          rows = rows
              .where((r) => r.licensePlate.contains(q))
              .toList();
        }
        return ListView(
          padding:
              const EdgeInsets.symmetric(horizontal: AppGaps.s16),
          children: [
            SearchBar(
              hintText: 'Tìm biển số…',
              onChanged: (v) => setState(() => _search = v),
              constraints: const BoxConstraints(minHeight: 48),
            ),
            const SizedBox(height: AppGaps.s12),
            if (rows.isEmpty)
              EmptyView(
                title: 'Bạn chưa có xe nào',
                hint:
                    'Xe do quầy nhập với đúng SĐT ${me.phone} sẽ tự hiện ở đây.',
                actionLabel: 'Xem Sơ đồ',
                onAction: () => context.go('/c/map'),
              )
            else
              ...rows.map((v) => Card(
                    child: ListTile(
                      minVerticalPadding: AppGaps.s12,
                      title: PlateText(v.licensePlate),
                      subtitle: Text(
                          '${v.vehicleType} · ${v.tripCount} lượt · ${vnd(v.totalPaid)}'),
                      trailing: v.parked
                          ? AppBadge.info('Đang đỗ')
                          : AppBadge.success('Trống'),
                      onTap: () => showAppSheet(
                        context,
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment:
                              CrossAxisAlignment.stretch,
                          children: [
                            PlateText(v.licensePlate,
                                size: 22),
                            const SizedBox(
                                height: AppGaps.s8),
                            Text(
                                'Loại: ${v.vehicleType} · Tổng ${v.tripCount} lượt · ${vnd(v.totalPaid)}'),
                          ],
                        ),
                      ),
                    ),
                  )),
          ],
        );
      },
    );
  }

  Widget _history(CustomerRepo repo, AppUser me) {
    final key = '${me.phone}-$_range';
    return FutureBuilder<List<SessionRow>>(
      future: _historyRet.of(
          key, () => repo.mySessions(me.phone!, from: _day(_from()))),
      builder: (context, snap) {
        final rows = snap.data ?? _historyRet.value;
        if (rows == null) {
          if (snap.hasError) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: AppGaps.s16),
              child: ErrorBanner(
                message: 'Không tải được lịch sử.',
                onRetry: _refresh,
              ),
            );
          }
          return const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppGaps.s16),
            child: LoadingList(),
          );
        }
        final total =
            rows.fold<int>(0, (a, r) => a + (r.totalFee ?? 0));
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppGaps.s16),
              child: SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 1, label: Text('1 ngày')),
                  ButtonSegment(value: 7, label: Text('7 ngày')),
                  ButtonSegment(value: 30, label: Text('30 ngày')),
                ],
                selected: {_range},
                onSelectionChanged: (s) =>
                    setState(() => _range = s.first),
              ),
            ),
            Expanded(
              child: rows.isEmpty
                  ? const EmptyView(
                      title: 'Chưa có lượt gửi nào',
                      hint:
                          'Mở rộng khoảng ngày để xem thêm.',
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(AppGaps.s16),
                      itemCount: rows.length,
                      itemBuilder: (context, i) {
                        final r = rows[i];
                        return Card(
                          child: ListTile(
                            title: PlateText(r.ticketCode,
                                size: 14),
                            subtitle: Text(
                                '${r.licensePlate} · Khu ${r.zoneCode} · ${r.checkInAt}'),
                            trailing: MoneyText(
                                r.totalFee ?? 0,
                                size: 14),
                          ),
                        );
                      },
                    ),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppGaps.s16),
              child: Text(
                'Tổng: ${rows.length} lượt · ${vnd(total)}',
                style: AppText.body,
                textAlign: TextAlign.center,
              ),
            ),
          ],
        );
      },
    );
  }
}
