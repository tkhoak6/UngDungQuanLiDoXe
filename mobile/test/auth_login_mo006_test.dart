import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/auth_messages.dart';
import 'package:parking_mobile/core/validators.dart';
import 'package:parking_mobile/data/pb_auth_remote.dart';
import 'package:parking_mobile/db/app_db.dart';
import 'package:parking_mobile/repos/auth_repo.dart';
import 'package:parking_mobile/repos/hybrid_auth_repo.dart';

/// MO-006: sửa login staff mobile (khoa01/khoa01 báo "sai mật khẩu" dù
/// desktop login OK). Pure-logic tests — không chạm sqflite (VM test
/// không có platform channel).
void main() {
  group('demoStaffSeeds (đồng bộ credential local 2 app)', () {
    test('chứa khoa01 khớp plaintext desktop', () {
      const seeds = AppDb.demoStaffSeeds;
      final khoa =
          seeds.where((s) => s.username == 'khoa01');
      expect(khoa, hasLength(1));
      expect(khoa.single.password, 'khoa01');
      expect(khoa.single.fullName.isNotEmpty, isTrue);
    });

    test('giữ staff01 cũ (không hồi quy)', () {
      final staff01 = AppDb.demoStaffSeeds
          .where((s) => s.username == 'staff01');
      expect(staff01, hasLength(1));
      expect(staff01.single.password, 'staff123');
    });

    test('usernames duy nhất + password qua Validators.password', () {
      const seeds = AppDb.demoStaffSeeds;
      final names = seeds.map((s) => s.username).toList();
      expect(names.toSet(), hasLength(names.length));
      for (final s in seeds) {
        expect(s.username.trim(), s.username,
            reason: 'username ${s.username} không được có khoảng trắng');
        expect(Validators.password(s.password), isNull,
            reason: 'password demo của ${s.username} phải ≥6 ký tự '
                'để qua validate form login');
      }
    });
  });

  group('resolveRemoteFailure (không nuốt NOT_FOUND local)', () {
    const remoteWrong =
        PbAuthFailure('WRONG_PASSWORD', 'Sai tài khoản hoặc mật khẩu.');
    const localNotFound = AuthException('NOT_FOUND', 'local 404');
    const localWrong = AuthException('WRONG_PASSWORD', 'local sai MK');
    const localLocked = AuthException('LOCKED', 'local khóa');

    test('remote WRONG + local NOT_FOUND → NOT_FOUND (đúng bản chất)', () {
      final out =
          HybridAuthRepo.resolveRemoteFailure(remoteWrong, localNotFound);
      expect(out.code, 'NOT_FOUND');
    });

    test('remote WRONG + local WRONG → giữ lỗi remote (gộp, bảo mật)', () {
      final out =
          HybridAuthRepo.resolveRemoteFailure(remoteWrong, localWrong);
      expect(out.code, 'WRONG_PASSWORD');
      expect(out.message, remoteWrong.message);
    });

    test('remote WRONG + local LOCKED → giữ lỗi remote', () {
      final out =
          HybridAuthRepo.resolveRemoteFailure(remoteWrong, localLocked);
      expect(out.code, 'WRONG_PASSWORD');
    });
  });

  group('friendlyAuthMessage', () {
    test('NOT_FOUND nói rõ phạm vi thiết bị + hướng xử lý', () {
      final msg = friendlyAuthMessage(
        const AuthException('NOT_FOUND', 'raw'),
      );
      expect(msg, contains('thiết bị'));
      expect(msg, isNot(contains('raw')));
    });

    test('WRONG_PASSWORD giữ copy cũ', () {
      expect(
        friendlyAuthMessage(const AuthException('WRONG_PASSWORD', 'x')),
        'Sai mật khẩu. Thử lại.',
      );
    });

    test('LOCKED + PHONE_TAKEN + fallback message gốc', () {
      expect(
        friendlyAuthMessage(const AuthException('LOCKED', 'x')),
        contains('khóa'),
      );
      expect(
        friendlyAuthMessage(const AuthException('PHONE_TAKEN', 'x')),
        contains('đăng nhập'),
      );
      expect(
        friendlyAuthMessage(const AuthException('CUSTOM_X', 'gốc giữ')),
        'gốc giữ',
      );
    });
  });
}
