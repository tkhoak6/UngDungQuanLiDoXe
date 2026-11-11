import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/qr_ticket.dart';
import '../core/retained_future.dart';
import '../core/tokens.dart';
import '../core/validators.dart';
import '../models/entities.dart';
import '../repos/auth_repo.dart';
import '../repos/hybrid_auth_repo.dart';
import '../state/providers.dart';
import '../widgets/ui.dart';

/// Cá nhân (P1 một cột): SĐT read-only + họ tên + đổi MK + đăng xuất.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _name = TextEditingController();
  final _cur = TextEditingController();
  final _fresh = TextEditingController();
  final _confirm = TextEditingController();
  bool _dirty = false;
  bool _saving = false;
  String? _msg;

  @override
  void dispose() {
    _name.dispose();
    _cur.dispose();
    _fresh.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Chưa đăng nhập.'));
    }
    if (_name.text.isEmpty && !_dirty) _name.text = me.fullName;
    final highContrast = ref.watch(highContrastProvider);
    final source = ref.watch(authSourceProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cá nhân', style: AppText.appBar),
        actions: [
          IconButton(
            tooltip: 'Máy chủ',
            onPressed: () => context.push('/settings'),
            icon: const Icon(Icons.dns_outlined),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppGaps.s16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AppGaps.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Thông tin', style: AppText.cardTitle),
                  const SizedBox(height: AppGaps.s12),
                  Text(me.phone ?? me.username,
                      style: AppText.mono(14)),
                  const Text('Dùng để đăng nhập',
                      style: AppText.helper),
                  const SizedBox(height: AppGaps.s12),
                  TextField(
                    controller: _name,
                    decoration: const InputDecoration(
                        labelText: 'Họ và tên'),
                    onChanged: (_) =>
                        setState(() => _dirty = true),
                  ),
                  const SizedBox(height: AppGaps.s12),
                  PrimaryButton(
                    label: _saving ? 'Đang lưu…' : 'Lưu thay đổi',
                    loading: _saving,
                    onPressed: !_dirty
                        ? null
                        : () => _saveName(me),
                  ),
                  const Text(
                    'Muốn đổi số điện thoại — vui lòng ra quầy.',
                    style: AppText.helper,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppGaps.s24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AppGaps.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Đổi mật khẩu',
                      style: AppText.cardTitle),
                  const SizedBox(height: AppGaps.s12),
                  TextField(
                      controller: _cur,
                      obscureText: true,
                      decoration: const InputDecoration(
                          labelText: 'Mật khẩu hiện tại')),
                  const SizedBox(height: AppGaps.s12),
                  TextField(
                      controller: _fresh,
                      obscureText: true,
                      decoration: const InputDecoration(
                          labelText: 'Mật khẩu mới (≥6 ký tự)')),
                  const SizedBox(height: AppGaps.s12),
                  TextField(
                      controller: _confirm,
                      obscureText: true,
                      decoration: const InputDecoration(
                          labelText: 'Xác nhận mật khẩu mới')),
                  const SizedBox(height: AppGaps.s12),
                  PrimaryButton(
                    label: 'Đổi mật khẩu',
                    onPressed: () => _changePassword(me),
                  ),
                ],
              ),
            ),
          ),
          if (_msg != null) ...[
            const SizedBox(height: AppGaps.s12),
            Text(_msg!, style: AppText.body),
          ],
          const SizedBox(height: AppGaps.s24),
          Row(
            children: [
              const Text('Chế độ: ', style: AppText.helper),
              source == AuthSource.local
                  ? AppBadge.warning('Ngoại tuyến (local)')
                  : AppBadge.success('Online (PocketBase)'),
            ],
          ),
          const SizedBox(height: AppGaps.s8),
          SwitchListTile(
            title: const Text('Tương phản cao'),
            value: highContrast,
            onChanged: (v) => ref
                .read(highContrastProvider.notifier)
                .state = v,
          ),
          PrimaryButton(
            label: 'Đăng xuất',
            danger: true,
            onPressed: () {
              unawaited(
                  ref.read(hybridAuthRepoProvider).logoutRemote());
              ref.read(authSourceProvider.notifier).state = null;
              ref.read(sessionProvider.notifier).state = null;
              context.go('/map');
            },
          ),
          const SizedBox(height: AppGaps.s8),
          const Text('Parking Mobile V1 · build 1.0.0+1',
              style: AppText.helper, textAlign: TextAlign.center),
        ],
      ),
    );
  }

  Future<void> _saveName(AppUser me) async {
    final err = Validators.fullName(_name.text);
    if (err != null) {
      setState(() => _msg = err);
      return;
    }
    setState(() => _saving = true);
    try {
      final updated = await ref
          .read(authRepoProvider)
          .updateProfileName(me.id, _name.text);
      ref.read(sessionProvider.notifier).state = updated;
      setState(() {
        _dirty = false;
        _msg = 'Đã cập nhật họ tên.';
      });
    } on AuthException catch (e) {
      setState(() => _msg = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _changePassword(AppUser me) async {
    final err = Validators.newPassword(_fresh.text, _cur.text) ??
        Validators.confirmPassword(_confirm.text, _fresh.text);
    if (err != null) {
      setState(() => _msg = err);
      return;
    }
    try {
      await ref.read(authRepoProvider).changePassword(
            userId: me.id,
            current: _cur.text,
            fresh: _fresh.text,
          );
      setState(() => _msg = 'Đổi mật khẩu thành công.');
    } on AuthException catch (e) {
      setState(() => _msg = e.message);
    }
  }
}

/// Tôi (staff): hồ sơ gọn + lịch sử ca mình + đồng bộ + đăng xuất.
class StaffMeScreen extends ConsumerStatefulWidget {
  const StaffMeScreen({super.key});

  @override
  ConsumerState<StaffMeScreen> createState() => _StaffMeScreenState();
}

class _StaffMeScreenState extends ConsumerState<StaffMeScreen> {
  int _reload = 0;
  final _key = TextEditingController();
  String? _keyMsg;
  bool _keySaving = false;
  // MO-013: ô dán khóa nằm trong FutureBuilder — giữ future để setState
  // (lưu/xóa khóa, đồng bộ…) không remount ô nhập.
  final _hasKeyRet = RetainedFuture<bool>();

  /// Tải lại trạng thái khóa sau lưu/xóa. Giữ value cũ lúc chờ.
  void _refreshKey() {
    if (!mounted) return;
    setState(() {
      _hasKeyRet.refresh(() => ref.read(qrKeyStoreProvider).hasKey);
    });
  }

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  Future<void> _saveKey() async {
    final v = _key.text.trim();
    if (!QrTicket.isValidKeyB64(v)) {
      setState(() => _keyMsg =
          'Khóa không hợp lệ (cần base64 đúng 256-bit). Hỏi quản trị viên.');
      return;
    }
    setState(() {
      _keySaving = true;
      _keyMsg = null;
    });
    try {
      await ref.read(qrKeyStoreProvider).saveKey(keyB64: v);
      _key.clear();
      if (mounted) {
        _refreshKey();
        setState(() => _keyMsg = 'Đã lưu khóa QR trên máy này.');
      }
    } finally {
      if (mounted) setState(() => _keySaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // ignore: unused_local_variable
    final reload = _reload;
    final me = ref.watch(sessionProvider);
    if (me == null) {
      return const Center(child: Text('Chưa đăng nhập.'));
    }
    final repo = ref.watch(staffRepoProvider);
    final sync = ref.watch(syncQueueProvider);
    final canReport =
        resolvePerm(roleName: me.roleName, perms: me.permissions, key: 'report_self') ==
            1;
    final source = ref.watch(authSourceProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tôi', style: AppText.appBar),
        actions: [
          IconButton(
            tooltip: 'Máy chủ',
            onPressed: () => context.push('/settings'),
            icon: const Icon(Icons.dns_outlined),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppGaps.s16),
        children: [
          Card(
            child: ListTile(
              title: Text(me.fullName, style: AppText.cardTitle),
              subtitle: Text(
                  '${me.roleName} · ${me.phone ?? me.username}'),
              trailing: source == AuthSource.local
                  ? AppBadge.warning('Local')
                  : AppBadge.success('Online'),
            ),
          ),
          const SizedBox(height: AppGaps.s16),
          if (canReport) ...[
            const Text('Lịch sử ca của tôi',
                style: AppText.cardTitle),
            FutureBuilder<List<AttendanceRow>>(
              future: repo.history(me.id),
              builder: (context, snap) {
                if (snap.connectionState ==
                    ConnectionState.waiting) {
                  return const LoadingList(rows: 2);
                }
                final rows = snap.data ?? [];
                if (rows.isEmpty) {
                  return const EmptyView(
                    title: 'Chưa có ca nào',
                    hint: 'Chấm công ở tab Chấm công.',
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
                              trailing: a.checkOutAt == null
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
          const SizedBox(height: AppGaps.s16),
          const Text('Khóa QR (máy này)', style: AppText.cardTitle),
          const SizedBox(height: AppGaps.s8),
          FutureBuilder<bool>(
            // MO-013: future giữ qua rebuild — setState không remount ô khóa.
            future: _hasKeyRet.of(
                'qr-key', () => ref.watch(qrKeyStoreProvider).hasKey),
            builder: (context, snap) {
              final has = snap.data ?? _hasKeyRet.value ?? false;
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(AppGaps.s12),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              has
                                  ? 'Đã có khóa — quét QR offline được.'
                                  : 'Chưa có khóa — quét QR sẽ báo “chưa xác thực”.',
                              style: AppText.body,
                            ),
                          ),
                          const SizedBox(width: AppGaps.s8),
                          has
                              ? AppBadge.success('Có khóa')
                              : AppBadge.warning('Chưa có'),
                        ],
                      ),
                      const SizedBox(height: AppGaps.s8),
                      TextField(
                        controller: _key,
                        decoration: const InputDecoration(
                          labelText: 'Dán khóa (base64 từ quản trị viên)',
                          helperText:
                              'Chỉ nhập 1 lần khi có mạng. Khóa lưu trong Keystore, không hiện lại.',
                        ),
                      ),
                      if (_keyMsg != null) ...[
                        const SizedBox(height: AppGaps.s4),
                        Text(_keyMsg!, style: AppText.helper),
                      ],
                      const SizedBox(height: AppGaps.s8),
                      Row(
                        children: [
                          Expanded(
                            child: SizedBox(
                              height: 48,
                              child: OutlinedButton(
                                onPressed: _keySaving
                                    ? null
                                    : _saveKey,
                                child: Text(_keySaving
                                    ? 'Đang lưu…'
                                    : 'Lưu khóa'),
                              ),
                            ),
                          ),
                          if (has) ...[
                            const SizedBox(width: AppGaps.s8),
                            SizedBox(
                              height: 48,
                              child: TextButton(
                                onPressed: () async {
                                  await ref
                                      .read(qrKeyStoreProvider)
                                      .clear();
                                  if (mounted) {
                                    _refreshKey();
                                    setState(() => _keyMsg =
                                        'Đã xóa khóa trên máy này.');
                                  }
                                },
                                child: const Text('Xóa'),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: AppGaps.s16),
          FutureBuilder<int>(
            future: sync.pending(),
            builder: (context, snap) {
              final q = snap.data ?? 0;
              return PrimaryButton(
                label: 'Đồng bộ ngay ($q)',
                onPressed: () async {
                  await sync.pushNow();
                  if (mounted) setState(() => _reload++);
                },
              );
            },
          ),
          const SizedBox(height: AppGaps.s12),
          PrimaryButton(
            label: 'Đăng xuất',
            danger: true,
            onPressed: () {
              unawaited(
                  ref.read(hybridAuthRepoProvider).logoutRemote());
              ref.read(authSourceProvider.notifier).state = null;
              ref.read(sessionProvider.notifier).state = null;
              context.go('/map');
            },
          ),
        ],
      ),
    );
  }
}
