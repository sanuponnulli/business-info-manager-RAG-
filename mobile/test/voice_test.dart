import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/auth/auth_controller.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:handbook_assistant/voice/voice_controller.dart';
import 'package:handbook_assistant/voice/voice_io.dart';

import 'fakes.dart';

class FakeSocket implements VoiceSocket {
  FakeSocket(this.uri, {this.fail = false});
  final Uri uri;
  final bool fail;
  final incoming = StreamController<String>();
  final sent = <String>[];
  bool closed = false;

  @override
  Future<void> get ready => fail ? Future.error(Exception('upgrade refused')) : Future.value();
  @override
  Stream<String> get messages => incoming.stream;
  @override
  void send(String frame) => sent.add(frame);
  @override
  Future<void> close() async => closed = true;

  void server(Map<String, Object?> event) => incoming.add(jsonEncode(event));
  List<Map<String, dynamic>> get sentJson => [for (final f in sent) jsonDecode(f) as Map<String, dynamic>];
}

class FakeMic implements MicInput {
  bool allowed = true;
  StreamController<Uint8List>? audio;
  int stops = 0;

  @override
  Future<bool> hasPermission() async => allowed;
  @override
  Future<Stream<Uint8List>> start() async => (audio = StreamController<Uint8List>()).stream;
  @override
  Future<void> stop() async => stops++;
  @override
  Future<void> dispose() async {}
}

class FakeSpeaker implements SpeakerOutput {
  void Function()? drained;
  final played = <int>[];
  int stops = 0;

  @override
  set onDrained(void Function()? callback) => drained = callback;
  @override
  Future<void> prepare() async {}
  @override
  Future<void> play(Uint8List pcm) async => played.add(pcm.length);
  @override
  Future<void> stop() async => stops++;
  @override
  Future<void> dispose() async {}
}

/// Lets queued microtasks and stream events run.
Future<void> settle() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

class Call {
  Call({bool socketFails = false, TokenStore? tokens}) {
    container = ProviderContainer(overrides: [
      ...overridesFor(fakeBackend(), tokens ?? MemoryTokenStore(goodToken)),
      voiceSocketFactoryProvider.overrideWithValue((uri) => sockets.last = FakeSocket(uri, fail: socketFails)),
      micFactoryProvider.overrideWithValue(() => mic),
      speakerFactoryProvider.overrideWithValue(() => speaker),
    ]);
    sockets.add(FakeSocket(Uri()));
    container.listen(voiceProvider, (_, _) {}); // keep the autoDispose call alive
  }

  late final ProviderContainer container;
  final sockets = <FakeSocket>[];
  final mic = FakeMic();
  final speaker = FakeSpeaker();

  FakeSocket get socket => sockets.last;
  VoiceState get state => container.read(voiceProvider);
  VoiceController get voice => container.read(voiceProvider.notifier);

  Future<void> start() async {
    await container.read(authProvider.future);
    container.read(voiceProvider);
    await settle();
  }
}

