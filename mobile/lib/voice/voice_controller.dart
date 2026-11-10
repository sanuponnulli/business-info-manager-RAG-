import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../auth/auth_controller.dart';
import '../config.dart';
import 'voice_io.dart';
import 'voice_protocol.dart';

/// Swappable in tests: how to open the socket, the mic and the speaker.
final voiceSocketFactoryProvider = Provider<VoiceSocket Function(Uri)>((ref) => WebSocketVoiceSocket.new);
final micFactoryProvider = Provider<MicInput Function()>((ref) => DeviceMic.new);
final speakerFactoryProvider = Provider<SpeakerOutput Function()>((ref) => DeviceSpeaker.new);

/// One voice call. It lives while the voice screen is open (autoDispose):
/// leaving the screen hangs up and releases the mic and speaker.
final voiceProvider = NotifierProvider.autoDispose<VoiceController, VoiceState>(VoiceController.new);

enum VoicePhase {
  connecting('Connecting…'),
  ready('Tap the mic and ask a question'),
  listening('Listening… tap again when you’re done'),
  thinking('Thinking…'),
  speaking('Speaking… tap the mic to interrupt'),
  ended('Call ended');

  const VoicePhase(this.label);
  final String label;
}

class Caption {
  const Caption({required this.fromUser, required this.text});
  final bool fromUser;
  final String text;
}

class VoiceState {
  const VoiceState({this.phase = VoicePhase.connecting, this.captions = const [], this.activity, this.error});

  final VoicePhase phase;
  final List<Caption> captions;

  /// What the agent is doing right now ("Searching the handbook…").
  final String? activity;

  /// Why the call can't continue, or why the mic didn't start.
  final String? error;

  bool get micEnabled => phase == VoicePhase.ready || phase == VoicePhase.listening || phase == VoicePhase.speaking || phase == VoicePhase.thinking;

  VoiceState copyWith({VoicePhase? phase, List<Caption>? captions, String? Function()? activity, String? Function()? error}) => VoiceState(
        phase: phase ?? this.phase,
        captions: captions ?? this.captions,
        activity: activity != null ? activity() : this.activity,
        error: error != null ? error() : this.error,
      );
}

class VoiceController extends Notifier<VoiceState> {
  /// About 100 ms of 16 kHz 16-bit audio per frame, as the server asks.
  static const sliceBytes = 3200;

  VoiceSocket? _socket;
  StreamSubscription<String>? _socketSub;
  MicInput? _mic;
  StreamSubscription<Uint8List>? _micSub;
  SpeakerOutput? _speaker;
  final _pending = BytesBuilder(copy: false);

  /// Captions arrive in fragments; a new caption starts after each turn.
  bool _newUserCaption = true;
  bool _newModelCaption = true;

  /// The agent finished talking; once playback drains we're ready again.
  bool _turnDone = false;
  bool _disposed = false;

  @override
  VoiceState build() {
    ref.onDispose(_teardown);
    Future.microtask(connect);
    return const VoiceState();
  }

  Future<void> connect() async {
    if (_disposed) return;
    await _closeSocket();
    state = state.copyWith(phase: VoicePhase.connecting, activity: () => null, error: () => null);

    final token = ref.read(apiClientProvider).token;
    final base = apiBaseUrl();
    final uri = base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '/ws/voice-agent',
      queryParameters: {'token': ?token},
    );

