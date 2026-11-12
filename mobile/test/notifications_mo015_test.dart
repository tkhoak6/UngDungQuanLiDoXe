// MO-015 — Test logic lập lịch thông báo local V1 (pure, không plugin).
library;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/notifications/notification_config.dart';
import 'package:parking_mobile/notifications/notification_content.dart';
import 'package:parking_mobile/notifications/notification_logic.dart';
import 'package:parking_mobile/notifications/notification_scheduler.dart';

void main() {
  group('E1 daysLeft + milestone', () {
    test('cùng ngày → 0 (ngày hết), sau 3 ngày → 3, quá hạn → âm', () {
      final now = DateTime(2026, 11, 12, 10);
      expect(
          daysLeft(
              endDate: DateTime(2026, 11, 12), now: now),
          0);
      expect(
          daysLeft(
              endDate: DateTime(2026, 11, 15), now: now),
          3);
      expect(
          daysLeft(
              endDate: DateTime(2026, 11, 10), now: now),
          -2);
    });

    test('chỉ bắn D-3/D-0 + status active', () {
      expect(e1Milestone(status: 'active', daysLeftValue: 3), 'd3');
      expect(e1Milestone(status: 'active', daysLeftValue: 0), 'd0');
      expect(e1Milestone(status: 'active', daysLeftValue: 2), isNull);
      expect(e1Milestone(status: 'active', daysLeftValue: 1), isNull);
      expect(e1Milestone(status: 'pending', daysLeftValue: 3), isNull);
      expect(e1Milestone(status: 'expired', daysLeftValue: 0), isNull);
    });

    test('planPassSweep: tối đa 2/vé/vòng đời qua dedupe key', () {
      final now = DateTime(2026, 11, 12, 7);
      List<SweepAction> run(Set<String> sent) => planPassSweep(
            passes: const [
              PassSweepItem(
                passCode: 'MT-1',
                plate: '51H-1',
                endDateYmd: '2026-11-15',
                price: 100,
                status: 'active',
              ),
            ],
            now: now,
            sentKeys: sent,
          );
      expect(run({}).length, 1);
      // Đã gửi d3 → không bắn lại.
      expect(run({'e1.MT-1.2026-11-15.d3'}), isEmpty);
      // Gia hạn (end_date mới) → bắn lại chu kỳ mới.
      final renewed = planPassSweep(
        passes: const [
          PassSweepItem(
            passCode: 'MT-1',
            plate: '51H-1',
            endDateYmd: '2026-12-15',
            price: 100,
            status: 'active',
          ),
        ],
        now: DateTime(2026, 12, 12, 7),
        sentKeys: {'e1.MT-1.2026-11-15.d3'},
      );
      expect(renewed.length, 1);
    });

    test('planPassSweep: ≥2 vé cùng mốc → gộp 1 summary', () {
      final now = DateTime(2026, 11, 12, 7);
      final out = planPassSweep(
        passes: const [
          PassSweepItem(
              passCode: 'MT-1',
              plate: '51H-1',
              endDateYmd: '2026-11-15',
              price: 100,
              status: 'active'),
          PassSweepItem(
              passCode: 'MT-2',
              plate: '51H-2',
              endDateYmd: '2026-11-15',
              price: 100,
              status: 'active'),
        ],
        now: now,
        sentKeys: const {},
      );
      expect(out.length, 1);
      expect(out.first.body, contains('+1 vé khác'));
      expect(out.first.payload.deepLink, NotifConfig.linkPasses);
    });

    test('planPassSweep: quiet-hours → không push', () {
      final out = planPassSweep(
        passes: const [
          PassSweepItem(
              passCode: 'MT-1',
              plate: '51H-1',
              endDateYmd: '2026-11-12',
              price: 100,
              status: 'active'),
        ],
        now: DateTime(2026, 11, 12, 23),
        sentKeys: const {},
      );
      expect(out, isEmpty);
    });
  });

  group('E2 fire time + quiet bypass-silent', () {
    test('bắn lúc time_from − 20p', () {
      final fire = e2FireTime(
        start: DateTime(2026, 11, 12, 10),
        createdNow: DateTime(2026, 11, 12, 8),
      );
      expect(fire, DateTime(2026, 11, 12, 9, 40));
    });

    test('tạo muộn (<20p) → bắn sau 30s', () {
      final created = DateTime(2026, 11, 12, 9, 50);
      final fire = e2FireTime(
        start: DateTime(2026, 11, 12, 10),
        createdNow: created,
      );
      expect(fire, created.add(const Duration(seconds: 30)));
    });

    test('E2 trong quiet → silentBypass; E1 → deferToMorning', () {
      final quiet = DateTime(2026, 11, 12, 23, 30);
      expect(quietBehavior(NotifEvent.e2, quiet),
          QuietBehavior.silentBypass);
      expect(quietBehavior(NotifEvent.e1, quiet),
          QuietBehavior.deferToMorning);
      final day = DateTime(2026, 11, 12, 10);
      expect(quietBehavior(NotifEvent.e4, day),
          QuietBehavior.normalOrDefer);
    });

    test('deferToMorning → 06:05 hôm sau', () {
      expect(
        deferToMorning(DateTime(2026, 11, 12, 23, 30)),
        DateTime(2026, 11, 13, 6, 5),
      );
    });
  });

  group('E4 fire time + sweep', () {
    test('end + 30p; ca đêm end 06:00 → 06:30', () {
      expect(
        e4FireTime(
            endHm: '14:00',
            workDate: DateTime(2026, 11, 12)),
        DateTime(2026, 11, 12, 14, 30),
      );
      expect(
        e4FireTime(
            endHm: '06:00',
            workDate: DateTime(2026, 11, 11),
            endsNextDay: true),
        DateTime(2026, 11, 12, 6, 30),
      );
    });

    test('chưa tới giờ / đã chốt / đã gửi → không bắn', () {
      const pending = ShiftSweepItem(
        attendanceId: 7,
        shiftName: 'Ca sáng',
        endHm: '14:00',
        rangeHm: '06:00–14:00',
        checkOutAt: null,
        workDateYmd: '2026-11-12',
      );
      expect(
          planShiftSweep(
            shifts: [pending],
            now: DateTime(2026, 11, 12, 10),
            sentKeys: const {},
          ),
          isEmpty);
      expect(
          planShiftSweep(
            shifts: [pending],
            now: DateTime(2026, 11, 12, 15),
            sentKeys: const {'e4.7'},
          ),
          isEmpty);
      const closed = ShiftSweepItem(
        attendanceId: 7,
        shiftName: 'Ca sáng',
        endHm: '14:00',
        rangeHm: '06:00–14:00',
        checkOutAt: '2026-11-12 14:05:00',
        workDateYmd: '2026-11-12',
      );
      expect(
          planShiftSweep(
            shifts: [closed],
            now: DateTime(2026, 11, 12, 15),
            sentKeys: const {},
          ),
          isEmpty);
    });

    test('quá end+30p → bắn 1 lần, deep-link attendance', () {
      final out = planShiftSweep(
        shifts: const [
          ShiftSweepItem(
            attendanceId: 7,
            shiftName: 'Ca sáng',
            endHm: '14:00',
            rangeHm: '06:00–14:00',
            checkOutAt: null,
            workDateYmd: '2026-11-12',
          ),
        ],
        now: DateTime(2026, 11, 12, 15),
        sentKeys: const {},
      );
      expect(out.length, 1);
      expect(out.first.payload.deepLink, NotifConfig.linkAttendance);
      expect(out.first.title, contains('Ca sáng'));
    });
  });

  group('E3 cooldown toast 15p', () {
    test('lần đầu hiện; trong 15p không hiện lại; sau 15p hiện', () {
      final now = DateTime(2026, 11, 12, 10);
      expect(
          shouldShowFullToast(
              zoneCode: 'A', now: now, lastShownMsByZone: const {}),
          isTrue);
      final shown = now.millisecondsSinceEpoch;
      expect(
          shouldShowFullToast(
            zoneCode: 'A',
            now: now.add(const Duration(minutes: 14)),
            lastShownMsByZone: {'A': shown},
          ),
          isFalse);
      expect(
          shouldShowFullToast(
            zoneCode: 'A',
            now: now.add(const Duration(minutes: 15)),
            lastShownMsByZone: {'A': shown},
          ),
          isTrue);
      // Zone khác không ảnh hưởng.
      expect(
          shouldShowFullToast(
            zoneCode: 'B',
            now: now.add(const Duration(minutes: 1)),
            lastShownMsByZone: {'A': shown},
          ),
          isTrue);
    });
  });

  group('Quyền + fallback banner (spec §5)', () {
    test('rationale tối đa 2 lần', () {
      expect(shouldShowRationale(0), isTrue);
      expect(shouldShowRationale(1), isTrue);
      expect(shouldShowRationale(2), isFalse);
      expect(shouldShowRationale(5), isFalse);
    });

    test('fallback banner: denied + chưa đóng/dóng quá 7 ngày → hiện', () {
      final now = DateTime(2026, 11, 12, 10);
      expect(
          shouldShowFallbackBanner(
              denied: false, dismissedAtMs: null, now: now),
          isFalse);
      expect(
          shouldShowFallbackBanner(
              denied: true, dismissedAtMs: null, now: now),
          isTrue);
      expect(
          shouldShowFallbackBanner(
            denied: true,
            dismissedAtMs:
                now.subtract(const Duration(days: 3)).millisecondsSinceEpoch,
            now: now,
          ),
          isFalse);
      expect(
          shouldShowFallbackBanner(
            denied: true,
            dismissedAtMs:
                now.subtract(const Duration(days: 8)).millisecondsSinceEpoch,
            now: now,
          ),
          isTrue);
    });
  });

  group('Deep-link tap → route canonical theo role', () {
    test('/passes → customer /c/passes, staff → attendance', () {
      expect(resolveTapLink('/passes', role: 'customer'), '/c/passes');
      expect(resolveTapLink('/passes?highlight=MT-1', role: 'customer'),
          '/c/passes?highlight=MT-1');
      expect(resolveTapLink('/passes', role: 'staff'), '/s/attendance');
    });

    test('/reservations?code= → /c/reservations?code=', () {
      expect(resolveTapLink('/reservations?code=R-ABC', role: 'customer'),
          '/c/reservations?code=R-ABC');
    });

    test('/staff/attendance + /map', () {
      expect(resolveTapLink('/staff/attendance', role: 'staff'),
          '/s/attendance');
      expect(resolveTapLink('/map', role: 'customer'), '/c/map');
      expect(resolveTapLink('/map', role: 'staff'), '/s/checkin');
    });
  });

  group('Payload encode/decode', () {
    test('round-trip giữ event/code/link', () {
      final p = NotifPayload(
        event: NotifEvent.e2,
        entityCode: 'R-ABC',
        deepLink: '/reservations?code=R-ABC',
        scheduledAt: DateTime(2026, 11, 12, 9, 40),
      );
      final back = NotifPayload.decode(p.encode());
      expect(back?.event, NotifEvent.e2);
      expect(back?.entityCode, 'R-ABC');
      expect(back?.deepLink, '/reservations?code=R-ABC');
    });

    test('payload lạ → null', () {
      expect(NotifPayload.decode(null), isNull);
      expect(NotifPayload.decode('event=EX;link=/x'), isNull);
    });
  });

  group('Copy VN + quiet-hours', () {
    test('E1 d3/d0 đúng tone', () {
      final d3 = e1Copy(
          passCode: 'MT-1',
          plate: '51H-1',
          endDateYmd: '2026-11-15',
          price: 4500000,
          daysLeft: 3);
      expect(d3.title, 'Vé tháng sắp hết hạn');
      expect(d3.body, contains('sau 3 ngày'));
      final d0 = e1Copy(
          passCode: 'MT-1',
          plate: '51H-1',
          endDateYmd: '2026-11-12',
          price: 4500000,
          daysLeft: 0);
      expect(d0.title, 'Vé tháng hết hạn hôm nay');
    });

    test('quiet 22:00–06:00 (qua đêm)', () {
      expect(QuietHours.isQuiet(const TimeOfDay(hour: 22, minute: 0)),
          isTrue);
      expect(QuietHours.isQuiet(const TimeOfDay(hour: 5, minute: 59)),
          isTrue);
      expect(QuietHours.isQuiet(const TimeOfDay(hour: 6, minute: 0)),
          isFalse);
      expect(QuietHours.isQuiet(const TimeOfDay(hour: 21, minute: 59)),
          isFalse);
    });

    test('stableIdFor tách dải theo event', () {
      final e1 = stableIdFor(NotifEvent.e1, 'MT-1');
      final e2 = stableIdFor(NotifEvent.e2, 'MT-1');
      final e4 = stableIdFor(NotifEvent.e4, 'MT-1');
      expect(e1 ~/ 10000, 1);
      expect(e2 ~/ 10000, 2);
      expect(e4 ~/ 10000, 3);
    });
  });
}
