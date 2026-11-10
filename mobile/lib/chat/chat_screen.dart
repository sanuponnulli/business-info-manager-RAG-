import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../auth/profile.dart';
import '../ui/theme.dart';
import '../voice/voice_screen.dart';
import 'chat_controller.dart';
import 'chat_widgets.dart';

/// The home screen once signed in: ask by text, read answers with sources.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.profile});

  final Profile profile;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _send([String? text]) {
    final question = text ?? _input.text;
    if (question.trim().isEmpty) return;
    _input.clear();
    ref.read(chatProvider.notifier).send(question);
  }

  /// Keep the newest message in view.
  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);
    ref.listen(chatProvider, (previous, next) {
      if (previous?.messages.length != next.messages.length || previous?.sending != next.sending) _scrollToEnd();
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Acme Assistant'),
        actions: [
          if (chat.messages.isNotEmpty)
            IconButton(
              tooltip: 'New chat',
              icon: const Icon(Icons.edit_square, size: 22),
              onPressed: chat.sending ? null : () => ref.read(chatProvider.notifier).clear(),
            ),
          _AccountMenu(profile: widget.profile),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: chat.messages.isEmpty
                  ? _Welcome(profile: widget.profile, onAsk: _send)
                  : ListView.separated(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                      itemCount: chat.messages.length + (chat.sending ? 1 : 0),
                      separatorBuilder: (_, _) => const SizedBox(height: 24),
                      itemBuilder: (context, i) {
                        if (i == chat.messages.length) return const ThinkingBubble();
                        final m = chat.messages[i];
                        return m.fromUser
                            ? QuestionBubble(
                                message: m,
                                canRetry: !chat.sending,
                                onRetry: () => ref.read(chatProvider.notifier).retry(m.id),
                              )
                            : AnswerBubble(message: m);
                      },
                    ),
            ),
            _InputBar(
              controller: _input,
              enabled: !chat.sending,
              onSend: _send,
              onVoice: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const VoiceScreen())),
            ),
          ],
        ),
      ),
    );
  }
}

/// The composer: a rounded field, and one round button beside it that is
/// Voice while the field is empty and Send once there is something to send.
class _InputBar extends StatelessWidget {
  const _InputBar({required this.controller, required this.enabled, required this.onSend, required this.onVoice});

  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onSend;
  final VoidCallback onVoice;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant, width: 0.5))),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 5,
                maxLength: ChatController.maxQuestionLength,
                textInputAction: TextInputAction.send,
                textCapitalization: TextCapitalization.sentences,
                onSubmitted: enabled ? (_) => onSend() : null,
                style: theme.textTheme.bodyLarge,
                decoration: InputDecoration(
                  hintText: 'Ask about policy, leave, pay…',
                  counterText: '',
                  filled: true,
                  fillColor: scheme.surfaceContainer,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ValueListenableBuilder(
              valueListenable: controller,
              builder: (context, value, _) {
                final hasText = value.text.trim().isNotEmpty;
                return AnimatedSwitcher(
                  duration: const Duration(milliseconds: 150),
                  transitionBuilder: (child, animation) => ScaleTransition(scale: animation, child: child),
                  child: hasText
                      ? IconButton.filled(
                          key: const ValueKey('send'),
                          tooltip: 'Send',
                          onPressed: enabled ? onSend : null,
                          style: IconButton.styleFrom(fixedSize: const Size.square(44)),
                          icon: const Icon(Icons.arrow_upward_rounded, size: 22),
                        )
                      : IconButton.filled(
                          key: const ValueKey('voice'),
                          tooltip: 'Voice',
                          onPressed: onVoice,
                          style: IconButton.styleFrom(
                            fixedSize: const Size.square(44),
                            backgroundColor: scheme.surfaceContainer,
                            foregroundColor: scheme.primary,
                          ),
                          icon: const Icon(Icons.graphic_eq_rounded, size: 22),
                        ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// Shown before the first question: who you are, and questions to start
/// with, grouped by where the answer comes from.
class _Welcome extends StatelessWidget {
  const _Welcome({required this.profile, required this.onAsk});

  final Profile profile;
  final void Function(String) onAsk;

  List<(IconData, String)> get _fromRecord => switch (profile.role) {
        Role.employee => const [
            (Icons.event_available_outlined, 'How many days of annual leave do I have left?'),
            (Icons.wb_sunny_outlined, 'When is my next public holiday?'),
            (Icons.health_and_safety_outlined, 'What benefits am I enrolled in?'),
          ],
        Role.manager => const [
            (Icons.inbox_outlined, 'Which leave requests are waiting for my approval?'),
            (Icons.groups_outlined, 'Who in my team is off in the next two weeks?'),
            (Icons.event_available_outlined, 'How many days of annual leave do I have left?'),
          ],
        Role.hrAdmin => const [
            (Icons.groups_outlined, 'Who in Finance is on leave this month?'),
            (Icons.event_available_outlined, 'How many days of annual leave do I have left?'),
          ],
      };

  List<(IconData, String)> get _fromHandbook => [
        (Icons.medical_services_outlined, "Do I need a doctor's note if I'm sick for two days?"),
        (Icons.event_repeat_outlined, 'Can I carry over unused leave?'),
        if (profile.role == Role.hrAdmin) (Icons.child_friendly_outlined, 'How does parental leave work?'),
      ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    Widget section(String header, List<(IconData, String)> items) => GroupedSection(
          header: header,
          children: [
            for (final (icon, q) in items)
              GroupedRow(leading: Icon(icon, size: 22, color: scheme.primary), title: q, onTap: () => onAsk(q)),
          ],
        );
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Hi ${profile.firstName}', style: theme.textTheme.headlineLarge),
              const SizedBox(height: 6),
              Text(
                'Ask about company policy or your own leave, pay and benefits. '
                'Policy answers link to the handbook page they come from.',
                style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        section(profile.role == Role.hrAdmin ? 'From HR records' : 'From your HR record', _fromRecord),
        const SizedBox(height: 24),
        section('From the handbook', _fromHandbook),
      ],
    );
  }
}

/// Your initials: who you are, your role, and sign out.
class _AccountMenu extends ConsumerWidget {
  const _AccountMenu({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return PopupMenuButton<void>(
      tooltip: 'Account',
      offset: const Offset(0, 48),
      icon: Monogram(name: profile.fullName, size: 30),
      itemBuilder: (context) => [
        PopupMenuItem(
          enabled: false,
          child: DefaultTextStyle.merge(
            style: TextStyle(color: theme.colorScheme.onSurface),
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(profile.fullName, style: theme.textTheme.titleMedium),
              subtitle: Text(
                '${profile.jobTitle} · ${profile.department}\n${profile.role.label}',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              isThreeLine: true,
            ),
          ),
        ),
        const PopupMenuDivider(),
        PopupMenuItem(
          onTap: () => ref.read(authProvider.notifier).signOut(),
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.logout),
            title: Text('Sign out', style: theme.textTheme.bodyLarge),
          ),
        ),
      ],
    );
  }
}
