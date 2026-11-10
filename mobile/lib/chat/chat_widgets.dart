import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../ui/theme.dart';
import 'chat_models.dart';

/// The user's question: a grey bubble on the right. A failed question says
/// why underneath, with Try Again.
class QuestionBubble extends StatelessWidget {
  const QuestionBubble({super.key, required this.message, required this.onRetry, required this.canRetry});

  final ChatMessage message;
  final VoidCallback onRetry;
  final bool canRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
            child: DecoratedBox(
              decoration: BoxDecoration(color: scheme.surfaceContainerHigh, borderRadius: BorderRadius.circular(20)),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
                child: SelectableText(message.text, style: theme.textTheme.bodyLarge),
              ),
            ),
          ),
        ),
        if (message.error != null)
          Padding(
            padding: const EdgeInsets.only(top: 2, right: 4),
            child: Wrap(
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Icon(Icons.error_outline, size: 15, color: scheme.error),
                const SizedBox(width: 5),
                Text(message.error!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.error)),
                TextButton(onPressed: canRetry ? onRetry : null, child: const Text('Try Again')),
              ],
            ),
          ),
      ],
    );
  }
}

/// Who is talking: the mark and name above each answer.
class AssistantLabel extends StatelessWidget {
  const AssistantLabel({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        const BrandMark(size: 20),
        const SizedBox(width: 8),
        Text('Acme Assistant', style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

/// The assistant's answer, set as text to read (no bubble), then where it
/// came from: handbook pages to open, and which HR records it used.
class AnswerBubble extends StatelessWidget {
  const AnswerBubble({super.key, required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cited = message.citedSources;
    final records = message.recordsUsed;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const AssistantLabel(),
        const SizedBox(height: 8),
        MarkdownBody(data: message.text, selectable: true, styleSheet: _markdownStyle(theme)),
        if (cited.isNotEmpty) ...[
          const SizedBox(height: 14),
          _SourceList(sources: cited),
        ],
        if (records.isNotEmpty) ...[
          const SizedBox(height: 12),
          _RecordsUsed(records: records),
        ],
      ],
    );
  }
}

MarkdownStyleSheet _markdownStyle(ThemeData theme) {
  final t = theme.textTheme;
  final body = t.bodyLarge?.copyWith(height: 1.4);
  return MarkdownStyleSheet.fromTheme(theme).copyWith(
    p: body,
    listBullet: body,
    strong: const TextStyle(fontWeight: FontWeight.w600),
    h1: t.titleLarge,
    h2: t.titleMedium,
    h3: t.titleMedium,
    h1Padding: const EdgeInsets.only(top: 6),
    h2Padding: const EdgeInsets.only(top: 6),
    h3Padding: const EdgeInsets.only(top: 4),
    blockSpacing: 10,
    listIndent: 22,
    horizontalRuleDecoration: BoxDecoration(border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant, width: 0.5))),
    blockquoteDecoration: BoxDecoration(border: Border(left: BorderSide(color: theme.colorScheme.outline, width: 3))),
    blockquotePadding: const EdgeInsets.only(left: 12),
    code: t.bodyMedium?.copyWith(fontFamily: 'Menlo', backgroundColor: theme.colorScheme.surfaceContainer),
  );
}

/// "Sources": one row per cited handbook page. Tapping opens the passage.
class _SourceList extends StatelessWidget {
  const _SourceList({required this.sources});

  final List<Source> sources;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ClipRRect(
      key: const Key('sources'),
      borderRadius: BorderRadius.circular(14),
      child: ColoredBox(
        color: scheme.surfaceContainer,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 2),
              child: Text('Sources', style: theme.textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant)),
            ),
            for (final s in sources)
              Material(
                type: MaterialType.transparency,
                child: InkWell(
                  key: Key('source-${s.n}'),
                  onTap: () => showSourceSheet(context, s),
                  child: Semantics(
                    button: true,
                    label: 'Source ${s.n}: ${s.title}, page ${s.page}',
                    excludeSemantics: true,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
                      child: Row(
                        children: [
                          _NumberBadge(n: s.n),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(s.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodyMedium),
                          ),
                          const SizedBox(width: 8),
                          Text('p. ${s.page}', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
                          Icon(Icons.chevron_right, size: 20, color: scheme.outline),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

/// The citation number as it appears in the answer text ("[1]").
class _NumberBadge extends StatelessWidget {
  const _NumberBadge({required this.n});

  final int n;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: scheme.primary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(6)),
      child: Text('$n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: scheme.primary)),
    );
  }
}

/// Which parts of the user's HR record the answer read.
class _RecordsUsed extends StatelessWidget {
  const _RecordsUsed({required this.records});

  final List<String> records;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final small = theme.textTheme.labelMedium;
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.lock_outline, size: 14, color: scheme.onSurfaceVariant),
            const SizedBox(width: 4),
            Text('From your HR record', style: small?.copyWith(color: scheme.onSurfaceVariant)),
          ],
        ),
        for (final r in records)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: scheme.surfaceContainer, borderRadius: BorderRadius.circular(7)),
            child: Text(r, style: small),
          ),
      ],
    );
  }
}

/// Shown while the answer is on its way.
class ThinkingBubble extends StatelessWidget {
  const ThinkingBubble({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AssistantLabel(),
        SizedBox(height: 12),
        Padding(padding: EdgeInsets.only(left: 2), child: TypingDots()),
      ],
    );
  }
}

/// The handbook passage behind a citation, so the user can check the answer.
void showSourceSheet(BuildContext context, Source source) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (context) {
      final theme = Theme.of(context);
      final scheme = theme.colorScheme;
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.55,
        maxChildSize: 0.92,
        builder: (context, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
          children: [
            Row(
              children: [
                _NumberBadge(n: source.n),
                const SizedBox(width: 8),
                Text('Page ${source.page}', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 8),
            Text(source.title, style: theme.textTheme.headlineSmall),
            const SizedBox(height: 20),
            DecoratedBox(
              decoration: BoxDecoration(border: Border(left: BorderSide(color: scheme.primary, width: 3))),
              child: Padding(
                padding: const EdgeInsets.only(left: 14),
                child: SelectableText(
                  source.text.replaceAll(RegExp(r'\s+'), ' ').trim(),
                  style: theme.textTheme.bodyLarge?.copyWith(height: 1.5),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'The passage the answer was based on, as it appears in the handbook.',
              style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      );
    },
  );
}
