/// A handbook passage the answer was based on. `n` matches the [n] in the answer.
class Source {
  const Source({required this.n, required this.cited, required this.title, required this.page, required this.text});

  factory Source.fromJson(Map<String, dynamic> json) => Source(
        n: json['n'] as int,
        cited: json['cited'] as bool? ?? false,
        title: json['title'] as String,
        page: json['page'] as int,
        text: json['text'] as String,
      );

  final int n;
  final bool cited;
  final String title;
  final int page;
  final String text;
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.fromUser,
    required this.text,
    this.sources = const [],
    this.toolsUsed = const [],
    this.error,
  });

  final int id;
  final bool fromUser;
  final String text;

  /// Answers only: handbook passages, and the tools the assistant used.
  final List<Source> sources;
  final List<String> toolsUsed;

  /// Questions only: why sending failed (shown with a Retry button).
  final String? error;

  List<Source> get citedSources => sources.where((s) => s.cited).toList();

  /// HR lookups the answer used, in plain words ("Leave balances", ...).
  List<String> get recordsUsed => toolsUsed.map((t) => _toolLabels[t]).whereType<String>().toSet().toList();

  ChatMessage withError(String? error) =>
      ChatMessage(id: id, fromUser: fromUser, text: text, sources: sources, toolsUsed: toolsUsed, error: error);
}

/// Tool names from the server (server/src/tools/registry.ts) → labels.
/// search_handbook is left out: handbook answers show their sources instead.
const _toolLabels = {
  'get_my_profile': 'Your profile',
  'get_my_leave_balances': 'Leave balances',
  'list_my_leave_requests': 'Leave requests',
  'get_my_holidays': 'Public holidays',
  'get_my_pay': 'Payslips',
  'get_my_benefits': 'Benefits',
  'find_colleagues': 'Directory',
  'get_team_leave': 'Team leave',
};

class ChatState {
  const ChatState({this.messages = const [], this.sending = false});

  final List<ChatMessage> messages;

  /// Waiting for an answer: the input is disabled and a "thinking" bubble shows.
  final bool sending;

  ChatState copyWith({List<ChatMessage>? messages, bool? sending}) =>
      ChatState(messages: messages ?? this.messages, sending: sending ?? this.sending);
}
