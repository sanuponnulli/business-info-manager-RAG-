// Voice end to end against the real server and Gemini Live, on a simulator.
// The microphone is replaced by a recorded question (16 kHz mono WAV), so it
// runs unattended; the WebSocket, captions and speaker playback are real.
//
//   flutter test integration_test/live_voice_test.dart -d <simulator id> \
//     --dart-define=QUESTION_WAV=$PWD/../server/fixtures/question-sick-days.wav
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/app.dart';
import 'package:handbook_assistant/auth/auth_controller.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:handbook_assistant/voice/voice_controller.dart';
import 'package:handbook_assistant/voice/voice_io.dart';
import 'package:integration_test/integration_test.dart';

import 'live_chat_test.dart' show hold, waitFor;

const questionWav = String.fromEnvironment('QUESTION_WAV');

/// "Speaks" a WAV file: its PCM samples, in 100 ms slices.
class WavMic implements MicInput {
  @override
  Future<bool> hasPermission() async => true;

  @override
  Future<Stream<Uint8List>> start() async {
    final pcm = _pcmOf(File(questionWav).readAsBytesSync());
    return Stream.fromIterable([
      for (var i = 0; i < pcm.length; i += 3200) Uint8List.sublistView(pcm, i, (i + 3200).clamp(0, pcm.length)),
    ]);
  }

  /// The samples inside the WAV's "data" chunk.
  static Uint8List _pcmOf(Uint8List wav) {
    final view = ByteData.sublistView(wav);
    var offset = 12; // "RIFF", size, "WAVE"
    while (offset + 8 <= wav.length) {
      final id = String.fromCharCodes(wav.sublist(offset, offset + 4));
      final size = view.getUint32(offset + 4, Endian.little);
      if (id == 'data') return Uint8List.sublistView(wav, offset + 8, offset + 8 + size);
      offset += 8 + size;
    }
    throw StateError('No data chunk in $questionWav');
  }

  @override
  Future<void> stop() async {}
  @override
  Future<void> dispose() async {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('employee asks a question by voice and hears the answer with captions', (tester) async {
    expect(questionWav, isNotEmpty, reason: 'pass --dart-define=QUESTION_WAV=/path/to/question.wav');
    await tester.pumpWidget(ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
        micFactoryProvider.overrideWithValue(WavMic.new),
      ],
      child: const AcmeAssistantApp(),
    ));
    await waitFor(tester, find.text('Sneha Nair'));
    await tester.tap(find.text('Sneha Nair'));
    await waitFor(tester, find.text('Hi Sneha'));

    await tester.tap(find.byTooltip('Voice'));
    await waitFor(tester, find.text(VoicePhase.ready.label), timeout: const Duration(seconds: 30));
    await hold(tester, 'voice-ready');

    await tester.tap(find.byTooltip('Talk'));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 500)));
    await tester.pump();
    await tester.tap(find.byTooltip('Stop and send'));

    // The user's words come back as a caption, then the agent's answer.
    await waitFor(tester, find.byKey(const Key('caption-model')), timeout: const Duration(seconds: 60));
    await hold(tester, 'voice-answering');
    await waitFor(tester, find.text(VoicePhase.ready.label), timeout: const Duration(seconds: 60));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('caption-user')), findsOneWidget);
    debugPrint('CAPTIONS ${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).whereType<String>().join(' | ')}');
    await hold(tester, 'voice-done');
  });
}
