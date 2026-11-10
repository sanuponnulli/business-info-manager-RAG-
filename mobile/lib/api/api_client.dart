import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// A failed request, in the backend's error shape:
///   { "error": { "code": "...", "message": "..." } }
class ApiException implements Exception {
  const ApiException(this.status, this.code, this.message);

  /// HTTP status; 0 when the server couldn't be reached at all.
  final int status;
  final String code;
  final String message;

  bool get isUnauthorized => status == 401;

  @override
  String toString() => 'ApiException($status $code: $message)';
}

/// Talks JSON to the backend. Holds the signed-in user's token and sends it
/// as `Authorization: Bearer ...` on every request.
class ApiClient {
  ApiClient({required this.baseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final Uri baseUrl;
  final http.Client _http;

  /// Set after sign-in, cleared on sign-out.
  String? token;

  /// Chat answers can take a while (tool calls, a busy model), so allow up to
  /// a minute. The server itself gives up and answers `ai_busy` well before that.
  static const timeout = Duration(seconds: 60);

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, Map<String, Object?> body) => _send('POST', path, body);

  Future<Map<String, dynamic>> _send(String method, String path, [Map<String, Object?>? body]) async {
    final request = http.Request(method, baseUrl.resolve(path))
      ..headers['accept'] = 'application/json'
      ..headers.addAll({if (token != null) 'authorization': 'Bearer $token'});
    if (body != null) {
      request
        ..headers['content-type'] = 'application/json'
        ..body = jsonEncode(body);
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(request).timeout(timeout));
    } on TimeoutException {
      throw const ApiException(0, 'timeout', 'The server took too long to answer. Please try again.');
    } on http.ClientException {
      throw ApiException(0, 'network_error', "Can't reach the server at ${baseUrl.authority}. Is it running?");
    }

    final json = _decode(response.body);
    if (response.statusCode >= 400) {
      final error = json?['error'];
      throw ApiException(
        response.statusCode,
        error is Map ? '${error['code']}' : 'http_error',
        error is Map ? '${error['message']}' : 'Request failed (${response.statusCode})',
      );
    }
    if (json == null) throw ApiException(response.statusCode, 'bad_response', 'The server sent an unexpected response.');
    return json;
  }

  static Map<String, dynamic>? _decode(String body) {
    try {
      final value = jsonDecode(body);
      return value is Map<String, dynamic> ? value : null;
    } on FormatException {
      return null;
    }
  }
}
