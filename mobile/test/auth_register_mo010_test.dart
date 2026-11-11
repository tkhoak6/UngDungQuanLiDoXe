import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/validators.dart';
import 'package:parking_mobile/data/pb_auth_remote.dart';
import 'package:parking_mobile/data/pb_client.dart';
import 'package:parking_mobile/db/app_db.dart';
import 'package:parking_mobile/models/entities.dart';
import 'package:parking_mobile/repos/auth_repo.dart';
import 'package:parking_mobile/repos/hybrid_auth_repo.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// MO-010: đăng ký offline-first — local trước, server sync nền.
///
/// - Luôn tạo tài khoản local + trả [AuthSource.local] ngay, KỂ CẢ khi
///   server rớt mạng / trả lỗi → không banner đỏ chặn luồng.
/// - Chỉ lỗi local (SĐT trùng trên máy, validation) mới throw.
/// - Pure/in-memory: không chạm sqflite (VM test không có channel),
///   không chạm mạng (remote inject giả lập).
class _FakeAuthRepo extends AuthRepo {
  _FakeAuthRepo() : super(AppDb.instance);

  final Map<String, AppUser> _users = {};
  final Map<String, String> _passwords = {};
  int _nextId = 1;

  @override
  Future<AppUser> registerCustomer({
    required String phone,
    required String password,
    required String fullName,
  }) async {
    final p = phone.trim();
    if (Validators.phone(p) != null) {
      throw const AuthException('INVALID_PHONE', 'SĐT chưa đúng.');
    }
    if (Validators.password(password) != null) {
      throw const AuthException('WEAK_PASSWORD', 'Mật khẩu ≥6 ký tự.');
    }
    if (Validators.fullName(fullName.trim()) != null) {
      throw const AuthException('INVALID_NAME', 'Họ tên chưa đúng.');
    }
    if (_users.containsKey(p)) {
      throw const AuthException('PHONE_TAKEN', 'SĐT đã được đăng ký.');
    }
    final user = AppUser(
      id: _nextId++,
      username: p,
      fullName: fullName.trim(),
      phone: p,
      address: null,
      startDate: null,
      roleId: 4,
      roleName: 'customer',
      permissions: StaffPermissions.defaults,
      isActive: 1,
    );
    _users[p] = user;
    _passwords[p] = password;
    return user;
  }

  @override
  Future<AppUser> login(String username, String password) async {
    final u = username.trim();
    final user = _users[u];
    if (user == null) {
      throw const AuthException('NOT_FOUND', 'Không tồn tại.');
    }
    if (_passwords[u] != password) {
      throw const AuthException('WRONG_PASSWORD', 'Sai mật khẩu.');
    }
    return user;
  }
}

Future<PbClient?> _noPb() async => null;

/// Loader trả về PbClient "giả online" (không init mạng, remote inject
/// qua [HybridAuthRepo.remoteRegister] nên không có traffic thật).
Future<PbClient?> _fakePb() async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  return PbClient(prefs);
}

void main() {
  group('MO-010 register offline-first', () {
    test('offline (không PB client): tạo local + vào app được', () async {
      final repo = HybridAuthRepo(_FakeAuthRepo(), AppDb.instance, _noPb);

      final res = await repo.registerCustomer(
        phone: '0901111222',
        password: 'matkhau1',
        fullName: 'Nguyen Van A',
      );

      expect(res.user.username, '0901111222');
      expect(res.source, AuthSource.local);
    });

    test('online rớt mạng (PbOfflineException): vẫn pass local', () async {
      var syncAttempted = false;
      final repo = HybridAuthRepo(
        _FakeAuthRepo(),
        AppDb.instance,
        _fakePb,
        remoteRegister: (
          PbClient pb, {
          required String phone,
          required String password,
          required String fullName,
        }) async {
          syncAttempted = true;
          throw const PbOfflineException();
        },
      );

      final res = await repo.registerCustomer(
        phone: '0901111333',
        password: 'matkhau1',
        fullName: 'Tran Thi B',
      );

      expect(res.user.username, '0901111333');
      expect(res.source, AuthSource.local);
      // Sync nền đã chạy (fire-and-forget) nhưng không ném ra ngoài.
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(syncAttempted, isTrue);
    });

    test('online server lỗi (PB_ERROR): vẫn pass local, không throw',
        () async {
      final repo = HybridAuthRepo(
        _FakeAuthRepo(),
        AppDb.instance,
        _fakePb,
        remoteRegister: (
          PbClient pb, {
          required String phone,
          required String password,
          required String fullName,
        }) async {
          throw const PbAuthFailure(
            'PB_ERROR',
            'Không kết nối được máy chủ. Thử lại sau.',
          );
        },
      );

      final res = await repo.registerCustomer(
        phone: '0901111444',
        password: 'matkhau1',
        fullName: 'Le Van C',
      );

      expect(res.user.username, '0901111444');
      expect(res.source, AuthSource.local);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      // Không throw → test pass tới đây là đạt.
    });

    test('trùng SĐT trên máy: vẫn báo PHONE_TAKEN (banner đỏ đúng chỗ)',
        () async {
      final repo = HybridAuthRepo(_FakeAuthRepo(), AppDb.instance, _noPb);
      await repo.registerCustomer(
        phone: '0901111555',
        password: 'matkhau1',
        fullName: 'Pham Van D',
      );

      expect(
        () => repo.registerCustomer(
          phone: '0901111555',
          password: 'matkhau2',
          fullName: 'Pham Van E',
        ),
        throwsA(
          isA<AuthException>().having((e) => e.code, 'code', 'PHONE_TAKEN'),
        ),
      );
    });

    test('SĐT sai định dạng: báo INVALID_PHONE trước khi đụng server',
        () async {
      var remoteHit = false;
      final repo = HybridAuthRepo(
        _FakeAuthRepo(),
        AppDb.instance,
        _noPb,
        remoteRegister: (
          PbClient pb, {
          required String phone,
          required String password,
          required String fullName,
        }) async {
          remoteHit = true;
          throw const PbOfflineException();
        },
      );

      await expectLater(
        () => repo.registerCustomer(
          phone: '123',
          password: 'matkhau1',
          fullName: 'Nguyen Van F',
        ),
        throwsA(
          isA<AuthException>().having((e) => e.code, 'code', 'INVALID_PHONE'),
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 100));
      // Validation fail → không tạo local, không sync nền.
      expect(remoteHit, isFalse);
    });
  });
}
