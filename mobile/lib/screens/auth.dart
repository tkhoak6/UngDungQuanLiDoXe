import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/tokens.dart';
import '../core/validators.dart';
import '../repos/auth_repo.dart';
import '../state/providers.dart';
import '../widgets/ui.dart';

String _friendly(AuthException e) {
  switch (e.code) {
    case 'PHONE_TAKEN':
      return 'SĐT đã được đăng ký. Hãy đăng nhập.';
    case 'INVALID_PHONE':
      return 'Số điện thoại phải 10 số, bắt đầu bằng 0.';
    case 'WRONG_PASSWORD':
      return 'Sai mật khẩu. Thử lại.';
    case 'NOT_FOUND':
      return 'Tài khoản không tồn tại. Kiểm tra lại SĐT.';
    case 'LOCKED':
      return 'Tài khoản đã bị khóa — liên hệ quản trị viên.';
    default:
      return e.message;
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  bool _obscure = true;
  bool _loading = false;
  String? _userErr;
  String? _passErr;
  String? _banner;

  Future<void> _submit() async {
    final userErr = _user.text.trim().length < 3
        ? 'Nhập SĐT (khách) hoặc tên đăng nhập (nhân viên).'
        : null;
    final passErr = Validators.password(_pass.text);
    setState(() {
      _userErr = userErr;
      _passErr = passErr;
      _banner = null;
    });
    if (userErr != null || passErr != null) return;
    setState(() => _loading = true);
    try {
      final res = await ref
          .read(hybridAuthRepoProvider)
          .login(_user.text, _pass.text);
      ref.read(authSourceProvider.notifier).state = res.source;
      ref.read(sessionProvider.notifier).state = res.user;
    } on AuthException catch (e) {
      setState(() => _banner = _friendly(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Đăng nhập', style: AppText.appBar),
        actions: [
          IconButton(
            tooltip: 'Máy chủ',
            onPressed: () => context.push('/settings'),
            icon: const Icon(Icons.dns_outlined),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppGaps.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_banner != null)
              ErrorBanner(
                  message: _banner!, onRetry: () => setState(() {})),
            TextField(
              controller: _user,
              keyboardType: TextInputType.text,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'SĐT (khách) / Tên đăng nhập (nhân viên)',
                errorText: _userErr,
              ),
              onChanged: (_) =>
                  setState(() => _userErr = null),
            ),
            const SizedBox(height: AppGaps.s12),
            TextField(
              controller: _pass,
              obscureText: _obscure,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: 'Mật khẩu',
                errorText: _passErr,
                suffixIcon: IconButton(
                  tooltip: _obscure ? 'Hiện mật khẩu' : 'Ẩn mật khẩu',
                  onPressed: () =>
                      setState(() => _obscure = !_obscure),
                  icon: Icon(
                      _obscure ? Icons.visibility : Icons.visibility_off),
                ),
              ),
              onChanged: (_) =>
                  setState(() => _passErr = null),
            ),
            const SizedBox(height: AppGaps.s24),
            PrimaryButton(
                label: _loading ? 'Đang đăng nhập…' : 'Đăng nhập',
                loading: _loading,
                onPressed: _submit),
            const SizedBox(height: AppGaps.s12),
            SizedBox(
              height: 48,
              child: TextButton(
                onPressed: () => context.push('/register'),
                child: const Text('Chưa có tài khoản? Đăng ký bằng SĐT'),
              ),
            ),
            SizedBox(
              height: 48,
              child: TextButton(
                onPressed: () => context.go('/map'),
                child: const Text('Tiếp tục xem sơ đồ (không cần login)'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _phone = TextEditingController();
  final _name = TextEditingController();
  final _pass = TextEditingController();
  final _confirm = TextEditingController();
  bool _loading = false;
  String? _phoneErr;
  String? _nameErr;
  String? _passErr;
  String? _confirmErr;
  String? _banner;

  Future<void> _submit() async {
    final phoneErr = Validators.phone(_phone.text);
    final nameErr = Validators.fullName(_name.text);
    final passErr = Validators.password(_pass.text);
    final confirmErr =
        Validators.confirmPassword(_confirm.text, _pass.text);
    setState(() {
      _phoneErr = phoneErr;
      _nameErr = nameErr;
      _passErr = passErr;
      _confirmErr = confirmErr;
      _banner = null;
    });
    if (phoneErr != null ||
        nameErr != null ||
        passErr != null ||
        confirmErr != null) {
      return;
    }
    setState(() => _loading = true);
    try {
      final res =
          await ref.read(hybridAuthRepoProvider).registerCustomer(
                phone: _phone.text,
                password: _pass.text,
                fullName: _name.text,
              );
      ref.read(authSourceProvider.notifier).state = res.source;
      ref.read(sessionProvider.notifier).state = res.user;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Đăng ký thành công.')),
        );
      }
    } on AuthException catch (e) {
      setState(() => _banner = _friendly(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _phone.dispose();
    _name.dispose();
    _pass.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Đăng ký', style: AppText.appBar)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppGaps.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_banner != null)
              ErrorBanner(
                  message: _banner!, onRetry: () => setState(() {})),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: 'Số điện thoại (dùng để đăng nhập)',
                errorText: _phoneErr,
              ),
              onChanged: (_) =>
                  setState(() => _phoneErr = null),
            ),
            const SizedBox(height: AppGaps.s12),
            TextField(
              controller: _name,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Họ và tên',
                errorText: _nameErr,
              ),
              onChanged: (_) =>
                  setState(() => _nameErr = null),
            ),
            const SizedBox(height: AppGaps.s12),
            TextField(
              controller: _pass,
              obscureText: true,
              decoration: InputDecoration(
                labelText: 'Mật khẩu (≥6 ký tự)',
                errorText: _passErr,
              ),
              onChanged: (_) =>
                  setState(() => _passErr = null),
            ),
            const SizedBox(height: AppGaps.s12),
            TextField(
              controller: _confirm,
              obscureText: true,
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: 'Xác nhận mật khẩu',
                errorText: _confirmErr,
              ),
              onChanged: (_) =>
                  setState(() => _confirmErr = null),
            ),
            const SizedBox(height: AppGaps.s24),
            PrimaryButton(
              label: _loading ? 'Đang đăng ký…' : 'Đăng ký',
              loading: _loading,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}

class AdminBlockScreen extends ConsumerWidget {
  const AdminBlockScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Parking Mobile'),
        actions: [
          IconButton(
            tooltip: 'Máy chủ',
            onPressed: () => context.push('/settings'),
            icon: const Icon(Icons.dns_outlined),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(AppGaps.s24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.admin_panel_settings,
                size: 64, color: AppColors.primary),
            const SizedBox(height: AppGaps.s16),
            const Text(
              'Quản trị dùng bản desktop',
              style: AppText.cardTitle,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppGaps.s8),
            const Text(
              'Mobile V1 chưa hỗ trợ quản trị (P2). '
              'Vui lòng dùng app desktop.',
              style: AppText.body,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppGaps.s24),
            PrimaryButton(
              label: 'Đăng xuất',
              danger: true,
              onPressed: () {
                unawaited(
                    ref.read(hybridAuthRepoProvider).logoutRemote());
                ref.read(authSourceProvider.notifier).state = null;
                ref.read(sessionProvider.notifier).state = null;
              },
            ),
          ],
        ),
      ),
    );
  }
}
