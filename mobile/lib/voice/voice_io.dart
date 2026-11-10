import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_pcm_sound/flutter_pcm_sound.dart';
import 'package:record/record.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// The three things a voice call talks to. Each is an interface so tests
/// (and the live test, which plays a recorded question instead of the mic)
/// can swap them out.

abstract interface class VoiceSocket {
  /// Completes when connected; throws if the server refused (e.g. 401).
  Future<void> get ready;
  Stream<String> get messages;
  void send(String frame);
  Future<void> close();
}

abstract interface class MicInput {
  Future<bool> hasPermission();

  /// Raw PCM 16-bit, 16 kHz, mono, in whatever slice sizes the device gives.
  Future<Stream<Uint8List>> start();
  Future<void> stop();
  Future<void> dispose();
}

abstract interface class SpeakerOutput {
  /// Called when everything queued has finished playing.
  set onDrained(void Function()? callback);

  Future<void> prepare();

  /// Queue PCM 16-bit, 24 kHz, mono for playback.
  Future<void> play(Uint8List pcm);

  /// Stop now and drop anything queued.
  Future<void> stop();
  Future<void> dispose();
}

// --- Real implementations -------------------------------------------------

class WebSocketVoiceSocket implements VoiceSocket {
  WebSocketVoiceSocket(Uri uri) : _channel = WebSocketChannel.connect(uri);

  final WebSocketChannel _channel;

  @override
  Future<void> get ready => _channel.ready;

  @override
  Stream<String> get messages => _channel.stream.where((m) => m is String).cast<String>();

  @override
  void send(String frame) => _channel.sink.add(frame);

  @override
  Future<void> close() async => _channel.sink.close(1000);
}

/// The microphone, via the `record` plugin. Echo cancellation and noise
/// suppression are on, so the agent's own voice isn't picked up.
class DeviceMic implements MicInput {
  final _recorder = AudioRecorder();

  @override
  Future<bool> hasPermission() => _recorder.hasPermission();

  @override
  Future<Stream<Uint8List>> start() => _recorder.startStream(const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
        echoCancel: true,
        noiseSuppress: true,
      ));

  @override
  Future<void> stop() async {
    await _recorder.stop();
  }

  @override
  Future<void> dispose() => _recorder.dispose();
}

/// The speaker, via `flutter_pcm_sound`, which plays raw PCM as it's fed.
class DeviceSpeaker implements SpeakerOutput {
  void Function()? _onDrained;

  @override
  set onDrained(void Function()? callback) => _onDrained = callback;

  @override
  Future<void> prepare() async {
    await FlutterPcmSound.setLogLevel(LogLevel.error);
    await FlutterPcmSound.setup(sampleRate: 24000, channelCount: 1);
    // Called with 0 remaining frames when playback runs dry.
    FlutterPcmSound.setFeedCallback((remaining) {
      if (remaining == 0) _onDrained?.call();
    });
  }

  @override
  Future<void> play(Uint8List pcm) => FlutterPcmSound.feed(PcmArrayInt16(bytes: ByteData.sublistView(pcm)));

  /// The plugin has no "clear queue", so release and set up again.
  @override
  Future<void> stop() async {
    await FlutterPcmSound.release();
    await prepare();
  }

  @override
  Future<void> dispose() async {
    FlutterPcmSound.setFeedCallback(null);
    await FlutterPcmSound.release();
  }
}