    try {
      _speaker ??= ref.read(speakerFactoryProvider)()..onDrained = _onPlaybackDrained;
      await _speaker!.prepare();
      final socket = ref.read(voiceSocketFactoryProvider)(uri);
      _socket = socket;
      await socket.ready;
      if (_disposed) return;
      _socketSub = socket.messages.listen(_onFrame, onDone: _onSocketClosed, onError: (_) => _onSocketClosed());
    } catch (_) {
      if (_disposed) return;
      await _explainConnectFailure();
    }
  }

  /// The mic button: start talking, or finish talking (push-to-talk).
  Future<void> toggleMic() async {
    if (state.phase == VoicePhase.listening) return _finishTalking();
    if (!state.micEnabled) return;

    final mic = _mic ??= ref.read(micFactoryProvider)();
    final allowed = await mic.hasPermission();
    if (_disposed) return;
    if (!allowed) {
      state = state.copyWith(error: () => 'Microphone access is off. Allow it in Settings to talk to the assistant.');
      return;
    }
    // Talking over the agent: cut its answer off (the server also tells Gemini).
    if (state.phase == VoicePhase.speaking || state.phase == VoicePhase.thinking) await _speaker?.stop();

    _pending.clear();
    _newUserCaption = true;
    state = state.copyWith(phase: VoicePhase.listening, activity: () => null, error: () => null);
    final stream = await mic.start();
    if (_disposed) return;
    _micSub = stream.listen(_onMicAudio);
  }

  Future<void> _finishTalking() async {
    await _micSub?.cancel();
    _micSub = null;
    await _mic?.stop();
    if (_disposed) return;
    if (_pending.length > 0) _socket?.send(audioFrame(_pending.takeBytes()));
    _socket?.send(endFrame);
    _turnDone = false;
    state = state.copyWith(phase: VoicePhase.thinking);
    // Recording can change the audio session; get playback ready again.
    await _speaker?.stop();
  }

  void _onMicAudio(Uint8List data) {
    _pending.add(data);
    if (_pending.length < sliceBytes) return;
    final bytes = _pending.takeBytes();
    var offset = 0;
    for (; offset + sliceBytes <= bytes.length; offset += sliceBytes) {
      _socket?.send(audioFrame(Uint8List.sublistView(bytes, offset, offset + sliceBytes)));
    }
    if (offset < bytes.length) _pending.add(Uint8List.sublistView(bytes, offset));
  }

  void _onFrame(String frame) {
    final event = ServerEvent.parse(frame);
    switch (event) {
      case Ready():
        state = state.copyWith(phase: VoicePhase.ready);
      case AudioOut(:final pcm):
        if (state.phase == VoicePhase.listening) return; // the user is talking over it
        _speaker?.play(pcm);
        state = state.copyWith(phase: VoicePhase.speaking, activity: () => null);
      case Transcript(:final fromUser, :final text):
        _addCaption(fromUser, text);
      case ToolCall(:final name):
        state = state.copyWith(
          activity: () => name == 'search_handbook' ? 'Searching the handbook…' : 'Checking your HR records…',
        );
      case Interrupted():
        _speaker?.stop();
      case TurnComplete():
        _turnDone = true;
        _newUserCaption = true;
        _newModelCaption = true;
        // No audio came (or it already finished): ready for the next question.
        if (state.phase == VoicePhase.thinking) state = state.copyWith(phase: VoicePhase.ready, activity: () => null);
      case ServerError(:final message) when event.endsCall:
        state = state.copyWith(phase: VoicePhase.ended, error: () => message, activity: () => null);
      case ServerError() || null:
        break; // bad_message / not_ready / unknown frames: nothing the user can act on
    }
  }

  void _onPlaybackDrained() {
    if (_disposed || !_turnDone) return;
    if (state.phase == VoicePhase.speaking) state = state.copyWith(phase: VoicePhase.ready);
  }

  void _addCaption(bool fromUser, String text) {
    final captions = [...state.captions];
    final startNew = fromUser ? _newUserCaption : _newModelCaption;
    final last = captions.lastOrNull;
    if (!startNew && last != null && last.fromUser == fromUser) {
      captions[captions.length - 1] = Caption(fromUser: fromUser, text: last.text + text);
    } else {
      captions.add(Caption(fromUser: fromUser, text: text.trimLeft()));
    }
    if (fromUser) {
      _newUserCaption = false;
    } else {
      _newModelCaption = false;
    }
    state = state.copyWith(captions: captions);
  }

  void _onSocketClosed() {
    if (_disposed) return;
    _micSub?.cancel();
    _mic?.stop();
    if (state.phase != VoicePhase.ended) {
      state = state.copyWith(phase: VoicePhase.ended, activity: () => null);
    }
  }

  /// The upgrade failed: an expired session (401) or the server is down.
  Future<void> _explainConnectFailure() async {
    try {
      await ref.read(apiClientProvider).get('/api/v1/me');
      if (_disposed) return;
      state = state.copyWith(phase: VoicePhase.ended, error: () => "Couldn't start the voice call. Please try again.");
    } on ApiException catch (e) {
      if (_disposed) return;
      if (e.isUnauthorized) {
        await ref.read(authProvider.notifier).sessionExpired();
        return;
      }
      state = state.copyWith(phase: VoicePhase.ended, error: () => e.message);
    }
  }

  Future<void> _closeSocket() async {
    await _socketSub?.cancel();
    _socketSub = null;
    await _socket?.close();
    _socket = null;
  }

  void _teardown() {
    _disposed = true;
    _micSub?.cancel();
    _mic?.stop().whenComplete(() => _mic?.dispose());
    _speaker?.dispose();
    _closeSocket();
  }
}
