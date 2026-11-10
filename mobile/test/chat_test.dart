import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/app.dart';
import 'package:handbook_assistant/auth/auth_controller.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:handbook_assistant/chat/chat_controller.dart';
import 'package:http/http.dart' as http;

import 'fakes.dart';

/// Starts the app already signed in, with [onAsk] playing the chat endpoint.
Future<List<http.Request>> pumpSignedIn(
  WidgetTester tester,
  Future<http.Response> Function(http.Request) onAsk, {
  String role = 'EMPLOYEE',
  TokenStore? tokens,
}) async {
  final log = <http.Request>[];
  await tester.pumpWidget(
    ProviderScope(
      overrides: overridesFor(
        fakeBackend(role: role, log: log, onAsk: onAsk),
        tokens ?? MemoryTokenStore(goodToken),
      ),
      child: const AcmeAssistantApp(),
    ),
  );
  await tester.pumpAndSettle();
  return log;
}

Future<void> ask(WidgetTester tester, String question) async {
  await tester.enterText(find.byType(TextField), question);
  await tester.pumpAndSettle(); // the Voice button turns into Send once there is text
  await tester.tap(find.byTooltip('Send'));
  await tester.pumpAndSettle();
}

List<Map<String, dynamic>> chatBodies(List<http.Request> log) => [
  for (final r in log.where((r) => r.url.path == '/api/v1/chat/ask'))
    jsonDecode(r.body) as Map<String, dynamic>,
];

void main() {
  testWidgets(
    'asks with the token and shows the answer with its cited source',
    (tester) async {
      final log = await pumpSignedIn(
        tester,
        (_) async => answer(
          'No, only for more than three days [1].',
          sources: [source(1, page: 8), source(2, cited: false, page: 9)],
          toolsUsed: ['search_handbook'],
        ),
      );

      await ask(tester, "Do I need a doctor's note?");

      expect(find.text("Do I need a doctor's note?"), findsOneWidget);
      expect(
        find.textContaining('only for more than three days'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('source-1')), findsOneWidget); // cited
      expect(find.text('p. 8'), findsOneWidget);
      expect(find.byKey(const Key('source-2')), findsNothing); // retrieved but not cited
      final askRequest = log.lastWhere((r) => r.url.path == '/api/v1/chat/ask');
      expect(askRequest.headers['authorization'], 'Bearer $goodToken');
    },
  );

  testWidgets('tapping a source opens the handbook passage', (tester) async {
    await pumpSignedIn(
      tester,
      (_) async => answer('Five days [1].', sources: [source(1, page: 8)]),
    );
    await ask(tester, 'Carry over?');

    await tester.tap(find.byKey(const Key('source-1')));
    await tester.pumpAndSettle();
    expect(find.text('Passage 1 text.'), findsOneWidget);
    expect(find.text('Page 8'), findsOneWidget);
  });

  testWidgets('labels answers that used HR records', (tester) async {
    await pumpSignedIn(
      tester,
      (_) async => answer(
        'You have 7 days left.',
        toolsUsed: ['get_my_leave_balances', 'search_handbook'],
      ),
    );
    await ask(tester, 'How many days do I have left?');
    expect(find.text('Leave balances'), findsOneWidget);
  });

  testWidgets('sends earlier turns as history for follow-up questions', (
    tester,
  ) async {
    var n = 0;
    final log = await pumpSignedIn(
      tester,
      (_) async => answer('Answer ${++n}'),
    );
    await ask(tester, 'First question');
    await ask(tester, 'And a follow-up?');

    final bodies = chatBodies(log);
    expect(bodies.first['history'], isEmpty);
    expect(bodies.last['question'], 'And a follow-up?');
    expect(bodies.last['history'], [
      {'role': 'user', 'text': 'First question'},
      {'role': 'model', 'text': 'Answer 1'},
    ]);
  });

  testWidgets('"AI is busy" shows the message, and Try Again asks again', (
    tester,
  ) async {
    var busy = true;
    await pumpSignedIn(
      tester,
      (_) async => busy
          ? json(503, {
              'error': {
                'code': 'ai_busy',
                'message': 'The AI service is busy right now. Please try again in a moment.',
              },
            })
          : answer('Smart casual [1].', sources: [source(1, page: 23)]),
    );

    await ask(tester, 'Dress code?');
    expect(find.textContaining('busy right now'), findsOneWidget);

    busy = false;
    await tester.tap(find.text('Try Again'));
    await tester.pumpAndSettle();
    expect(find.textContaining('busy right now'), findsNothing);
    expect(find.textContaining('Smart casual'), findsOneWidget);
    expect(find.text('Dress code?'), findsOneWidget); // moved, not duplicated
  });

  testWidgets('an expired session goes back to the login screen', (
    tester,
  ) async {
    final tokens = MemoryTokenStore(goodToken);
    await pumpSignedIn(
      tester,
      (_) async => json(401, {
        'error': {'code': 'unauthorized', 'message': 'Sign in again'},
      }),
      tokens: tokens,
    );

    await ask(tester, 'Hello?');
    expect(find.text('Sign in'), findsOneWidget);
    expect(tokens.token, isNull);
  });

  testWidgets('managers get manager suggestions, and tapping one asks it', (
    tester,
  ) async {
    final log = await pumpSignedIn(
      tester,
      (_) async => answer('Two requests are pending.'),
      role: 'MANAGER',
    );
    await tester.tap(
      find.text('Which leave requests are waiting for my approval?'),
    );
    await tester.pumpAndSettle();
    expect(
      chatBodies(log).single['question'],
      'Which leave requests are waiting for my approval?',
    );
    expect(find.text('Two requests are pending.'), findsOneWidget);
  });

  testWidgets('New chat clears the conversation', (tester) async {
    await pumpSignedIn(tester, (_) async => answer('Hi!'));
    await ask(tester, 'Hello');
    await tester.tap(find.byTooltip('New chat'));
    await tester.pumpAndSettle();
    expect(find.text('Hello'), findsNothing);
    expect(find.text('Hi Sneha'), findsOneWidget);
  });

  test('an answer that arrives after sign-out is dropped quietly', () async {
    final reply = Completer<http.Response>();
    final container = ProviderContainer(
        overrides: overridesFor(fakeBackend(onAsk: (_) => reply.future), MemoryTokenStore(goodToken)));
    addTearDown(container.dispose);
    await container.read(authProvider.future); // signed in first, as in the app
    container.listen(chatProvider, (_, _) {});

    final sending = container.read(chatProvider.notifier).send('Hello?');
    await container.read(authProvider.notifier).signOut();
    await Future<void>.delayed(Duration.zero); // the chat resets for "nobody"
    reply.complete(answer('Too late'));
    await sending; // must not throw

    expect(container.read(chatProvider).messages, isEmpty);
    expect(container.read(chatProvider).sending, isFalse);
  });

  test('an answer that arrives after the app shuts down does not throw', () async {
    final reply = Completer<http.Response>();
    final container = ProviderContainer(
        overrides: overridesFor(fakeBackend(onAsk: (_) => reply.future), MemoryTokenStore(goodToken)));
    await container.read(authProvider.future);
    container.listen(chatProvider, (_, _) {});

    final sending = container.read(chatProvider.notifier).send('Hello?');
    container.dispose();
    reply.complete(json(503, {
      'error': {'code': 'ai_busy', 'message': 'busy'}
    }));
    await sending; // used to throw UnmountedRefException
  });
}
