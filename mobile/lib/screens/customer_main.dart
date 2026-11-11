import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/anpr.dart';
import '../core/format.dart';
import '../core/reservations.dart';
import '../core/retained_future.dart';
import '../core/tokens.dart';
import '../core/validators.dart';
import '../models/entities.dart';
import '../repos/parking_repo.dart';
import '../state/providers.dart';
import '../widgets/plate_field.dart';
import '../widgets/ui.dart';
import 'anpr_sheet.dart';

/// Đặt chỗ 24/24 + qua đêm (MO-012, nối BE-019 + FE-023 desktop).
/// Mode mặc định "đặt nhanh": Khu + Biển số (prefill xe đầu tiên) +
/// chips 1/2/3/4h + "Bắt đầu: ngay bây giờ" + "Giữ chỗ ngay".
/// Link "Chỉnh giờ chi tiết" mở form Từ/Đến tay (qua đêm được).
/// KHÔNG ô nhập giờ ở mode nhanh, KHÔNG clamp/khóa theo giờ.
class ReservationsScreen extends ConsumerStatefulWidget {
  const ReservationsScreen({super.key, this.zoneId});

  final int? zoneId;

  @override
  ConsumerState<ReservationsScreen> createState() =>
      _ReservationsScreenState();
}

const _quickDurations = [60, 120, 180, 240]; // 1h / 2h / 3h / 4h

