import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/auth/session_manager.dart';

void main() {
  test('a remembered login stays signed in when the app starts again', () async {
    FlutterSecureStorage.setMockInitialValues({
      'access_token': 'a',
      'refresh_token': 'r',
      'remember_me': '1',
    });
    expect(await SessionManager().isLoggedIn(), isTrue);
  });

  test('a login without Remember me is ended on the next app start', () async {
    FlutterSecureStorage.setMockInitialValues({
      'access_token': 'a',
      'refresh_token': 'r',
      'remember_me': '0',
    });
    final session = SessionManager();
    expect(await session.isLoggedIn(), isFalse);
    expect(await session.getAccessToken(), isNull);
    expect(await session.getRefreshToken(), isNull);
  });

  test('older logins with no saved choice stay signed in', () async {
    FlutterSecureStorage.setMockInitialValues({
      'access_token': 'a',
      'refresh_token': 'r',
    });
    expect(await SessionManager().isLoggedIn(), isTrue);
  });
}
