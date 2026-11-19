export '../data/auth_repository.dart' show AuthException;

import 'package:flutter/foundation.dart';

import '../../../models/auth_response_model.dart';
import '../../../models/user_model.dart';
import '../data/auth_repository.dart';

class AuthViewModel extends ChangeNotifier {
  AuthViewModel({required this._repository});

  final AuthRepository _repository;

  Future<void> requestPasswordReset({required String email}) =>
      _repository.requestPasswordReset(email: email);

  Future<void> register({
    required String fullName,
    required String email,
    required String password,
    bool acceptedTerms = false,
    String company = '',
    int formMs = 0,
  }) =>
      _repository.register(
        fullName: fullName,
        email: email,
        password: password,
        acceptedTerms: acceptedTerms,
        company: company,
        formMs: formMs,
      );

  Future<({String? devCode, bool testInbox})> sendOtp({required String email}) =>
      _repository.sendOtp(email: email);

  Future<({String? devCode, bool testInbox})> resendOtp({required String email}) =>
      _repository.resendOtp(email: email);

  Future<void> verifyOtp({required String email, required String code}) =>
      _repository.verifyOtp(email: email, code: code);

  Future<AuthResponseModel> login({
    required String email,
    required String password,
  }) =>
      _repository.login(email: email, password: password);

  Future<void> deleteAccount({required String password}) =>
      _repository.deleteAccount(password: password);

  Future<void> logoutAll() => _repository.logoutAll();
  Future<void> logout() => _repository.logout();
  Future<UserModel> getMe() => _repository.getMe();
  Future<void> updateProfile({String? phone}) =>
      _repository.updateProfile(phone: phone);
  Future<bool> isLoggedIn() => _repository.isLoggedIn();
}
