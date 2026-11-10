import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/app.dart';
import 'package:handbook_assistant/auth/token_store.dart';

import 'fakes.dart';

Future<void> pumpApp(WidgetTester tester, {TokenStore? tokens}) async {
  await tester.pumpWidget(ProviderScope(
    overrides: overridesFor(fakeBackend(), tokens ?? MemoryTokenStore()),
    child: const AcmeAssistantApp(),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('tapping a demo account signs in and shows who you are', (tester) async {
    await pumpApp(tester);
    expect(find.text('Sign in'), findsOneWidget);

    await tester.tap(find.text('Sneha Nair'));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsNothing);
    expect(find.text('Flutter Developer · Engineering'), findsOneWidget);
    expect(find.widgetWithText(Chip, 'Employee'), findsOneWidget);
  });

  testWidgets('a wrong password shows the server message', (tester) async {
    await pumpApp(tester);
    await tester.enterText(find.widgetWithText(TextFormField, 'Work email'), 'employee@acme.test');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'wrong');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login-error')), findsOneWidget);
    expect(find.text('Wrong email or password'), findsOneWidget);
  });

  testWidgets('empty fields are caught before calling the server', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    expect(find.text('Enter your work email'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
  });

  testWidgets('sign out returns to the login screen', (tester) async {
    await pumpApp(tester, tokens: MemoryTokenStore(goodToken));
    expect(find.text('Sneha Nair'), findsOneWidget);

    await tester.tap(find.byTooltip('Sign out'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
  });
}