class _ReservationsScreenState extends ConsumerState<ReservationsScreen> {
  int? _zoneId;
  bool _quick = true;
  int _duration = 120; // default 2h (như desktop FE-023)
  final _plate = TextEditingController();
  bool _plateCustom = false;
  String? _prefilledFor;
  late TimeOfDay _from;
  late TimeOfDay _to;
  bool _saving = false;
  String? _formErr;
  int _pendingCount = 0;
  // MO-013: giữ Future qua rebuild — ô biển số nằm trong FutureBuilder, tạo
  // future mới mỗi build + setState khi gõ = mất focus sau 1 ký tự.
  final _reservationsRet = RetainedFuture<List<ReservationRow>>();
  final _zonesRet = RetainedFuture<List<ZoneAvailability>>();
  final _vehiclesRet = RetainedFuture<List<VehicleRow>>();
  List<ZoneAvailability> _zones = [];
  DateTime _now = DateTime.now();
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _zoneId = widget.zoneId;
    final n = TimeOfDay.now();
    _from = n;
    final endMin = n.hour * 60 + n.minute + 120;
    _to = TimeOfDay(hour: (endMin ~/ 60) % 24, minute: endMin % 60);
    // Countdown tick 30s + poll 60s (BE-019: poll giữ nguyên).
    // MO-013: poll đi qua _refreshLists (giữ value cũ lúc chờ) nên ô biển số
    // đang gõ không bị unmount/mất focus.
    var polls = 0;
    _tick = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!mounted) return;
      polls++;
      setState(() => _now = DateTime.now());
      if (polls % 2 == 0) _refreshLists();
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _plate.dispose();
    super.dispose();
  }

  int get _quickFromMin => _now.hour * 60 + _now.minute;
  int get _quickToMin => (_quickFromMin + _duration) % 1440;
  bool get _quickOvernight => isOvernight(_quickFromMin, _quickToMin);

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

  /// Quét ANPR cho mode dropdown (>1 xe): khớp xe có sẵn thì chọn,
  /// biển lạ thì chuyển sang nhập tay với biển vừa quét. Hủy/lỗi →
  /// giữ nguyên form (không kẹt).
  Future<void> _scanIntoPlates(List<String> plates) async {
    final norm = await openAnprSheet(context);
    if (norm == null || !mounted) return;
    String? match;
    for (final p in plates) {
      if (Anpr.normalize(p) == norm) {
        match = p;
        break;
      }
    }
    setState(() {
      if (match != null) {
        _plateCustom = false;
        _plate.text = match;
      } else {
        _plateCustom = true;
        _plate.text = Anpr.display(norm);
      }
      _formErr = null;
    });
    if (mounted) toastPlateFilled(context, norm);
  }

  Future<void> _submit(AppUser me, {required bool quick}) async {
    setState(() {
      _saving = true;
      _formErr = null;
    });
    try {
      final clean = Validators.normalizePlate(_plate.text);
      if (Validators.plate(clean) != null) {
        throw const RepoException(
            'INVALID_PLATE', 'Biển số chưa đúng — VD: 51H-12345.');
      }
      if (_zoneId == null) {
        throw const RepoException('NO_ZONE', 'Vui lòng chọn khu vực.');
      }
      // Quick: start = ngay bây giờ (chốt lúc bấm nút) — FE-023.
      final fromMin = quick
          ? DateTime.now().hour * 60 + DateTime.now().minute
          : _from.hour * 60 + _from.minute;
      final toMin =
          quick ? (fromMin + _duration) % 1440 : _to.hour * 60 + _to.minute;
      final row = await ref.read(customerRepoProvider).createReservation(
            userId: me.id,
            phone: me.phone ?? me.username,
            plate: clean,
            zoneId: _zoneId!,
            fromMin: fromMin,
            toMin: toMin,
          );
      if (!mounted) return;
      _refreshLists();
      _showSuccess(row);
    } on RepoException catch (e) {
      setState(() => _formErr = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Tải lại 3 list (poll 60s, retry, sau giữ/hủy). Giữ value cũ lúc chờ nên
  /// form + ô biển số không bị thay bằng LoadingList (MO-013).
  void _refreshLists() {
    if (!mounted) return;
    final me = ref.read(sessionProvider);
    if (me == null) return;
    final repo = ref.read(customerRepoProvider);
    final zonesRepo = ref.read(parkingRepoProvider);
    final phone = me.phone ?? me.username;
    setState(() {
      _reservationsRet.refresh(() => repo.myReservations(me.id));
      _zonesRet.refresh(() => zonesRepo.availability());
      _vehiclesRet.refresh(() => repo.myVehicles(phone));
    });
  }

  void _showSuccess(ReservationRow row) {
    final overnight = isOvernight(
      _toMinOf(row.startTime),
      _toMinOf(row.endTime),
    );
    showAppSheet(
      context,
      Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Giữ chỗ thành công', style: AppText.cardTitle),
          const SizedBox(height: AppGaps.s8),
          PlateText(row.code, size: 20),
          const SizedBox(height: AppGaps.s8),
          Text(
            'Khu ${row.zoneCode} · ${row.startTime}–${row.endTime}'
            '${overnight ? ' (qua đêm)' : ''} · ${row.date}'
            '\nTự hủy sau 20 phút quá giờ kết thúc nếu chưa check-in.'
            '\nHết hạn lúc ${row.expiresAt.length >= 16 ? row.expiresAt.substring(0, 16) : row.expiresAt}',
            style: AppText.body,
          ),
          const SizedBox(height: AppGaps.s16),
          PrimaryButton(
            label: 'Copy mã',
            onPressed: () {
              Clipboard.setData(ClipboardData(text: row.code));
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Đã sao chép mã ${row.code}.')),
              );
            },
          ),
          const SizedBox(height: AppGaps.s8),
          PrimaryButton(
            label: 'Đã hiểu',
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  int _toMinOf(String hhmm) {
    final parts = hhmm.split(':');
    if (parts.length != 2) return 0;
    return (int.tryParse(parts[0]) ?? 0) * 60 +
        (int.tryParse(parts[1]) ?? 0);
  }

  Future<void> _confirmCancel(ReservationRow row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hủy giữ chỗ'),
        content: Text(
            'Hủy vé giữ chỗ ${row.code}? Ô giữ sẽ trả về bãi ngay.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Ở lại'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(
                foregroundColor: AppColors.danger),
            child: const Text('Hủy giữ chỗ'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final me = ref.read(sessionProvider);
    if (me == null) return;
    try {
      await ref
          .read(customerRepoProvider)
          .cancelReservation(row.code, me.id);
      if (!mounted) return;
      _refreshLists();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Đã hủy vé giữ chỗ ${row.code}')),
      );
    } on RepoException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    }
  }

  void _refill(ReservationRow row) {
    ZoneAvailability? match;
    for (final z in _zones) {
      if (z.zoneCode == row.zoneCode) match = z;
    }
    setState(() {
      _zoneId = match?.zoneId; // null → tự chọn khu còn chỗ khi tải xong
      _plateCustom = false;
      _plate.text = row.licensePlate;
      _quick = false; // đặt lại theo khung giờ cụ thể của vé cũ
      final f = _toMinOf(row.startTime);
      final t = _toMinOf(row.endTime);
      _from = TimeOfDay(hour: f ~/ 60, minute: f % 60);
      _to = TimeOfDay(hour: t ~/ 60, minute: t % 60);
      _formErr = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final repo = ref.watch(customerRepoProvider);
    final zonesRepo = ref.watch(parkingRepoProvider);
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Đăng nhập để đặt chỗ.'));
    }
    final phone = me.phone ?? me.username;

    return Scaffold(
      appBar:
          AppBar(title: const Text('Đặt chỗ', style: AppText.appBar)),
      body: FutureBuilder<List<ReservationRow>>(
        // MO-013: future giữ qua rebuild — gõ biển số (setState mỗi ký tự)
        // không tạo future mới, không rớt về waiting, không mất focus.
        future:
            _reservationsRet.of(me.id, () => repo.myReservations(me.id)),
        builder: (context, snap) {
          // Fetch lại (poll/retry) thì vẽ tiếp dữ liệu cũ trong lúc chờ.
          final rows = snap.data ?? _reservationsRet.value;
          if (rows == null) {
            if (snap.hasError) {
              return Padding(
                padding: const EdgeInsets.all(AppGaps.s16),
                child: ErrorBanner(
                  message: 'Không tải được danh sách giữ chỗ.',
                  onRetry: _refreshLists,
                ),
              );
            }
            return const Padding(
              padding: EdgeInsets.all(AppGaps.s16),
              child: LoadingList(),
            );
          }
          _pendingCount =
              rows.where((r) => r.status == 'pending').length;
          final quotaReached = _pendingCount >= 2;
          return ListView(
            padding: const EdgeInsets.all(AppGaps.s16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppGaps.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('Giữ chỗ 24/24',
                          style: AppText.cardTitle),
                      const SizedBox(height: AppGaps.s4),
                      const Text(
                        'Mở cả ngày lẫn đêm — qua đêm tự tính sang hôm sau.',
                        style: AppText.helper,
                      ),
                      const SizedBox(height: AppGaps.s12),
                      FutureBuilder<List<ZoneAvailability>>(
                        future: _zonesRet.of(
                            phone, () => zonesRepo.availability()),
                        builder: (context, zSnap) {
                          final zones = zSnap.data ??
                              _zonesRet.value ??
                              <ZoneAvailability>[];
                          _zones = zones;
                          if (_zoneId == null && zones.isNotEmpty) {
                            final withFree = zones.where(
                                (z) => z.freeSpots > 0);
                            _zoneId = (withFree.isEmpty
                                    ? zones.first
                                    : withFree.first)
                                .zoneId;
                          }
                          return DropdownButtonFormField<int>(
                            key: ValueKey(_zoneId),
                            initialValue: _zoneId,
                            decoration: const InputDecoration(
                                labelText: 'Khu vực *'),
                            items: zones
                                .map((z) => DropdownMenuItem<int>(
                                      value: z.zoneId,
                                      enabled: z.freeSpots > 0,
                                      child: Text(
                                          'Khu ${z.zoneCode} — còn ${z.freeSpots}'),
                                    ))
                                .toList(),
                            onChanged: (v) => setState(() {
                              _zoneId = v;
                              _formErr = null;
                            }),
                          );
                        },
                      ),
                      const SizedBox(height: AppGaps.s12),
                      FutureBuilder<List<VehicleRow>>(
                        future: _vehiclesRet.of(
                            phone, () => repo.myVehicles(phone)),
                        builder: (context, vSnap) {
                          final vehicles = vSnap.data ??
                              _vehiclesRet.value ??
                              <VehicleRow>[];
                          if (_prefilledFor != phone &&
                              vehicles.isNotEmpty &&
                              _plate.text.isEmpty) {
                            _prefilledFor = phone;
                            _plate.text =
                                vehicles.first.licensePlate;
                          }
                          if (vehicles.length > 1 &&
                              !_plateCustom) {
                            final plates = vehicles
                                .map((v) => v.licensePlate)
                                .toList();
                            return Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.stretch,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                DropdownButtonFormField<
                                    String>(
                                  initialValue: plates
                                          .contains(_plate.text)
                                      ? _plate.text
                                      : null,
                                  decoration: const InputDecoration(
                                    labelText: 'Biển số xe *',
                                    helperText:
                                        'Biển số đối soát khi check-in bằng mã giữ chỗ',
                                  ),
                                  items: [
                                    ...plates.map((p) =>
                                        DropdownMenuItem<String>(
                                          value: p,
                                          child: PlateText(p,
                                              size: 14),
                                        )),
                                    const DropdownMenuItem<String>(
                                      value: '__custom',
                                      child:
                                          Text('Biển số khác…'),
                                    ),
                                  ],
                                  onChanged: (v) {
                                    if (v == null) return;
                                    setState(() {
                                      if (v == '__custom') {
                                        _plateCustom = true;
                                        _plate.clear();
                                      } else {
                                        _plate.text = v;
                                      }
                                      _formErr = null;
                                    });
                                  },
                                ),
                                const SizedBox(height: AppGaps.s8),
                                SizedBox(
                                  height: 48,
                                  child: OutlinedButton.icon(
                                    onPressed: () =>
                                        _scanIntoPlates(plates),
                                    icon: const Icon(
                                      Icons.photo_camera_outlined,
                                      semanticLabel: 'Quét biển số',
                                    ),
                                    label: const Text('Quét biển số'),
                                  ),
                                ),
                              ],
                            );
                          }
                          return PlateField(
                            controller: _plate,
                            labelText: 'Biển số xe *',
                            hintText: 'VD 51H-12345',
                            helperText:
                                'Biển số đối soát khi check-in bằng mã giữ chỗ',
                            onChanged: (_) => setState(
                                () => _formErr = null),
                          );
                        },
                      ),
                      const SizedBox(height: AppGaps.s12),
                      if (_quick) ...[
                        const Text('Thời lượng *',
                            style: AppText.body),
                        const SizedBox(height: AppGaps.s8),
                        Wrap(
                          spacing: AppGaps.s8,
                          children: _quickDurations
                              .map((d) => ChoiceChip(
                                    label: Text('${d ~/ 60}h'),
                                    selected: _duration == d,
                                    onSelected: (_) =>
                                        setState(() {
                                      _duration = d;
                                      _formErr = null;
                                    }),
                                  ))
                              .toList(),
                        ),
                        const SizedBox(height: AppGaps.s8),
                        Text(
                          'Bắt đầu: ngay bây giờ (${fmtTime(_now)})'
                          ' → kết thúc dự kiến ${hhmm(_quickFromMin + _duration)}'
                          ' (${fmtDur(_duration)})'
                          '${_quickOvernight ? ' · qua đêm' : ''}',
                          style: AppText.helper,
                        ),
                      ] else ...[
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                    minimumSize:
                                        const Size(48, 48)),
                                onPressed: () => _pick(true),
                                child: Text(
                                    'Từ ${_from.format(context)}'),
                              ),
                            ),
                            const SizedBox(width: AppGaps.s8),
                            Expanded(
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                    minimumSize:
                                        const Size(48, 48)),
                                onPressed: () => _pick(false),
                                child: Text(
                                    'Đến ${_to.format(context)}'),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppGaps.s8),
                        Builder(builder: (_) {
                          final f = _from.hour * 60 +
                              _from.minute;
                          final t =
                              _to.hour * 60 + _to.minute;
                          final dur =
                              reservationDurationMin(f, t);
                          final ok =
                              dur >= 15 && dur <= 4 * 60;
                          return Text(
                            '${fmtDur(dur)}'
                            '${isOvernight(f, t) ? ' · qua đêm (sang hôm sau)' : ''}'
                            '${ok ? '' : ' · mỗi lượt 15 phút–4 giờ'}',
                            style: AppText.helper,
                          );
                        }),
                      ],
                      if (_formErr != null) ...[
                        const SizedBox(height: AppGaps.s8),
                        Text(_formErr!,
                            style: AppText.helper.copyWith(
                                color: AppColors.danger)),
                      ],
                      const SizedBox(height: AppGaps.s12),
                      if (quotaReached)
                        const Text(
                          'Bạn đã có 2 chỗ đang giữ — hủy bớt trước khi giữ thêm.',
                          style: AppText.helper,
                        )
                      else if (_quick) ...[
                        PrimaryButton(
                          label:
                              _saving ? 'Đang giữ…' : 'Giữ chỗ ngay',
                          loading: _saving,
                          onPressed: () => _submit(me, quick: true),
                        ),
                        const SizedBox(height: AppGaps.s8),
                        Center(
                          child: TextButton(
                            onPressed: () => setState(() {
                              _quick = false;
                              _formErr = null;
                            }),
                            child: const Text(
                                'Chỉnh giờ chi tiết'),
                          ),
                        ),
                      ] else ...[
                        PrimaryButton(
                          label:
                              _saving ? 'Đang giữ…' : 'Giữ chỗ',
                          loading: _saving,
                          onPressed: () =>
                              _submit(me, quick: false),
                        ),
                        const SizedBox(height: AppGaps.s8),
                        Center(
                          child: TextButton(
                            onPressed: () => setState(() {
                              _quick = true;
                              _formErr = null;
                            }),
                            child:
                                const Text('Về đặt nhanh'),
                          ),
                        ),
                      ],
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
                      'Chọn khu + thời lượng ở trên rồi bấm Giữ chỗ ngay — '
                      'mã R-… dùng để check-in tại quầy, cả đêm.',
                )
              else
                ...rows.map((r) => _ReservationCard(
                      row: r,
                      now: _now,
                      onCancel: () => _confirmCancel(r),
                      onRefill: () => _refill(r),
                    )),
            ],
          );
        },
      ),
    );
  }
}

