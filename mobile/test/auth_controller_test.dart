import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:handbook_assistant/api/api_client.dart';
import 'package:handbook_assistant/auth/auth_controller.dart';
import 'package:handbook_assistant/auth/profile.dart';
import 'package:handbook_assistant/auth/token_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fakes.dart';

ProviderContainer containerWith(http.Client backend, TokenStore tokens) {
  final container = ProviderContainer(overrides: overridesFor(backend, tokens));
  addTearDown(container.dispose);
  return container;
}

void main() {
  test('starts signed out when no token is saved', () async {
    final c = containerWith(fakeBackend(), MemoryTokenStore());
    expect(await c.read(authProvider.future), isNull);
  });

  test('signing in stores the token and loads the profile, sending the token to /me', () async {
    final requests = <http.Request>[];
    final tokens = MemoryTokenStore();
    final c = containerWith(fakeBackend(role: 'MANAGER', log: requests), tokens);
    await c.read(authProvider.future);

    await c.read(authProvider.notifier).signIn(' employee@acme.test ', 'Password123!');

    final profile = c.read(authProvider).value!;
    expect(profile.fullName, 'Sneha Nair');
    expect(profile.role, Role.manager);
    expect(tokens.token, goodToken);
    expect(requests.first.body, contains('"email":"employee@acme.test"')); // trimmed
    expect(requests.last.headers['authorization'], 'Bearer $goodToken');
  });

  test('a wrong password throws the server message and stays signed out', () async {
    final tokens = MemoryTokenStore();
    final c = containerWith(fakeBackend(), tokens);
    await c.read(authProvider.future);

    await expectLater(
      c.read(authProvider.notifier).signIn('employee@acme.test', 'nope'),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Wrong email or password')),
    );
    expect(c.read(authProvider).value, isNull);
    expect(tokens.token, isNull);
  });

  test('restores a saved session at startup', () async {
    final c = containerWith(fakeBackend(), MemoryTokenStore(goodToken));
    expect((await c.read(authProvider.future))?.firstName, 'Sneha');
  });

  test('an expired saved token signs out quietly and is deleted', () async {
    final tokens = MemoryTokenStore('expired.token.value');
    final c = containerWith(fakeBackend(), tokens);
    expect(await c.read(authProvider.future), isNull);
    expect(tokens.token, isNull);
  });

  test('server down at startup: shows login but keeps the token for next time', () async {
    final down = MockClient((_) async => throw http.ClientException('Connection refused'));
    final tokens = MemoryTokenStore(goodToken);
    final c = containerWith(down, tokens);
    expect(await c.read(authProvider.future), isNull);
    expect(tokens.token, goodToken);
  });

  test('signing out forgets the token', () async {
    final tokens = MemoryTokenStore(goodToken);
    final c = containerWith(fakeBackend(), tokens);
    await c.read(authProvider.future);
    await c.read(authProvider.notifier).signOut();
    expect(c.read(authProvider).value, isNull);
    expect(tokens.token, isNull);
    expect(c.read(apiClientProvider).token, isNull);
  });
}
