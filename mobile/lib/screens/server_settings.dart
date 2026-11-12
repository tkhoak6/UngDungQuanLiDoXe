import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/tokens.dart';
import '../data/pb_client.dart';
import '../repos/hybrid_auth_repo.dart';
import '../state/providers.dart';
import '../state/session_actions.dart';
import '../widgets/ui.dart';

/// Cài đặt máy chủ PocketBase + trạng thái kết nối (MO-003).
/// Dùng chung IPC/config hiện có: URL lưu SharedPreferences (`pb_url`).
/// Không cần đăng nhập — guest cũng mở được để trỏ đúng server trước login.
class ServerSettingsScreen extends ConsumerWidget {
  const ServerSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pbAsync = ref.watch(pbClientProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Máy chủ & Trạng thái', style: AppText.appBar),
      ),
      body: pbAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.all(AppGaps.s16),
          child: LoadingList(),
        ),
        error: (_, __) => Padding(
          padding: const EdgeInsets.all(AppGaps.s16),
          child: ErrorBanner(
            message: 'Không khởi tạo được kết nối.',
            onRetry: () => ref.invalidate(pbClientProvider),
          ),
        ),
        data: (pb) => _SettingsForm(pb: pb),
      ),
    );
  }
}

class _SettingsForm extends ConsumerStatefulWidget {
  const _SettingsForm({required this.pb});

  final PbClient pb;

  @override
  ConsumerState<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends ConsumerState<_SettingsForm> {
  late final TextEditingController _url;
  bool _saving = false;
  bool _testing = false;
  PbHealth? _health;
  String? _urlErr;
  String? _msg;

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: widget.pb.baseUrl);
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _health = null;
    });
    final h = await widget.pb.checkHealth();
    if (mounted) {
      setState(() {
        _testing = false;
        _health = h;
      });
    }
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _urlErr = null;
      _msg = null;
    });
    try {
      await widget.pb.setUrl(_url.text);
      // Phiên cũ đã bị xóa khi đổi URL (chống rò token sang server mới).
      // MO-018: thu hồi luôn remember của máy — đổi máy chủ phải login
      // lại, lần mở sau không tự resume phiên cũ.
      await ref.read(hybridAuthRepoProvider).clearRemembered();
      ref.read(sessionProvider.notifier).state = null;
      ref.read(authSourceProvider.notifier).state = null;
      if (mounted) {
        setState(() {
          _msg = 'Đã lưu. Hãy đăng nhập lại với máy chủ mới.';
          _health = null;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Đã đổi máy chủ.')),
        );
      }
    } on PbConfigException catch (e) {
      setState(() => _urlErr = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _resetDefault() async {
    _url.text = PbClient.defaultUrl;
    await _save();
  }

  @override
  Widget build(BuildContext context) {
    final offline = ref.watch(offlineProvider).valueOrNull ?? false;
    final source = ref.watch(authSourceProvider);
    final session = ref.watch(sessionProvider);
    final health = _health;

    return ListView(
      padding: const EdgeInsets.all(AppGaps.s16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppGaps.s16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Máy chủ PocketBase', style: AppText.cardTitle),
                const SizedBox(height: AppGaps.s12),
                TextField(
                  controller: _url,
                  keyboardType: TextInputType.url,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _save(),
                  decoration: InputDecoration(
                    labelText: 'URL máy chủ',
                    hintText: PbClient.defaultUrl,
                    errorText: _urlErr,
                  ),
                  onChanged: (_) => setState(() => _urlErr = null),
                ),
                const SizedBox(height: AppGaps.s12),
                Row(
                  children: [
                    Expanded(
                      child: PrimaryButton(
                        label: _testing ? 'Đang kiểm tra…' : 'Kiểm tra',
                        loading: _testing,
                        onPressed: _test,
                      ),
                    ),
                    const SizedBox(width: AppGaps.s8),
                    Expanded(
                      child: PrimaryButton(
                        label: _saving ? 'Đang lưu…' : 'Lưu',
                        loading: _saving,
                        onPressed: _save,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppGaps.s8),
                SizedBox(
                  height: 48,
                  child: TextButton(
                    onPressed: _saving ? null : _resetDefault,
                    child: const Text('Khôi phục mặc định'),
                  ),
                ),
                if (health != null) ...[
                  const SizedBox(height: AppGaps.s8),
                  health.ok
                      ? AppBadge.success('Online: ${health.message}')
                      : AppBadge.danger('Lỗi: ${health.message}'),
                ],
                if (_msg != null) ...[
                  const SizedBox(height: AppGaps.s8),
                  Text(_msg!, style: AppText.helper),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: AppGaps.s16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppGaps.s16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Trạng thái', style: AppText.cardTitle),
                const SizedBox(height: AppGaps.s12),
                _row(
                  'Mạng',
                  offline
                      ? AppBadge.warning('Ngoại tuyến')
                      : AppBadge.success('Có mạng'),
                ),
                const SizedBox(height: AppGaps.s8),
                _row(
                  'Phiên',
                  session == null
                      ? AppBadge.info('Chưa đăng nhập')
                      : source == AuthSource.local
                          ? AppBadge.warning('Local (ngoại tuyến)')
                          : AppBadge.success('Online (PocketBase)'),
                ),
                if (session != null) ...[
                  const SizedBox(height: AppGaps.s8),
                  Text(
                    '${session.fullName} · ${session.phone ?? session.username}',
                    style: AppText.body,
                  ),
                  const SizedBox(height: AppGaps.s8),
                  SizedBox(
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        signOut(ref);
                        context.go('/map');
                      },
                      icon: const Icon(Icons.logout),
                      label: const Text('Đăng xuất'),
                    ),
                  ),
                ],
                if (widget.pb.hasSession &&
                    widget.pb.savedUsername != null) ...[
                  const SizedBox(height: AppGaps.s8),
                  Text(
                    'Phiên PB đã lưu: ${widget.pb.savedUsername}',
                    style: AppText.helper,
                  ),
                ],
                const SizedBox(height: AppGaps.s8),
                const Text(
                  'Rớt mạng app tự dùng dữ liệu local (sqflite) — '
                  'đăng nhập/đăng ký vẫn hoạt động.',
                  style: AppText.helper,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _row(String label, Widget badge) {
    return Row(
      children: [
        SizedBox(width: 72, child: Text(label, style: AppText.body)),
        badge,
      ],
    );
  }
}
