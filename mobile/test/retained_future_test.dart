import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/core/retained_future.dart';

/// MO-013 — helper giữ Future qua rebuild (chống mất focus ô biển số).
void main() {
  group('RetainedFuture (MO-013)', () {
    test('tái dùng future qua nhiều lần of cùng key', () async {
      var calls = 0;
      final ret = RetainedFuture<List<int>>();
      Future<List<int>> load() async {
        calls++;
        await Future<void>.delayed(const Duration(milliseconds: 10));
        return <int>[1, 2];
      }

      final a = ret.of('k', load);
      final b = ret.of('k', load);
      expect(identical(a, b), isTrue);
      expect(await a, <int>[1, 2]);
      expect(ret.value, <int>[1, 2]);
      expect(ret.error, isNull);
      expect(calls, 1);
    });

    test('đổi key thì fetch lại', () async {
      var calls = 0;
      final ret = RetainedFuture<int>();
      Future<int> load() async {
        calls++;
        return calls;
      }

      expect(await ret.of('u1', load), 1);
      expect(await ret.of('u2', load), 2);
      expect(calls, 2);
      expect(ret.value, 2);
    });

    test('refresh fetch lại nhưng giữ value cũ trong lúc chờ', () async {
      var n = 0;
      final ret = RetainedFuture<int>();
      Future<int> load() async {
        n++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return n;
      }

      expect(await ret.of('k', load), 1);
      ret.refresh(load);
      expect(ret.value, 1); // value cũ còn đó trong lúc fetch mới đang chạy
      expect(await ret.of('k', load), 2);
      expect(ret.value, 2);
    });

    test('lỗi fetch ghi vào error, value cũ còn nguyên', () async {
      final ret = RetainedFuture<int>();
      Future<int> ok() async => 7;
      Future<int> fail() async => throw StateError('net');

      expect(await ret.of('k1', ok), 7);
      ret.refresh(fail);
      await expectLater(ret.of('k1', fail), throwsStateError);
      expect(ret.value, 7);
      expect(ret.error, isStateError);
    });
  });
}
