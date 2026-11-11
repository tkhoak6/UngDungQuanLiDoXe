import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/format.dart';
import '../core/tokens.dart';
import '../core/validators.dart';
import '../models/entities.dart';
import '../repos/parking_repo.dart';
import '../state/providers.dart';
import '../widgets/qr_views.dart';
import '../widgets/ui.dart';
import 'qr_scanner_sheet.dart';

/// Check-in staff: biển số + khu + loại vé + mã đặt chỗ + CTA sticky.
class CheckinScreen extends ConsumerStatefulWidget {
  const CheckinScreen({super.key});

  @override
  ConsumerState<CheckinScreen> createState() => _CheckinScreenState();
}

class _CheckinScreenState extends ConsumerState<CheckinScreen> {
  final _plate = TextEditingController();
  final _reservation = TextEditingController();
  int? _zoneId;
  String _vehicleType = 'car';
  bool _saving = false;
  String? _err;
  bool _offline = false;

  @override
  void dispose() {
    _plate.dispose();
    _reservation.dispose();
    super.dispose();
  }

  Future<void> _submit(AppUser me) async {
    final plateErr = Validators.plate(_plate.text);
    setState(() => _err = plateErr);
    if (plateErr != null || _zoneId == null) {
      if (_zoneId == null) {
        setState(() => _err = 'Chọn khu đỗ xe.');
      }
      return;
    }
    setState(() => _saving = true);
    try {
      final row = await ref.read(parkingRepoProvider).checkIn(
            plate: _plate.text,
            vehicleType: _vehicleType,
            zoneId: _zoneId!,
            reservationCode: _reservation.text.trim().isEmpty
                ? null
                : _reservation.text.trim(),
            byUserId: me.id,
          );
      HapticFeedback.lightImpact();
      // V1a: staff device ký QR lúc check-in (có key → QR, không key →
      // text-only, vé vẫn hiệu lực — đối soát khi có mạng).
      final qr = await ref.read(qrRepoProvider).signForSession(row.id);
      _plate.clear();
      if (!mounted) return;
      showAppSheet(
        context,
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            CheckinQrView(session: row, qrText: qr),
            const SizedBox(height: AppGaps.s12),
            PrimaryButton(
              label: 'Check-in tiếp',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      );
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
      return const Center(child: Text('Chưa đăng nhập.'));
    }
    final repo = ref.watch(parkingRepoProvider);
    final offline = ref.watch(offlineProvider).value ?? false;
    _offline = offline;
    final canReserve =
        resolvePerm(roleName: me.roleName, perms: me.permissions, key: 'reservation') ==
            1;

    return Scaffold(
      appBar: AppBar(
          title:
              const Text('Check-in', style: AppText.appBar)),
      body: Column(
        children: [
          if (_offline)
            FutureBuilder<int>(
              future:
                  ref.watch(syncQueueProvider).pending(),
              builder: (context, snap) => OfflineStrip(
                  queue: snap.data ?? 0),
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(AppGaps.s16),
              children: [
                TextField(
                  controller: _plate,
                  textCapitalization:
                      TextCapitalization.characters,
                  style: AppText.mono(18),
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(
                    labelText: 'Biển số (VD 51H-12345)',
                    helperText:
                        'Tự viết hoa. Xe đang đỗ sẽ báo chuyển sang Thu phí.',
                  ),
                ),
                const SizedBox(height: AppGaps.s12),
                FutureBuilder<List<ParkingZone>>(
                  future: repo.zones(),
                  builder: (context, snap) {
                    final zones = snap.data ?? [];
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
                const Text('Loại xe', style: AppText.body),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(
                        value: 'car',
                        label: Text('Ô tô')),
                    ButtonSegment(
                        value: 'motorbike',
                        label: Text('Xe máy')),
                  ],
                  selected: {_vehicleType},
                  onSelectionChanged: (s) => setState(
                      () => _vehicleType = s.first),
                ),
                if (canReserve) ...[
                  const SizedBox(height: AppGaps.s12),
                  TextField(
                    controller: _reservation,
                    textCapitalization:
                        TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText:
                          'Mã đặt chỗ (tùy chọn, VD R-…)',
                    ),
                  ),
                ],
                if (_err != null) ...[
                  const SizedBox(height: AppGaps.s8),
                  Text(_err!,
                      style: AppText.helper.copyWith(
                          color: AppColors.danger)),
                ],
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppGaps.s16),
              child: PrimaryButton(
                label: _saving ? 'Đang check-in…' : 'Check-in',
                loading: _saving,
                minHeight: 52,
                onPressed: () => _submit(me),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Thu phí (check-out): search vé/biển → preview → thu.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _query = TextEditingController();
  final _discount = TextEditingController(text: '0');
  final _reason = TextEditingController();
  String _method = 'cash';
  SessionRow? _found;
  bool _searching = false;
  bool _paying = false;
  String? _err;
  int? _paidTotal;

  /// Chế độ quét/nhập tay (spec §1.1B.1) — default Quét QR (nhanh hơn).
  bool _scanMode = true;

  @override
  void dispose() {
    _query.dispose();
    _discount.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _openScanner() async {
    final raw = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      constraints: const BoxConstraints(maxWidth: 640),
      builder: (_) => const QrScannerSheet(),
    );
    if (raw == null || raw.isEmpty || !mounted) return;
    await _verifyQr(raw);
  }

  /// Quét trúng → verify offline (SIG + status local) → prefill thu phí.
  /// Fail → inline Danger banner trên cùng màn (không sheet mới).
  Future<void> _verifyQr(String raw) async {
    setState(() {
      _searching = true;
      _err = null;
      _paidTotal = null;
    });
    try {
      final res = await ref.read(qrRepoProvider).verify(raw);
      if (!mounted) return;
      if (res.valid && res.session != null) {
        setState(() => _found = res.session);
      } else {
        setState(() => _err = res.message ?? 'Mã không hợp lệ.');
      }
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _search() async {
    setState(() {
      _searching = true;
      _err = null;
      _paidTotal = null;
    });
    try {
      final row = await ref
          .read(parkingRepoProvider)
          .findParked(_query.text);
      setState(() => _found = row);
      if (row == null) {
        setState(() => _err = 'Không tìm thấy xe đang đỗ.');
      }
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _pay(AppUser me) async {
    final row = _found;
    if (row == null) return;
    final discount = int.tryParse(_discount.text.trim()) ?? 0;
    setState(() {
      _paying = true;
      _err = null;
    });
    try {
      final total =
          await ref.read(parkingRepoProvider).checkOut(
                sessionId: row.id,
                discount: discount,
                discountReason: _reason.text,
                method: _method,
                byUserId: me.id,
              );
      HapticFeedback.lightImpact();
      setState(() {
        _paidTotal = total;
        _found = null;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Đã thu ${vnd(total)}.')),
        );
      }
    } on RepoException catch (e) {
      setState(() => _err = e.message);
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Chưa đăng nhập.'));
    }
    final row = _found;

    return Scaffold(
      appBar:
          AppBar(title: const Text('Thu phí', style: AppText.appBar)),
      body: ListView(
        padding: const EdgeInsets.all(AppGaps.s16),
        children: [
          Semantics(
            label: 'Chế độ tìm vé',
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                    value: true, label: Text('Quét QR')),
                ButtonSegment(
                    value: false, label: Text('Nhập tay')),
              ],
              selected: {_scanMode},
              onSelectionChanged: (s) => setState(() {
                _scanMode = s.first;
                _err = null;
              }),
            ),
          ),
          const SizedBox(height: AppGaps.s12),
          if (_scanMode)
            PrimaryButton(
              label: _searching ? 'Đang kiểm tra…' : 'Quét mã QR',
              loading: _searching,
              minHeight: 52,
              onPressed: _searching ? null : _openScanner,
            )
          else
            SearchBar(
              controller: _query,
              hintText: 'Mã vé / biển số…',
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              trailing: [
                SizedBox(
                  width: 48,
                  height: 48,
                  child: IconButton(
                    tooltip: 'Tìm',
                    onPressed: _search,
                    icon: _searching
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2),
                          )
                        : const Icon(Icons.search),
                  ),
                ),
              ],
              constraints: const BoxConstraints(minHeight: 48),
            ),
          if (_scanMode && _err != null) ...[
            const SizedBox(height: AppGaps.s12),
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: _searching ? null : _openScanner,
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Quét lại'),
              ),
            ),
          ],
          if (_err != null) ...[
            const SizedBox(height: AppGaps.s8),
            Text(_err!,
                style: AppText.helper
                    .copyWith(color: AppColors.danger)),
          ],
          if (row != null) ...[
            const SizedBox(height: AppGaps.s16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(AppGaps.s16),
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.stretch,
                  children: [
                    PlateText(row.licensePlate, size: 20),
                    const SizedBox(height: AppGaps.s4),
                    Text(
                        'Vé ${row.ticketCode} · Khu ${row.zoneCode} · Vào ${row.checkInAt}'),
                    if (row.isMonthly)
                      const Padding(
                        padding:
                            EdgeInsets.only(top: AppGaps.s8),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: AppBadgeSuccessWrap(),
                        ),
                      ),
                    const SizedBox(height: AppGaps.s12),
                    TextField(
                      controller: _discount,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Giảm giá (VNĐ)',
                      ),
                    ),
                    const SizedBox(height: AppGaps.s12),
                    TextField(
                      controller: _reason,
                      decoration: const InputDecoration(
                        labelText:
                            'Lý do giảm (bắt buộc nếu giảm > 0)',
                      ),
                    ),
                    const SizedBox(height: AppGaps.s12),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(
                            value: 'cash',
                            label: Text('Tiền mặt')),
                        ButtonSegment(
                            value: 'transfer',
                            label: Text('Chuyển khoản')),
                      ],
                      selected: {_method},
                      onSelectionChanged: (s) =>
                          setState(() => _method = s.first),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppGaps.s16),
            PrimaryButton(
              label: row.isMonthly
                  ? 'Cho ra (vé tháng)'
                  : 'Thu & Cho ra',
              loading: _paying,
              minHeight: 52,
              onPressed: () => _pay(me),
            ),
          ],
          if (_paidTotal != null) ...[
            const SizedBox(height: AppGaps.s16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(AppGaps.s16),
                child: Column(
                  children: [
                    const Text('Đã thu',
                        style: AppText.cardTitle),
                    const SizedBox(height: AppGaps.s8),
                    MoneyText(_paidTotal!, size: 24),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class AppBadgeSuccessWrap extends StatelessWidget {
  const AppBadgeSuccessWrap({super.key});

  @override
  Widget build(BuildContext context) =>
      AppBadge.success('Vé tháng · 0₫');
}