class _ReservationCard extends StatelessWidget {
  const _ReservationCard({
    required this.row,
    required this.now,
    required this.onCancel,
    required this.onRefill,
  });

  final ReservationRow row;
  final DateTime now;
  final VoidCallback onCancel;
  final VoidCallback onRefill;

  @override
  Widget build(BuildContext context) {
    final isPending = row.status == 'pending';
    final mins =
        isPending ? minutesToExpiry(row.expiresAt, now) : null;
    final soon = mins != null && mins <= 15;
    final expHint = row.expiresAt.length >= 16
        ? row.expiresAt.substring(11, 16)
        : row.expiresAt;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppGaps.s12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                    child: PlateText(row.code, size: 14)),
                if (isPending)
                  soon
                      ? AppBadge.warning('Sắp hết')
                      : AppBadge.success('Giữ chỗ')
                else
                  _statusBadge(row.status),
              ],
            ),
            const SizedBox(height: AppGaps.s4),
            Text(
              'Khu ${row.zoneCode} · ${row.startTime}–${row.endTime}'
              ' · ${row.date}'
              '${row.licensePlate.isNotEmpty ? ' · ${row.licensePlate}' : ''}',
              style: AppText.body,
            ),
            if (isPending && mins != null) ...[
              const SizedBox(height: AppGaps.s4),
              Text(
                mins > 0
                    ? 'Hết hạn sau ${mins}p · Hết hạn lúc $expHint'
                    : 'Đã quá giờ hẹn — hệ thống sẽ tự hủy',
                style: AppText.helper,
              ),
            ],
            const SizedBox(height: AppGaps.s8),
            if (isPending)
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                          minimumSize:
                              const Size(48, 48)),
                      onPressed: () {
                        Clipboard.setData(
                            ClipboardData(text: row.code));
                        ScaffoldMessenger.of(context)
                            .showSnackBar(
                          SnackBar(
                              content: Text(
                                  'Đã sao chép mã ${row.code}.')),
                        );
                      },
                      child: const Text('Copy mã'),
                    ),
                  ),
                  const SizedBox(width: AppGaps.s8),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize:
                            const Size(48, 48),
                        foregroundColor: AppColors.danger,
                      ),
                      onPressed: onCancel,
                      child: const Text('Hủy'),
                    ),
                  ),
                ],
              )
            else
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48)),
                onPressed: () {
                  onRefill();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content: Text(
                            'Đã nạp lại khung giờ vé cũ — chỉnh lại rồi Giữ chỗ.')),
                  );
                },
                child: const Text('Đặt lại'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _statusBadge(String s) {
    switch (s) {
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
