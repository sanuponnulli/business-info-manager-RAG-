import 'dart:convert';
import 'dart:typed_data';

/// The voice WebSocket protocol (server/src/ws/protocol.ts, server README).
/// Every frame is JSON text with a `type`.

sealed class ServerEvent {
  const ServerEvent();

  /// Null for frames we don't understand (ignored rather than crashing a call).
  static ServerEvent? parse(String frame) {
    final Object? json;
    try {
      json = jsonDecode(frame);
    } on FormatException {
      return null;
    }
    if (json is! Map<String, dynamic>) return null;
    return switch (json['type']) {
      'ready' => const Ready(),
      'audio' => AudioOut(base64Decode(json['data'] as String)),
      'transcript' => Transcript(fromUser: json['role'] == 'user', text: json['text'] as String),
      'tool' => ToolCall(json['name'] as String),
      'interrupted' => const Interrupted(),
      'turn_complete' => const TurnComplete(),
      'error' => ServerError(json['code'] as String, json['message'] as String),
      _ => null,
    };
  }
}

/// Session open: the app may send audio now.
class Ready extends ServerEvent {
  const Ready();
}

/// A slice of the spoken answer: PCM 16-bit, 24 kHz, mono.
class AudioOut extends ServerEvent {
  const AudioOut(this.pcm);
  final Uint8List pcm;
}

/// A caption fragment; fragments of one turn are appended until TurnComplete.
class Transcript extends ServerEvent {
  const Transcript({required this.fromUser, required this.text});
  final bool fromUser;
  final String text;
}

/// The agent is calling a tool (handbook search or an HR lookup).
class ToolCall extends ServerEvent {
  const ToolCall(this.name);
  final String name;
}

/// The user spoke over the agent: stop playback now.
class Interrupted extends ServerEvent {
  const Interrupted();
}

/// The agent finished its answer.
class TurnComplete extends ServerEvent {
  const TurnComplete();
}

class ServerError extends ServerEvent {
  const ServerError(this.code, this.message);
  final String code;
  final String message;

  /// These come just before the server closes the connection.
  bool get endsCall => const {'server_busy', 'idle_timeout', 'upstream_unavailable', 'session_closed'}.contains(code);
}

/// A slice of microphone audio: PCM 16-bit, 16 kHz, mono.
String audioFrame(Uint8List pcm) => jsonEncode({'type': 'audio', 'data': base64Encode(pcm)});

/// The user stopped talking: the agent answers right away.
const endFrame = '{"type":"end"}';
