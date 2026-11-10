// Walks the real UI on a simulator with a pretend backend (no server, no
// Gemini), pausing on each screen so it can be screenshotted. The answers are
// copies of real ones from the live server.
//
//   flutter test integration_test/design_preview_test.dart -d <simulator> --dart-define=HOLD_SECONDS=4
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/app.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:handbook_assistant/voice/voice_controller.dart';
import 'package:handbook_assistant/voice/voice_io.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';

import '../test/fakes.dart';

const holdSeconds = int.fromEnvironment('HOLD_SECONDS', defaultValue: 3);

Future<void> hold(WidgetTester tester, String label) async {
  await tester.pumpAndSettle();
  debugPrint('SCREEN $label');
  await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: holdSeconds)));
}

const carryOverAnswer = '''
Yes, but only annual leave, and only up to 5 days.

- **Annual leave:** you may carry over up to **5 days** of unused annual leave into the next calendar year [1, 2]. Carried-over days are added on 1 January and must be used within that year [1]. Anything above 5 days is forfeited on 31 December [1, 2].
- **Sick and personal leave** do **not** carry over [1].

---

**Your annual leave for 2026**

- **Remaining:** 11 days (18 used of 29, including 5 carried over)
- **Pending requests:** 4 days
- **Available to book now:** 7 days
''';

Map<String, Object?> handbookSource(int n, int page, String text) =>
    {'n': n, 'cited': true, 'title': 'Acme Employee Handbook 2026', 'page': page, 'docId': 'acme-employee-handbook', 'score': 0.8, 'text': text};

Future<http.Response> onAsk(http.Request req) async {
  await Future<void>.delayed(const Duration(milliseconds: 1500));
  return answer(carryOverAnswer, sources: [
    handbookSource(1, 8,
        '6.4 Carry-over. Employees may carry over up to five (5) days of unused annual leave into the next calendar year. Carried-over days are credited on 1 January and must be taken by 31 December of that year; they cannot be carried over again. Unused annual leave above the carry-over limit is forfeited on 31 December. Sick leave, personal leave and compassionate leave do not carry over and are not paid out.'),
    handbookSource(2, 29,
        'Q: What happens to leave I don\'t use? A: Up to 5 days of annual leave roll over to next year (see section 6.4). The rest is forfeited on 31 December, so plan your time off early.'),
  ], toolsUsed: [
    'search_handbook',
    'get_my_leave_balances',
  ]);
}

/// A voice call that answers one question.
class ScriptedSocket implements VoiceSocket {
  final _incoming = StreamController<String>();
  ScriptedSocket() {
    Timer(const Duration(milliseconds: 600), () => _emit({'type': 'ready'}));
  }
  void _emit(Map<String, Object?> e) => _incoming.add(jsonEncode(e));

  @override
  Future<void> get ready => Future.value();
  @override
  Stream<String> get messages => _incoming.stream;
  @override
  void send(String frame) {
    if ((jsonDecode(frame) as Map)['type'] != 'end') return;
    _emit({'type': 'transcript', 'role': 'user', 'text': 'How many sick days do I get per year?'});
    _emit({'type': 'tool', 'name': 'search_handbook', 'query': 'sick days per year'});
    Timer(const Duration(milliseconds: 800), () {
      _emit({'type': 'transcript', 'role': 'model', 'text': 'Full-time employees in India get twelve paid sick days a year. '});
      _emit({'type': 'transcript', 'role': 'model', 'text': "For more than three days in a row you'll need a doctor's note."});
      _emit({'type': 'turn_complete'});
    });
  }

  @override
  Future<void> close() async => _incoming.close();
}

class SilentMic implements MicInput {
  @override
  Future<bool> hasPermission() async => true;
  @override
  Future<Stream<Uint8List>> start() async => const Stream.empty();
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

class SilentSpeaker implements SpeakerOutput {
  @override
  set onDrained(void Function()? callback) {}
  @override
  Future<void> prepare() async {}
  @override
  Future<void> play(Uint8List pcm) async {}
  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('design preview', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ...overridesFor(fakeBackend(onAsk: onAsk), MemoryTokenStore()),
        voiceSocketFactoryProvider.overrideWithValue((_) => ScriptedSocket()),
        micFactoryProvider.overrideWithValue(SilentMic.new),
        speakerFactoryProvider.overrideWithValue(SilentSpeaker.new),
      ],
      child: const AcmeAssistantApp(),
    ));
    await hold(tester, 'login');

    await tester.tap(find.text('Sneha Nair'));
    await hold(tester, 'welcome');

    await tester.tap(find.text('Can I carry over unused leave?'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 600)));
    await tester.pump(const Duration(milliseconds: 300));
    debugPrint('SCREEN thinking');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: holdSeconds)));
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
    await hold(tester, 'answer');

    await tester.tap(find.byKey(const Key('source-1')));
    await hold(tester, 'source');
    await tester.tapAt(const Offset(200, 120));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Account'));
    await hold(tester, 'account');
    await tester.tapAt(const Offset(20, 400));
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('New chat'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Voice'));
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 1)));
    await hold(tester, 'voice-ready');

    await tester.tap(find.byTooltip('Talk'));
    await tester.pump(const Duration(milliseconds: 500));
    debugPrint('SCREEN voice-listening');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: holdSeconds)));
    await tester.tap(find.byTooltip('Stop and send'));
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
    await hold(tester, 'voice-done');
  });
}
