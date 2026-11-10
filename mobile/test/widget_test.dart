import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:parking_mobile/widgets/ui.dart';

void main() {
  testWidgets('AppBadge luôn render text (không màu-only)',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: AppBadgeSuccessWrapProbe()),
      ),
    );
    expect(find.text('Chờ xác nhận'), findsOneWidget);
  });

  testWidgets('PrimaryButton đủ touch target 48dp', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PrimaryButton(
              label: 'Giữ chỗ', onPressed: () {}),
        ),
      ),
    );
    final size = tester.getSize(find.byType(PrimaryButton));
    expect(size.height, greaterThanOrEqualTo(48));
    expect(find.text('Giữ chỗ'), findsOneWidget);
  });
}

class AppBadgeSuccessWrapProbe extends StatelessWidget {
  const AppBadgeSuccessWrapProbe({super.key});

  @override
  Widget build(BuildContext context) =>
      AppBadge.warning('Chờ xác nhận');
}
