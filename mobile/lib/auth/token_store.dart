import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keeps the access token between app launches.
abstract interface class TokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();
}

/// The real store: iOS Keychain / Android Keystore-backed storage, not plain
/// SharedPreferences, because the token is a password-equivalent for an hour.
class SecureTokenStore implements TokenStore {
  static const _key = 'access_token';
  final _storage = const FlutterSecureStorage();

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String token) => _storage.write(key: _key, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// For tests.
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this.token]);
  String? token;

  @override
  Future<String?> read() async => token;

  @override
  Future<void> write(String token) async => this.token = token;

  @override
  Future<void> clear() async => token = null;
}
