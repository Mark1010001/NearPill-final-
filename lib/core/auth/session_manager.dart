import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionManager {
  SessionManager({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _accessTokenKey = 'access_token';
  static const _refreshTokenKey = 'refresh_token';
  static const _userIdKey = 'user_id';
  static const _rememberKey = 'remember_me';

  final FlutterSecureStorage _storage;
  Future<void> _writes = Future.value();

  Future<T> _write<T>(Future<T> Function() change) {
    final next = _writes.then((_) => change());
    _writes = next.then<void>((_) {}, onError: (_, _) {});
    return next;
  }

  Future<void> saveTokens(
    String accessToken,
    String refreshToken, {
    int? userId,
  }) => _write(() async {
    if (accessToken.isEmpty || refreshToken.isEmpty) {
      throw ArgumentError('Both access and refresh credentials are required.');
    }
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
    await _storage.write(key: _accessTokenKey, value: accessToken);
    if (userId != null) {
      await _storage.write(key: _userIdKey, value: userId.toString());
    } else {
      await _storage.delete(key: _userIdKey);
    }
  });

  Future<String?> getAccessToken() =>
      _writes.then((_) => _storage.read(key: _accessTokenKey));
  Future<String?> getRefreshToken() =>
      _writes.then((_) => _storage.read(key: _refreshTokenKey));
  Future<int?> getUserId() async => int.tryParse(
    (await _writes.then((_) => _storage.read(key: _userIdKey))) ?? '',
  );

  Future<bool> replaceTokensIfCurrent(
    String previousRefresh,
    String access,
    String refresh,
  ) => _write(() async {
    if (await _storage.read(key: _refreshTokenKey) != previousRefresh) {
      return false;
    }
    await _storage.write(key: _refreshTokenKey, value: refresh);
    await _storage.write(key: _accessTokenKey, value: access);
    return true;
  });

  Future<bool> clearSessionIfCurrent(String? previousRefresh) =>
      _write(() async {
        if (await _storage.read(key: _refreshTokenKey) != previousRefresh) {
          return false;
        }
        await _clear();
        return true;
      });

  Future<String?> endSession() => _write(() async {
    final refresh = await _storage.read(key: _refreshTokenKey);
    await _clear();
    return refresh;
  });

  Future<void> _clear() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _userIdKey);
  }

  /// "Remember me" choice from the last login. Off = sign in again the next time the app starts.
  Future<void> setRemember(bool remember) =>
      _write(() => _storage.write(key: _rememberKey, value: remember ? '1' : '0'));

  /// Checked once when the app starts. If the last login was not remembered, end that session.
  Future<bool> isLoggedIn() async {
    if (await _writes.then((_) => _storage.read(key: _rememberKey)) == '0') {
      await _write(() async {
        await _clear();
        await _storage.delete(key: _rememberKey);
      });
      return false;
    }
    final accessToken = await getAccessToken();
    final refreshToken = await getRefreshToken();
    return (accessToken?.isNotEmpty ?? false) &&
        (refreshToken?.isNotEmpty ?? false);
  }
}
