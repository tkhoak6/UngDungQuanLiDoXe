import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/format.dart';
import '../core/tokens.dart';
import '../models/entities.dart';
import '../state/providers.dart';
import '../widgets/ui.dart';

/// Sơ đồ chỗ trống — guest + customer dùng chung.
/// Grid 4 cột, poll 30s + manual refresh, pause khi backgrounded.
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen>
    with WidgetsBindingObserver {
  int? _zoneId;
  DateTime? _refreshedAt;
  Timer? _timer;
  int _tick = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() => _tick++);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _timer?.cancel();
      _timer = null;
    } else if (state == AppLifecycleState.resumed && _timer == null) {
      _timer = Timer.periodic(const Duration(seconds: 30), (_) {
        if (mounted) setState(() => _tick++);
      });
      setState(() => _tick++);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // ignore: unused_local_variable
    final tick = _tick;
    final repo = ref.watch(parkingRepoProvider);
    final highContrast = ref.watch(highContrastProvider);
    final session = ref.watch(sessionProvider);

    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 56,
        title: const Text('Sơ đồ trống', style: AppText.appBar),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppGaps.s16),
            child: Center(
              child: Text(fmtTime(DateTime.now()),
                  style: AppText.mono(12)),
            ),
          ),
        ],
      ),
      body: FutureBuilder<List<ParkingZone>>(
        future: repo.zones(),
        builder: (context, zSnap) {
          if (zSnap.connectionState == ConnectionState.waiting) {
            return const Padding(
              padding: EdgeInsets.all(AppGaps.s16),
              child: LoadingList(),
            );
          }
          if (zSnap.hasError || !zSnap.hasData || zSnap.data!.isEmpty) {
            return Padding(
              padding: const EdgeInsets.all(AppGaps.s16),
              child: ErrorBanner(
                message: 'Không tải được sơ đồ.',
                onRetry: () => setState(() => _tick++),
              ),
            );
          }
          final zones = zSnap.data!;
          final current = zones.any((z) => z.id == _zoneId)
              ? _zoneId
              : zones.first.id;
          _zoneId = current;
          return FutureBuilder<List<SpotCell>>(
            future: repo.spots(current!).then((v) {
              _refreshedAt = DateTime.now();
              _error = null;
              return v;
            }).catchError((Object e) {
              _error = 'Không tải được ô đỗ.';
              return <SpotCell>[];
            }),
            builder: (context, sSnap) {
              if (sSnap.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.all(AppGaps.s16),
                  child: LoadingList(),
                );
              }
              final cells = sSnap.data ?? <SpotCell>[];
              final zone =
                  zones.firstWhere((z) => z.id == current);
              final free =
                  cells.where((c) => c.status == 'available').length;
              final full = cells.isNotEmpty && free == 0;
              return Column(
                children: [
                  SizedBox(
                    height: 40,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppGaps.s16),
                      itemCount: zones.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(width: AppGaps.s8),
                      itemBuilder: (context, i) {
                        final z = zones[i];
                        final selected = z.id == current;
                        return ChoiceChip(
                          label: Text('${z.code} · ${z.name}'),
                          selected: selected,
                          onSelected: (_) =>
                              setState(() => _zoneId = z.id),
                        );
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(AppGaps.s16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Còn $free/${cells.length}'
                            '${_refreshedAt != null ? ' · ${elapsedLabel(DateTime.now().difference(_refreshedAt!))} trước' : ''}'
                            '${full ? ' · ĐÃ ĐẦY' : ''}',
                            style: AppText.body,
                          ),
                        ),
                        SizedBox(
                          width: 48,
                          height: 48,
                          child: IconButton(
                            tooltip: 'Làm mới',
                            onPressed: () =>
                                setState(() => _tick++),
                            icon: const Icon(Icons.refresh),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppGaps.s16),
                      child: ErrorBanner(
                        message: _error!,
                        onRetry: () =>
                            setState(() => _tick++),
                      ),
                    ),
                  Expanded(
                    child: cells.isEmpty
                        ? const Center(
                            child: Text(
                                'Chưa có ô đỗ trong khu này.'))
                        : GridView.builder(
                            padding: const EdgeInsets.symmetric(
                                horizontal: AppGaps.s16),
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 4,
                              mainAxisSpacing: 8,
                              crossAxisSpacing: 8,
                              childAspectRatio: 72 / 56,
                            ),
                            itemCount: cells.length,
                            itemBuilder: (context, i) =>
                                _cell(context, cells[i],
                                    highContrast, zone, session),
                          ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: AppGaps.s16, vertical: AppGaps.s8),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        _Legend(
                            color: AppColors.success, label: 'Trống'),
                        SizedBox(width: AppGaps.s16),
                        _Legend(
                            color: AppColors.primary,
                            label: 'Đang đỗ'),
                        SizedBox(width: AppGaps.s16),
                        _Legend(
                            color: AppColors.danger,
                            label: 'Bảo trì'),
                      ],
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
      bottomNavigationBar: session == null
          ? SafeArea(
              child: Container(
                padding: const EdgeInsets.all(AppGaps.s16),
                child: PrimaryButton(
                  label: 'Đăng nhập để đặt chỗ',
                  onPressed: () => context.go('/login'),
                ),
              ),
            )
          : null,
    );
  }

  Widget _cell(BuildContext context, SpotCell c, bool highContrast,
      ParkingZone zone, AppUser? session) {
    final SpotUiState st;
    switch (c.status) {
      case 'occupied':
        st = SpotUiState.occupied;
        break;
      case 'maintenance':
        st = SpotUiState.maintenance;
        break;
      default:
        st = SpotUiState.free;
    }
    final plate = (c.occupyingPlate ?? '').isEmpty
        ? '••••'
        : _shortPlate(c.occupyingPlate!);
    return Semantics(
      label: SpotUi.semanticLabel(c.spotNumber, st),
      button: st == SpotUiState.free,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: st == SpotUiState.maintenance
            ? null
            : () => _detail(context, c, st, zone, session),
        child: Container(
          decoration: BoxDecoration(
            color: st == SpotUiState.occupied
                ? SpotUi.fill(st, highContrast: highContrast)
                : SpotUi.fill(st, highContrast: highContrast),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: SpotUi.border(st),
              width: highContrast ? 2 : 1,
            ),
          ),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(c.spotNumber,
                    style: AppText.mono(10,
                        weight: FontWeight.w600)),
                Text(
                  st == SpotUiState.maintenance ? '🔧' : plate,
                  style: AppText.mono(10),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _shortPlate(String plate) {
    final p = plate.replaceAll(RegExp(r'[\s.]'), '');
    if (p.length <= 5) return p;
    return '${p.substring(0, 3)}…${p.substring(p.length - 2)}';
  }

  void _detail(BuildContext context, SpotCell c, SpotUiState st,
      ParkingZone zone, AppUser? session) {
    showAppSheet(
      context,
      Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PlateText(c.spotNumber, size: 24),
          const SizedBox(height: AppGaps.s8),
          Text('Khu ${zone.code} · ${vnd(zone.pricePerHour)}/giờ',
              style: AppText.body),
          const SizedBox(height: AppGaps.s16),
          if (st == SpotUiState.free && session != null)
            PrimaryButton(
              label: 'Giữ chỗ tại ${zone.code}',
              onPressed: () {
                Navigator.of(context).pop();
                context.go('/c/reservations?zone=${zone.id}');
              },
            )
          else if (st == SpotUiState.free)
            PrimaryButton(
              label: 'Đăng nhập để đặt chỗ',
              onPressed: () {
                Navigator.of(context).pop();
                context.go('/login');
              },
            )
          else
            const Text('Ô đang có xe — chỉ xem.',
                style: AppText.helper),
        ],
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        const SizedBox(width: AppGaps.s4),
        Text(label, style: AppText.helper),
      ],
    );
  }
}
