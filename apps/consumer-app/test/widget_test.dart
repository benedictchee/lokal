// Smoke test: the Beegii app boots to the Explore tab without throwing.

import 'package:beegii/app.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Beegii app boots', (WidgetTester tester) async {
    await tester.pumpWidget(const BeegiiApp());
    await tester.pump();
    // The app constructed its router + shell without error.
    expect(find.byType(BeegiiApp), findsOneWidget);
  });
}
