// Runs the real app against the real backend (and Gemini): no fakes.
// Needs the server on localhost:3000 with the HR data seeded and the
// handbook uploaded. Not part of `flutter test`; run it on a simulator:
//
//   flutter test integration_test/live_chat_test.dart -d <simulator id>
//
// With HOLD_SECONDS set, it pauses on each screen so screenshots can be taken.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/app.dart';
import 'package:handbook_assistant/auth/auth_controller.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:integration_test/integration_test.dart';

const holdSeconds = int.fromEnvironment('HOLD_SECONDS');

Future<void> hold(WidgetTester tester, String label) async {
  debugPrint('SCREEN $label');
  if (holdSeconds > 0) await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: holdSeconds)));
}

/// Pumps until [finder] shows up or [timeout] passes (real network calls take seconds).
Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 60)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 300));
    if (finder.evaluate().isNotEmpty) return;
  }
  throw TestFailure('Timed out waiting for $finder');
}

/// Waits for an answer; if Gemini is busy (the app shows Try Again), waits and
/// taps Try Again, like a user would, up to [attempts] times.
Future<void> waitForAnswer(WidgetTester tester, Finder answer, {int attempts = 6}) async {
  for (var i = 0; i < attempts; i++) {
    await waitFor(tester, find.byWidgetPredicate((w) => answer.evaluate().isNotEmpty || (w is Text && w.data == 'Try Again')),
        timeout: const Duration(seconds: 90));
    if (answer.evaluate().isNotEmpty) return;
    debugPrint('AI busy, retrying (${i + 1}/$attempts)');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 15)));
    await tester.tap(find.text('Try Again'));
  }
  throw TestFailure('No answer after $attempts attempts (Gemini busy?)');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('employee: sign in, ask a policy + balance question, open the source', (tester) async {
    await tester.pumpWidget(ProviderScope(
      // A fresh session each run; the real backend otherwise.
      overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
      child: const AcmeAssistantApp(),
    ));
    await waitFor(tester, find.text('Sneha Nair'));
    await hold(tester, 'login');

    await tester.tap(find.text('Sneha Nair'));
    await waitFor(tester, find.text('Hi Sneha'));
    await hold(tester, 'welcome');

    await tester.tap(find.text('Can I carry over unused leave?'));
    await waitForAnswer(tester, find.byKey(const Key('sources')));
    await tester.pumpAndSettle();
    expect(find.text('Leave balances'), findsOneWidget);
    await hold(tester, 'answer');

    await tester.tap(find.byKey(const Key('source-1')));
    await tester.pumpAndSettle();
    expect(find.textContaining('carry over'), findsWidgets);
    await hold(tester, 'source');
  });

  testWidgets('manager: sees pending approvals from their own team', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [tokenStoreProvider.overrideWithValue(MemoryTokenStore())],
      child: const AcmeAssistantApp(),
    ));
    await waitFor(tester, find.text('Arjun Menon'));
    await tester.tap(find.text('Arjun Menon'));
    await waitFor(tester, find.text('Hi Arjun'));

    await tester.tap(find.text('Which leave requests are waiting for my approval?'));
    await waitForAnswer(tester, find.text('Team leave'));
    await tester.pumpAndSettle();
    await hold(tester, 'manager');
  });
}
