import 'dart:async';

import 'package:dio/dio.dart';

import '../../../models/auth_response_model.dart';
import '../../../models/user_model.dart';
import '../../../core/api/api_client.dart';
import '../../../config/api_config.dart';

class AuthException implements Exception {
  AuthException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class AuthRepository {
  AuthRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<void> requestPasswordReset({required String email}) async {
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/auth/forgot-password'),
        data: {'email': email},
      );
      if (response.statusCode != 200) {
        throw AuthException(
          'Unable to request a reset. Please try again later.',
        );
      }
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<void> register({
    required String fullName,
    required String email,
    required String password,
    bool acceptedTerms = false,
    String company = '',
    int formMs = 0,
  }) async {
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/auth/register'),
        data: {
          'fullName': fullName,
          'email': email,
          'password': password,
          'acceptedTerms': acceptedTerms,
          'company': company,
          'formMs': formMs,
        },
      );

      if (response.statusCode != 201) {
        throw AuthException('Registration failed. Please try again.');
      }
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<({String? devCode, bool testInbox})> sendOtp({
    required String email,
  }) async {
    return await _requestOtp(ApiConfig.apiPath('/auth/send-otp'), email);
  }

  Future<({String? devCode, bool testInbox})> resendOtp({
    required String email,
  }) async {
    return await _requestOtp(ApiConfig.apiPath('/auth/send-otp'), email);
  }

  Future<({String? devCode, bool testInbox})> _requestOtp(
    String path,
    String email,
  ) async {
    try {
      final response = await apiClient.dio.post(path, data: {'email': email});
      if (response.statusCode != 200) {
        throw AuthException('Unable to send verification code.');
      }
      return (
        devCode: response.data is Map
            ? response.data['devCode']?.toString()
            : null,
        testInbox: response.data is Map && response.data['testInbox'] == true,
      );
    } on DioException catch (error) {
      if (error.response?.data is Map &&
          error.response?.data['error'] != null) {
        throw AuthException(
          error.response!.data['error'].toString(),
          statusCode: error.response?.statusCode,
        );
      }
      throw _mapError(error);
    }
  }

  Future<void> verifyOtp({required String email, required String code}) async {
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/auth/verify-otp'),
        data: {'email': email, 'code': code},
      );
      if (response.statusCode != 200) {
        throw AuthException('The code is invalid or expired.');
      }
    } on DioException catch (error) {
      if (error.response?.data is Map &&
          error.response?.data['error'] != null) {
        throw AuthException(error.response!.data['error'].toString());
      }
      throw _mapError(error);
    }
  }

  Future<AuthResponseModel> login({
    required String email,
    required String password,
    bool remember = true,
  }) async {
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/auth/login'),
        data: {'email': email, 'password': password},
      );

      if (response.statusCode != 200) {
        throw AuthException(
          'Unable to sign in. Check your details or try again later.',
        );
      }

      final authResponse = AuthResponseModel.fromJson(
        Map<String, dynamic>.from(response.data as Map),
      );

      if (authResponse.accessToken != null &&
          authResponse.refreshToken != null) {
        await apiClient.sessionManager.saveTokens(
          authResponse.accessToken!,
          authResponse.refreshToken!,
          userId: authResponse.user?.id,
        );
        await apiClient.sessionManager.setRemember(remember);
      }

      return authResponse;
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<void> deleteAccount({required String password}) async {
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/auth/delete-account'),
        data: {'password': password},
      );
      if (response.statusCode != 200) {
        throw AuthException('Unable to delete your account. Try again later.');
      }
    } on DioException catch (error) {
      final message = _serverMessage(error);
      if (message != null) throw AuthException(message);
      throw _mapError(error);
    }
  }

  String? _serverMessage(DioException error) {
    final data = error.response?.data;
    if (data is Map && data['error'] != null) {
      final text = data['error'].toString();
      if (text.isNotEmpty) return text;
    }
    return null;
  }

  Future<void> logoutAll() async {
    try {
      final response = await apiClient.dio.post(
        ApiConfig.apiPath('/auth/logout-all'),
        data: <String, dynamic>{},
      );
      if (response.statusCode != 200) {
        throw AuthException('Could not sign you out of all devices.');
      }
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<void> logout() async {
    final refreshToken = await apiClient.sessionManager.endSession();
    if (refreshToken != null && refreshToken.isNotEmpty) {
      unawaited(_notifyServerLogout(refreshToken));
    }
  }

  Future<void> _notifyServerLogout(String refreshToken) async {
    try {
      await apiClient.dio.post(
        ApiConfig.apiPath('/auth/logout'),
        data: {'refreshToken': refreshToken},
        options: Options(extra: {'skipSession': true}),
      );
    } catch (_) {}
  }

  Future<UserModel> getMe() async {
    try {
      final response = await apiClient.dio.get(ApiConfig.apiPath('/auth/me'));
      if (response.statusCode != 200) {
        throw AuthException('Unable to load profile.');
      }

      return UserModel.fromJson(
        Map<String, dynamic>.from(response.data as Map),
      );
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<void> updateProfile({String? phone}) async {
    try {
      final response = await apiClient.dio.put(
        ApiConfig.apiPath('/auth/me'),
        data: {'phone': phone},
      );
      if (response.statusCode != 200) {
        throw AuthException('Failed to update profile.');
      }
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<bool> isLoggedIn() async {
    try {
      return await apiClient.sessionManager.isLoggedIn();
    } catch (e) {
      return false;
    }
  }

  AuthException _mapError(DioException error) {
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.receiveTimeout) {
      return AuthException(
        'Unable to reach the server. Please check your connection and try again.',
      );
    }

    if (error.response?.statusCode == 401) {
      return AuthException(
        'Unable to sign in. Check your details or try again later.',
      );
    }

    if (error.response?.statusCode == 400 ||
        error.response?.statusCode == 413) {
      return AuthException('Please check your details and try again.');
    }

    return AuthException('Something went wrong. Please try again.');
  }
}
