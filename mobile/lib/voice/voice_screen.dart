import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../chat/chat_widgets.dart' show AssistantLabel;
import '../ui/theme.dart';
import 'voice_controller.dart';

/// Talk to the assistant: push-to-talk mic, spoken answers, live captions.
class VoiceScreen extends ConsumerStatefulWidget {
  const VoiceScreen({super.key});

  @override
  ConsumerState<VoiceScreen> createState() => _VoiceScreenState();
}

class _VoiceScreenState extends ConsumerState<VoiceScreen> {
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final voice = ref.watch(voiceProvider);
    final controller = ref.read(voiceProvider.notifier);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    ref.listen(voiceProvider.select((v) => v.captions), (_, _) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      });
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Voice')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: voice.captions.isEmpty
                  ? const _VoiceIntro()
                  : ListView.separated(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
                      itemCount: voice.captions.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 20),
                      itemBuilder: (context, i) => _CaptionView(caption: voice.captions[i]),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
              child: Column(
                children: [
                  SizedBox(
                    height: 44,
                    child: Center(
                      child: Text(
                        voice.error ?? voice.activity ?? voice.phase.label,
                        key: const Key('voice-status'),
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        style: theme.textTheme.bodyMedium?.copyWith(color: voice.error != null ? scheme.error : scheme.onSurfaceVariant),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (voice.phase == VoicePhase.ended)
                    SizedBox(
                      height: 112,
                      child: Center(
                        child: FilledButton.icon(
                          onPressed: controller.connect,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Reconnect'),
                        ),
                      ),
                    )
                  else
                    _MicButton(phase: voice.phase, enabled: voice.micEnabled, onPressed: controller.toggleMic),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Before the first question: what to say.
class _VoiceIntro extends StatelessWidget {
  const _VoiceIntro();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const BrandMark(size: 56),
            const SizedBox(height: 20),
            Text('Ask out loud', style: theme.textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(
              '“How many sick days do I get?”\n“When is my next public holiday?”',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.onSurfaceVariant, height: 1.5),
            ),
            const SizedBox(height: 16),
            Text(
              'Answers are spoken and written out here.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

/// The big round button. A ring pulses out of it while the mic is open or
/// the assistant is speaking (still, with reduced motion).
class _MicButton extends StatefulWidget {
  const _MicButton({required this.phase, required this.enabled, required this.onPressed});

  final VoicePhase phase;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  State<_MicButton> createState() => _MicButtonState();
}

class _MicButtonState extends State<_MicButton> with SingleTickerProviderStateMixin {
  late final _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));

  bool get _active => widget.phase == VoicePhase.listening || widget.phase == VoicePhase.speaking;

  void _sync() {
    if (_active && !MediaQuery.disableAnimationsOf(context)) {
      if (!_pulse.isAnimating) _pulse.repeat();
    } else {
      _pulse
        ..stop()
        ..value = 0;
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(_MicButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final listening = widget.phase == VoicePhase.listening;
    final color = listening ? scheme.error : scheme.primary;
    const size = 80.0;
    return SizedBox.square(
      dimension: 112,
      child: Stack(
        alignment: Alignment.center,
        children: [
          AnimatedBuilder(
            animation: _pulse,
            builder: (context, _) {
              final t = _pulse.value;
              return Opacity(
                opacity: _pulse.isAnimating ? (1 - t) * 0.35 : 0,
                child: Container(
                  width: size + 32 * t,
                  height: size + 32 * t,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: color),
                ),
              );
            },
          ),
          SizedBox.square(
            dimension: size,
            child: IconButton.filled(
              tooltip: listening ? 'Stop and send' : 'Talk',
              onPressed: widget.enabled ? widget.onPressed : null,
              style: IconButton.styleFrom(backgroundColor: color, foregroundColor: Colors.white),
              icon: widget.phase == VoicePhase.connecting
                  ? const SizedBox.square(dimension: 26, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : Icon(listening ? Icons.stop_rounded : Icons.mic_rounded, size: 36),
            ),
          ),
        ],
      ),
    );
  }
}

/// What you said (grey bubble, right) and what the assistant said (plain
/// large text, left), like the chat screen.
class _CaptionView extends StatelessWidget {
  const _CaptionView({required this.caption});

  final Caption caption;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (caption.fromUser) {
      return Align(
        key: const Key('caption-user'),
        alignment: Alignment.centerRight,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
          child: DecoratedBox(
            decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(20)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
              child: Text(caption.text, style: theme.textTheme.bodyLarge),
            ),
          ),
        ),
      );
    }
    return Column(
      key: const Key('caption-model'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const AssistantLabel(),
        const SizedBox(height: 8),
        Text(caption.text, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w400, letterSpacing: -0.2, height: 1.35)),
      ],
    );
  }
}
