import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/api/api_client.dart';
import 'package:nearpill/features/auth/data/auth_repository.dart';
import 'package:nearpill/core/auth/session_manager.dart';

void main() {
  for (final status in [400, 413]) {
    test('auth forms show a generic message for HTTP $status', () async {
      final client = ApiClient(sessionManager: SessionManager());
      addTearDown(() => client.dio.close(force: true));
      client.dio.interceptors.clear();
      client.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) => handler.reject(
            DioException(
              requestOptions: options,
              type: DioExceptionType.badResponse,
              response: Response(
                requestOptions: options,
                statusCode: status,
                data: {'error': 'Field-specific information must not be shown'},
              ),
            ),
          ),
        ),
      );
      final service = AuthRepository(apiClient: client);
      final genericError = isA<AuthException>().having(
        (error) => error.message,
        'message',
        'Please check your details and try again.',
      );
      await expectLater(
        service.login(email: 'test@example.com', password: 'test-password'),
        throwsA(genericError),
      );
      await expectLater(
        service.register(
          fullName: 'Test User',
          email: 'test@example.com',
          password: 'test-password',
        ),
        throwsA(genericError),
      );
    });
  }
}
