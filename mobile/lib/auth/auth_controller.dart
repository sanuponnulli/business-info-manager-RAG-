import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../config.dart';
import 'profile.dart';
import 'token_store.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(baseUrl: apiBaseUrl()));
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

/// Who is signed in: loading at startup, then a [Profile] or null (signed out).
final authProvider = AsyncNotifierProvider<AuthController, Profile?>(AuthController.new);

class AuthController extends AsyncNotifier<Profile?> {
  ApiClient get _api => ref.read(apiClientProvider);
  TokenStore get _tokens => ref.read(tokenStoreProvider);

  /// At startup: if a token was saved, check it's still good by asking the
  /// server who it belongs to. Expired or revoked → signed out, quietly.
  @override
  Future<Profile?> build() async {
    final saved = await _tokens.read();
    if (saved == null) return null;
    _api.token = saved;
    try {
      return await _fetchProfile();
    } on ApiException catch (e) {
      if (e.isUnauthorized) {
        await _forget();
        return null;
      }
      // Server unreachable: don't throw the token away, but show the login
      // screen; signing in again (or restarting later) recovers.
      _api.token = null;
      return null;
    }
  }

  /// Throws [ApiException] on failure so the login screen can show why.
  /// The state only changes on success, so the form stays on screen meanwhile.
  Future<void> signIn(String email, String password) async {
    final login = await _api.post('/api/v1/auth/login', {'email': email.trim(), 'password': password});
    final token = (login['data'] as Map<String, dynamic>)['accessToken'] as String;
    _api.token = token;
    try {
      final profile = await _fetchProfile();
      await _tokens.write(token);
      state = AsyncData(profile);
    } catch (_) {
      _api.token = null;
      rethrow;
    }
  }

  Future<void> signOut() async {
    await _forget();
    state = const AsyncData(null);
  }

  /// Call when any request comes back 401 (the token expired, or HR
  /// deactivated the account): back to the login screen.
  Future<void> sessionExpired() => signOut();

  Future<Profile> _fetchProfile() async {
    final me = await _api.get('/api/v1/me');
    return Profile.fromJson(me['data'] as Map<String, dynamic>);
  }

  Future<void> _forget() async {
    _api.token = null;
    await _tokens.clear();
  }
}
