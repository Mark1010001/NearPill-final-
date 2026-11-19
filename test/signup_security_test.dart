import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/api/api_client.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/auth/data/auth_repository.dart';
import 'package:nearpill/features/auth/presentation/auth_view_model.dart';
import 'package:nearpill/screens/auth_portal_screen.dart';
import 'package:nearpill/utils/formatters.dart';
import 'package:provider/provider.dart';

void main() {
  test('email rules match the server', () {
    for (final ok in ['ana@example.com', 'a.b+c@mail.example.co.ph']) {
      expect(validateEmailAddress(ok), isNull, reason: ok);
    }
    for (final bad in [
      '',
      'ana',
      'ana@example',
      'ana@example..com',
      'ana@example.c1',
      'ana @example.com',
      '.ana@example.com',
      'ana..b@example.com',
      '${'a' * 64}b@example.com',
    ]) {
      expect(validateEmailAddress(bad), emailErrorText, reason: bad);
    }
  });

  test('new password rules match the server', () {
    expect(validateNewPassword('Strong1!pass', 'a@example.com', 'Ana Cruz'), isNull);
    for (final weak in ['short1', 'onlyletterspassword', '12345678901234']) {
      expect(
        validateNewPassword(weak, 'a@example.com', 'Ana Cruz'),
        passwordRuleText,
        reason: weak,
      );
    }
    expect(validateNewPassword('Password123', 'a@example.com', 'x'), isNotNull);
    expect(validateNewPassword('anacruz12345', 'anacruz12345', 'x'), isNotNull);
    expect(validateNewPassword('a1' * 65, 'a@example.com', 'x'), isNotNull);
  });

  testWidgets('an invalid email or weak password stops sign-up at step 1', (
    tester,
  ) async {
    final repo = _Repo();
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AuthViewModel(repository: repo),
        child: const MaterialApp(home: AuthPortalScreen()),
      ),
    );
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'ana@example');
    await tester.enterText(fields.at(1), 'Strong1!pass');
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Continue'));
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    expect(find.text(emailErrorText), findsOneWidget);
    await tester.enterText(fields.at(0), 'ana@example.com');
    await tester.enterText(fields.at(1), 'short1');
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Continue'));
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    expect(find.text(passwordRuleText), findsWidgets);
    expect(find.text('Step 1 of 3'), findsOneWidget);
    expect(repo.sendOtpCalls, 0);
  });

  testWidgets('terms are required before a code is sent, and a rejected email goes back', (
    tester,
  ) async {
    final repo = _Repo(rejectEmail: true);
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AuthViewModel(repository: repo),
        child: const MaterialApp(home: AuthPortalScreen()),
      ),
    );
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'ana@example.com');
    await tester.enterText(fields.at(1), 'Strong1!pass');
    await tester.enterText(fields.at(2), 'Strong1!pass');
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Continue'));
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), 'Ana Cruz');
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Continue'));
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    expect(
      find.text('Agree to the Terms and Conditions and Privacy Policy to continue.'),
      findsOneWidget,
    );
    expect(repo.sendOtpCalls, 0);
    await tester.tap(find.byKey(const Key('signup-terms')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Continue'));
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    expect(repo.sendOtpCalls, 1);
    expect(find.text('Step 1 of 3'), findsOneWidget);
    expect(find.text(emailErrorText), findsWidgets);
  });
  testWidgets('a repeat password that does not match is flagged live and blocks Continue', (
    tester,
  ) async {
    final repo = _Repo();
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AuthViewModel(repository: repo),
        child: const MaterialApp(home: AuthPortalScreen()),
      ),
    );
    await tester.ensureVisible(find.text('Create account'));
    await tester.tap(find.text('Create account'));
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'ana@example.com');
    await tester.enterText(fields.at(1), 'Strong1!pass');
    await tester.enterText(fields.at(2), 'Strong1!pasx');
    await tester.pumpAndSettle();
    expect(find.text('Passwords do not match'), findsOneWidget);
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Continue'));
    await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Step 1 of 3'), findsOneWidget);
    await tester.enterText(fields.at(2), 'Strong1!pass');
    await tester.pumpAndSettle();
    expect(find.text('Passwords do not match'), findsNothing);
  });
}

class _Repo extends AuthRepository {
  _Repo({this.rejectEmail = false})
    : super(apiClient: ApiClient(sessionManager: SessionManager()));
  final bool rejectEmail;
  int sendOtpCalls = 0;

  @override
  Future<({String? devCode, bool testInbox})> sendOtp({
    required String email,
  }) async {
    sendOtpCalls++;
    if (rejectEmail) throw AuthException('Invalid request.', statusCode: 400);
    return (devCode: null, testInbox: false);
  }
}
