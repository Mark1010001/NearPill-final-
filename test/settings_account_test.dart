import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/api/api_client.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/auth/data/auth_repository.dart';
import 'package:nearpill/features/auth/presentation/auth_view_model.dart';
import 'package:nearpill/screens/settings_screen.dart';
import 'package:provider/provider.dart';

ApiClient _client(Map<String, Response<dynamic> Function(RequestOptions)> routes,
    List<RequestOptions> seen, [SessionManager? session]) {
  final client = ApiClient(sessionManager: session ?? SessionManager());
  client.dio.interceptors.clear();
  client.dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        seen.add(options);
        final route = routes['${options.method} ${options.path}'];
        if (route == null) {
          handler.reject(
            DioException(
              requestOptions: options,
              type: DioExceptionType.connectionError,
            ),
          );
          return;
        }
        final response = route(options);
        if ((response.statusCode ?? 200) >= 400) {
          handler.reject(
            DioException(
              requestOptions: options,
              response: response,
              type: DioExceptionType.badResponse,
            ),
          );
        } else {
          handler.resolve(response);
        }
      },
    ),
  );
  return client;
}

Response<dynamic> _json(RequestOptions o, int status, Object data) =>
    Response(requestOptions: o, statusCode: status, data: data);

void main() {
  testWidgets('settings shows the account email and opens delete account', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SettingsScreen(
          email: 'ana@example.com',
          onAccountDeleted: () async {},
        ),
      ),
    );
    expect(find.text('ana@example.com'), findsOneWidget);
    expect(find.text('Privacy and service information'), findsOneWidget);
    await tester.tap(find.text('Delete account'));
    await tester.pumpAndSettle();
    expect(find.text('Delete my account'), findsOneWidget);
    expect(find.text('Use Google instead'), findsNothing);
  });

  testWidgets('delete account needs a password, confirms, then signs out', (
    tester,
  ) async {
    final seen = <RequestOptions>[];
    final client = _client({
      'POST /api/v1/auth/delete-account': (o) =>
          _json(o, 200, {'message': 'Your account has been deleted.'}),
    }, seen);
    addTearDown(() => client.dio.close(force: true));
    var signedOut = 0;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthViewModel>.value(
        value: AuthViewModel(repository: AuthRepository(apiClient: client)),
        child: MaterialApp(
          home: DeleteAccountScreen(onAccountDeleted: () async => signedOut++),
        ),
      ),
    );
    await tester.tap(find.text('Delete my account'));
    await tester.pump();
    expect(find.text('Enter your password to confirm.'), findsOneWidget);
    expect(seen, isEmpty);

    await tester.enterText(find.byType(TextField), 'correct-password');
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    expect(find.text('Delete your account?'), findsOneWidget);
    await tester.tap(find.text('Keep account'));
    await tester.pumpAndSettle();
    expect(seen, isEmpty);
    expect(signedOut, 0);

    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Delete account'));
    await tester.pumpAndSettle();
    expect(seen.single.data, {'password': 'correct-password'});
    expect(signedOut, 1);
  });

  testWidgets('delete account shows the server reason for active orders', (
    tester,
  ) async {
    final client = _client({
      'POST /api/v1/auth/delete-account': (o) => _json(o, 409, {
        'error': 'Finish or cancel your active orders before deleting.',
      }),
    }, []);
    addTearDown(() => client.dio.close(force: true));
    var signedOut = 0;
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthViewModel>.value(
        value: AuthViewModel(repository: AuthRepository(apiClient: client)),
        child: MaterialApp(
          home: DeleteAccountScreen(onAccountDeleted: () async => signedOut++),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'pw');
    await tester.tap(find.text('Delete my account'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Delete account'));
    await tester.pumpAndSettle();
    expect(
      find.text('Finish or cancel your active orders before deleting.'),
      findsOneWidget,
    );
    expect(signedOut, 0);
  });
}
