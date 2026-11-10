import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../auth/auth_controller.dart';
import 'chat_models.dart';

/// The conversation on screen. It starts empty for each signed-in user:
/// signing out (or in as someone else) throws the old conversation away.
final chatProvider = NotifierProvider<ChatController, ChatState>(ChatController.new);

class ChatController extends Notifier<ChatState> {
  /// The server accepts at most 20 earlier turns of up to 4000 characters.
  static const maxHistoryTurns = 20;
  static const maxTurnLength = 4000;
  static const maxQuestionLength = 2000;

  int _nextId = 0;

  /// Bumped on every rebuild (new user). An answer that arrives for an older
  /// conversation is dropped instead of appearing in the new one.
  int _generation = 0;

  @override
  ChatState build() {
    ref.watch(authProvider.select((auth) => auth.value?.id));
    _generation++;
    return const ChatState();
  }

  Future<void> send(String text) async {
    final question = text.trim();
    if (question.isEmpty || state.sending) return;

    final history = _history();
    final asked = ChatMessage(id: _nextId++, fromUser: true, text: question);
    state = state.copyWith(messages: [...state.messages, asked], sending: true);
    final generation = _generation;
    // After the await, this conversation may be gone: cleared, a new user,
    // or the app shutting down (the provider is disposed). Then drop the reply.
    bool stale() => !ref.mounted || generation != _generation;

    try {
      final json = await ref.read(apiClientProvider).post('/api/v1/chat/ask', {
        'question': question.length > maxQuestionLength ? question.substring(0, maxQuestionLength) : question,
        'history': history,
      });
      if (stale()) return;
      final answer = ChatMessage(
        id: _nextId++,
        fromUser: false,
        text: json['answer'] as String,
        sources: [for (final s in json['sources'] as List) Source.fromJson(s as Map<String, dynamic>)],
        toolsUsed: [for (final t in json['toolsUsed'] as List? ?? const []) t as String],
      );
      state = state.copyWith(messages: [...state.messages, answer], sending: false);
    } on ApiException catch (e) {
      if (stale()) return;
      if (e.isUnauthorized) {
        // Token expired or account deactivated: back to the login screen.
        await ref.read(authProvider.notifier).sessionExpired();
        return;
      }
      _fail(asked.id, e.message);
    } catch (_) {
      // An answer we couldn't read: never leave the input stuck in "sending".
      if (!stale()) _fail(asked.id, 'Something went wrong. Please try again.');
    }
  }

  void _fail(int messageId, String error) {
    state = state.copyWith(
      messages: [for (final m in state.messages) m.id == messageId ? m.withError(error) : m],
      sending: false,
    );
  }

  /// Sends a failed question again (it moves to the end of the conversation).
  Future<void> retry(int messageId) async {
    final failed = state.messages.where((m) => m.id == messageId && m.error != null).firstOrNull;
    if (failed == null || state.sending) return;
    state = state.copyWith(messages: state.messages.where((m) => m.id != messageId).toList());
    await send(failed.text);
  }

  void clear() {
    if (state.sending) return;
    _generation++;
    state = const ChatState();
  }

  /// Earlier turns for follow-up questions ("and for part-timers?").
  /// The server keeps no conversation state, so the app sends it each time.
  /// Failed questions are left out: they never got an answer.
  List<Map<String, String>> _history() {
    final turns = state.messages.where((m) => m.error == null).map((m) => {
          'role': m.fromUser ? 'user' : 'model',
          'text': m.text.length > maxTurnLength ? m.text.substring(0, maxTurnLength) : m.text,
        });
    final list = turns.toList();
    return list.length > maxHistoryTurns ? list.sublist(list.length - maxHistoryTurns) : list;
  }
}
