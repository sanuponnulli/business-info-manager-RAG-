import 'dart:convert';

import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:handbook_assistant/api/api_client.dart';
import 'package:handbook_assistant/auth/auth_controller.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const goodToken = 'header.payload.signature';

Map<String, Object?> meJson({String role = 'EMPLOYEE'}) => {
      'id': 7,
      'employeeCode': 'E0007',
      'firstName': 'Sneha',
      'lastName': 'Nair',
      'email': 'employee@acme.test',
      'jobTitle': 'Flutter Developer',
      'department': {'id': 2, 'code': 'ENG', 'name': 'Engineering'},
      'location': {'id': 2, 'code': 'COK', 'name': 'Kochi Office'},
      'role': role,
    };

http.Response json(int status, Object body) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

/// A pretend backend: the right password gets [goodToken]; /me answers only for it.
/// [onAsk] answers POST /api/v1/chat/ask (signed-in requests only).
MockClient fakeBackend({String role = 'EMPLOYEE', List<http.Request>? log, Future<http.Response> Function(http.Request)? onAsk}) =>
    MockClient((req) async {
      log?.add(req);
      if (req.url.path == '/api/v1/chat/ask' && onAsk != null) return onAsk(req);
      if (req.url.path == '/api/v1/auth/login') {
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        return body['password'] == 'Password123!'
            ? json(200, {
                'data': {'accessToken': goodToken, 'tokenType': 'Bearer', 'expiresIn': 3600}
              })
            : json(401, {
                'error': {'code': 'invalid_credentials', 'message': 'Wrong email or password'}
              });
      }
      if (req.url.path == '/api/v1/me') {
        return req.headers['authorization'] == 'Bearer $goodToken'
            ? json(200, {'data': meJson(role: role)})
            : json(401, {
                'error': {'code': 'unauthorized', 'message': 'Sign in again'}
              });
      }
      return json(404, {
        'error': {'code': 'not_found', 'message': 'nope'}
      });
    });

List<Override> overridesFor(http.Client backend, TokenStore tokens) => [
      apiClientProvider.overrideWithValue(ApiClient(baseUrl: Uri.parse('http://test'), httpClient: backend)),
      tokenStoreProvider.overrideWithValue(tokens),
    ];

/// A chat answer in the server's shape.
http.Response answer(String text, {List<Map<String, Object?>> sources = const [], List<String> toolsUsed = const []}) =>
    json(200, {'answer': text, 'sources': sources, 'toolsUsed': toolsUsed});

Map<String, Object?> source(int n, {bool cited = true, int page = 8}) =>
    {'n': n, 'cited': cited, 'title': 'Acme Employee Handbook 2026', 'page': page, 'docId': 'acme', 'score': 0.7, 'text': 'Passage $n text.'};
