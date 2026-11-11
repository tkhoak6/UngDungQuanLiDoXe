import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/tokens.dart';
import '../core/retained_future.dart';
import '../models/entities.dart';
import '../repos/staff_repo.dart';
import '../state/providers.dart';
import '../widgets/ui.dart';

/// Chấm công: card ca hiện tại + Vào/Ra + lịch sử 7 ngày + banner quên chốt.
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() =>
      _AttendanceScreenState();
}

class _AttendanceScreenState
    extends ConsumerState<AttendanceScreen> {
  final _opening = TextEditingController(text: '0');
  final _closing = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;
  String? _err;
  // MO-013: giữ Future qua rebuild — ô tiền/ghi chú nằm trong FutureBuilder,
  // setState lúc submit không được unmount chúng.
  final _todayRet = RetainedFuture<AttendanceRow?>();
  final _yesterdayRet = RetainedFuture<String?>();
  final _historyRet = RetainedFuture<List<AttendanceRow>>();

  /// Tải lại ca hôm nay (retry, sau vào/chốt ca). Giữ value cũ lúc chờ.
  void _refresh() {
    if (!mounted) return;
    final me = ref.read(sessionProvider);
    if (me == null) return;
    final repo = ref.read(staffRepoProvider);
    setState(() {
      _todayRet.refresh(() => repo.today(me.id));
      _yesterdayRet.refresh(() => repo.yesterdayOpen(me.id));
      _historyRet.refresh(() => repo.history(me.id));
    });
  }

  @override
  void dispose() {
    _opening.dispose();
    _closing.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Chưa đăng nhập.'));
    }
    final repo = ref.watch(staffRepoProvider);
    final cur = StaffRepo.currentShift(DateTime.now());

    return Scaffold(
      appBar: AppBar(
          title:
              const Text('Chấm công', style: AppText.appBar)),
      body: ListView(
        padding: const EdgeInsets.all(AppGaps.s16),
        children: [
          FutureBuilder<AttendanceRow?>(
            // MO-013: future giữ qua rebuild — setState lúc submit không tạo
            // future mới, ô tiền/ghi chú không bị unmount/mất focus.
            future: _todayRet.of(me.id, () => repo.today(me.id)),
            builder: (context, snap) {
              // Fetch lại thì vẽ tiếp ca cũ trong lúc chờ.
              final att = snap.data ?? _todayRet.value;
              if (att == null) {
                if (snap.hasError) {
                  return ErrorBanner(
                    message: 'Không tải được ca hiện tại.',
                    onRetry: _refresh,
                  );
                }
                if (snap.connectionState == ConnectionState.waiting) {
                  return const LoadingList(rows: 2);
                }
              }
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppGaps.s16),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        att?.shiftName ??
                            'Ca ${_shiftName(cur['code']!)}',
                        style: AppText.cardTitle,
                      ),
                      const SizedBox(height: AppGaps.s4),
                      Text(
                        'Ngày công ${cur['work_date']} · '
                        '${att == null ? 'Chưa vào' : att.checkOutAt == null ? 'Đang trực' : 'Đã chốt'}',
                        style: AppText.body,
                      ),
                      if (_err != null) ...[
                        const SizedBox(height: AppGaps.s8),
                        Text(_err!,
                            style: AppText.helper.copyWith(
                                color: AppColors.danger)),
                      ],
                      const SizedBox(height: AppGaps.s12),
                      if (att == null) ...[
                        TextField(
                          controller: _opening,
                          keyboardType:
                              TextInputType.number,
                          decoration: const InputDecoration(
                            labelText:
                                'Tiền đầu ca (VNĐ)',
                          ),
                        ),
                        const SizedBox(
                            height: AppGaps.s12),
                        PrimaryButton(
                          label: _busy
                              ? 'Đang vào…'
                              : 'Vào ca',
                          loading: _busy,
                          minHeight: 52,
                          onPressed: () async {
                            setState(() {
                              _busy = true;
                              _err = null;
                            });
                            try {
                              await repo.checkInShift(
                                me.id,
                                openingCash: int.tryParse(
                                        _opening.text
                                            .trim()) ??
                                    0,
                              );
                              if (mounted) {
                                _refresh();
                              }
                            } on Object catch (e) {
                              setState(() => _err =
                                  e is Exception
                                      ? e.toString()
                                      : 'Đã chấm ca này.');
                            } finally {
                              if (mounted) {
                                setState(
                                    () => _busy = false);
                              }
                            }
                          },
                        ),
                      ] else if (att.checkOutAt == null) ...[
                        TextField(
                          controller: _closing,
                          keyboardType:
                              TextInputType.number,
                          decoration: const InputDecoration(
                            labelText:
                                'Tiền cuối ca (VNĐ)',
                          ),
                        ),
                        const SizedBox(
                            height: AppGaps.s12),
                        TextField(
                          controller: _note,
                          maxLines: 2,
                          decoration: const InputDecoration(
                            labelText:
                                'Ghi chú bàn giao',
                          ),
                        ),
                        const SizedBox(
                            height: AppGaps.s12),
                        PrimaryButton(
                          label: _busy
                              ? 'Đang chốt…'
                              : 'Ra ca & chốt',
                          loading: _busy,
                          minHeight: 52,
                          onPressed: () async {
                            final messenger =
                                ScaffoldMessenger.of(context);
                            setState(() {
                              _busy = true;
                              _err = null;
                            });
                            try {
                              await repo.checkOutShift(
                                me.id,
                                closingCash: int.tryParse(
                                        _closing.text
                                            .trim()) ??
                                    0,
                                note: _note.text,
                              );
                              if (mounted) {
                                _refresh();
                                messenger
                                    .showSnackBar(
                                  const SnackBar(
                                      content: Text(
                                          'Đã chốt ca.')),
                                );
                              }
                            } on Object catch (e) {
                              setState(() => _err =
                                  e.toString());
                            } finally {
                              if (mounted) {
                                setState(
                                    () => _busy = false);
                              }
                            }
                          },
                        ),
                      ] else ...[
                        AppBadge.success(
                            'Đã chốt · Vào ${att.checkInAt ?? '—'}'),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: AppGaps.s16),
          FutureBuilder<String?>(
            future:
                _yesterdayRet.of(me.id, () => repo.yesterdayOpen(me.id)),
            builder: (context, snap) {
              if (snap.data == null) {
                return const SizedBox.shrink();
              }
              return Card(
                child: Padding(
                  padding:
                      const EdgeInsets.all(AppGaps.s12),
                  child: Text(
                    'Quên chốt ngày ${snap.data} — vào tab Tôi để chốt bù.',
                    style: AppText.body,
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: AppGaps.s16),
          const Text('7 ngày gần nhất',
              style: AppText.cardTitle),
          FutureBuilder<List<AttendanceRow>>(
            future: _historyRet.of(me.id, () => repo.history(me.id)),
            builder: (context, snap) {
              final rows =
                  snap.data ?? _historyRet.value ?? <AttendanceRow>[];
              if (snap.connectionState ==
                      ConnectionState.waiting &&
                  snap.data == null &&
                  _historyRet.value == null) {
                return const LoadingList(rows: 3);
              }
              if (rows.isEmpty) {
                return const EmptyView(
                  title: 'Chưa có ca nào',
                  hint: 'Bấm “Vào ca” ở trên để bắt đầu.',
                );
              }
              return Column(
                children: rows
                    .map((a) => Card(
                          child: ListTile(
                            title: Text(
                                '${a.shiftName} · ${a.workDate}'),
                            subtitle: Text(
                                '${a.checkInAt ?? '—'} → ${a.checkOutAt ?? 'đang trực'}'),
                            trailing:
                                a.checkOutAt == null
                                    ? AppBadge.info(
                                        'Đang trực')
                                    : AppBadge.success(
                                        'Đã chốt'),
                          ),
                        ))
                    .toList(),
              );
            },
          ),
        ],
      ),
    );
  }

  String _shiftName(String code) {
    switch (code) {
      case 'MORNING':
        return 'sáng';
      case 'AFTERNOON':
        return 'chiều';
      default:
        return 'đêm';
    }
  }
}