void main() {
  test('connects with the token in the URL and becomes ready', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    await call.start();
    expect(call.socket.uri.path, '/ws/voice-agent');
    expect(call.socket.uri.queryParameters['token'], goodToken);
    expect(call.state.phase, VoicePhase.connecting);

    call.socket.server({'type': 'ready'});
    await settle();
    expect(call.state.phase, VoicePhase.ready);
  });

  test('push-to-talk: mic audio goes out in 3200-byte slices, then "end"', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    await call.start();
    call.socket.server({'type': 'ready'});
    await settle();

    await call.voice.toggleMic();
    expect(call.state.phase, VoicePhase.listening);
    call.mic.audio!.add(Uint8List(5000)); // one full slice + 1800 left over
    call.mic.audio!.add(Uint8List(2000)); // completes a second slice, 600 left
    await settle();
    await call.voice.toggleMic();

    final frames = call.socket.sentJson;
    final sizes = [for (final f in frames.where((f) => f['type'] == 'audio')) base64Decode(f['data'] as String).length];
    expect(sizes, [3200, 3200, 600]);
    expect(frames.last, {'type': 'end'});
    expect(call.mic.stops, 1);
    expect(call.state.phase, VoicePhase.thinking);
  });

  test('plays the answer, joins caption fragments, and is ready again once playback ends', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    await call.start();
    final s = call.socket;
    s.server({'type': 'ready'});
    await settle();
    await call.voice.toggleMic();
    await call.voice.toggleMic();

    s.server({'type': 'transcript', 'role': 'user', 'text': 'How many sick'});
    s.server({'type': 'transcript', 'role': 'user', 'text': ' days?'});
    s.server({'type': 'tool', 'name': 'search_handbook', 'query': 'sick days'});
    await settle();
    expect(call.state.activity, 'Searching the handbook…');

    s.server({'type': 'audio', 'data': base64Encode(Uint8List(4800))});
    s.server({'type': 'transcript', 'role': 'model', 'text': 'You get'});
    s.server({'type': 'transcript', 'role': 'model', 'text': ' 12 days.'});
    s.server({'type': 'turn_complete'});
    await settle();

    expect(call.speaker.played, [4800]);
    expect(call.state.phase, VoicePhase.speaking); // still playing
    expect([for (final c in call.state.captions) '${c.fromUser ? 'you' : 'agent'}: ${c.text}'],
        ['you: How many sick days?', 'agent: You get 12 days.']);

    call.speaker.drained!();
    expect(call.state.phase, VoicePhase.ready);
  });

  test('is ready again when playback ends before the turn is complete', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    await call.start();
    final s = call.socket;
    s.server({'type': 'ready'});
    await settle();
    await call.voice.toggleMic();
    await call.voice.toggleMic();

    s.server({'type': 'audio', 'data': base64Encode(Uint8List(4800))});
    await settle();
    call.speaker.drained!(); // the speaker runs dry first...
    expect(call.state.phase, VoicePhase.speaking);

    s.server({'type': 'turn_complete'}); // ...then the server says the turn is over
    await settle();
    expect(call.state.phase, VoicePhase.ready);
  });

  test('tapping the mic while the agent speaks cuts it off', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    await call.start();
    call.socket.server({'type': 'ready'});
    call.socket.server({'type': 'audio', 'data': base64Encode(Uint8List(100))});
    await settle();
    expect(call.state.phase, VoicePhase.speaking);
    final stopsBefore = call.speaker.stops;

    await call.voice.toggleMic();
    expect(call.speaker.stops, stopsBefore + 1);
    expect(call.state.phase, VoicePhase.listening);
  });

  test('no microphone permission: explains, and stays ready', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    call.mic.allowed = false;
    await call.start();
    call.socket.server({'type': 'ready'});
    await settle();

    await call.voice.toggleMic();
    expect(call.state.phase, VoicePhase.ready);
    expect(call.state.error, contains('Microphone access is off'));
  });

  test('a server error ends the call with its message; Reconnect opens a new one', () async {
    final call = Call();
    addTearDown(call.container.dispose);
    await call.start();
    call.socket.server({'type': 'error', 'code': 'idle_timeout', 'message': 'Closed after a period of inactivity'});
    await settle();
    expect(call.state.phase, VoicePhase.ended);
    expect(call.state.error, 'Closed after a period of inactivity');

    final first = call.socket;
    await call.voice.connect();
    await settle();
    expect(first.closed, isTrue);
    expect(call.socket, isNot(same(first)));
    expect(call.state.phase, VoicePhase.connecting);
    expect(call.state.error, isNull);
  });

  test('an expired session (upgrade refused, /me says 401) signs out', () async {
    final tokens = MemoryTokenStore(goodToken);
    final call = Call(socketFails: true, tokens: tokens);
    addTearDown(call.container.dispose);
    await call.start();
    call.container.read(apiClientProvider).token = 'expired';
    await call.voice.connect();
    await settle();
    expect(call.container.read(authProvider).value, isNull);
    expect(tokens.token, isNull);
  });

  test('server down: the call ends with a reason', () async {
    final call = Call(socketFails: true);
    addTearDown(call.container.dispose);
    await call.start();
    expect(call.state.phase, VoicePhase.ended);
    expect(call.state.error, "Couldn't start the voice call. Please try again.");
  });
}
