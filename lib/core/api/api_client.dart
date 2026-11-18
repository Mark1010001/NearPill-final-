import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../config/api_config.dart';
import '../auth/session_manager.dart';

class ApiClient {
  ApiClient({required this.sessionManager, this.onUnauthorized}) {
    final options = BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: ApiConfig.connectTimeout,
      receiveTimeout: ApiConfig.receiveTimeout,
      headers: const {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );
    _dio = Dio(options);
    _refreshDio = Dio(options);

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['skipSession'] != true) {
            final token = await sessionManager.getAccessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          handler.next(options);
        },
        onError: (DioException error, handler) async {
          final isAuthOperation =
              error.requestOptions.path == ApiConfig.apiPath('/auth/login') ||
              error.requestOptions.path == ApiConfig.apiPath('/auth/refresh');
          if (error.response?.statusCode == 401 &&
              !isAuthOperation &&
              error.requestOptions.extra['skipSession'] != true &&
              error.requestOptions.extra['retried'] != true) {
            final accessToken = await _refreshAccessToken();
            if (accessToken != null) {
              final retryOptions = error.requestOptions.copyWith(
                headers: {
                  ...error.requestOptions.headers,
                  'Authorization': 'Bearer $accessToken',
                },
                extra: {...error.requestOptions.extra, 'retried': true},
              );
              try {
                handler.resolve(await _dio.fetch(retryOptions));
                return;
              } on DioException catch (retryError) {
                handler.next(retryError);
                return;
              }
            }
          }

          if (kDebugMode) {
            debugPrint(
              'API error: ${error.type}; status: ${error.response?.statusCode}',
            );
          }
          handler.next(error);
        },
      ),
    );
  }

  final SessionManager sessionManager;
  final VoidCallback? onUnauthorized;

  late final Dio _dio;
  late final Dio _refreshDio;
  Future<String?>? _refreshInFlight;

  Dio get dio => _dio;

  Future<String?> _refreshAccessToken() {
    final current = _refreshInFlight;
    if (current != null) return current;

    final future = _performRefresh();
    _refreshInFlight = future;
    future.whenComplete(() {
      if (identical(_refreshInFlight, future)) {
        _refreshInFlight = null;
      }
    });
    return future;
  }

  Future<String?> _performRefresh() async {
    final refreshToken = await sessionManager.getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      await _handleUnauthorized(refreshToken);
      return null;
    }

    try {
      final response = await _refreshDio.post(
        ApiConfig.apiPath('/auth/refresh'),
        data: {'refreshToken': refreshToken},
        options: Options(
          validateStatus: (status) => status != null && status < 500,
        ),
      );

      if (response.statusCode == 200 && response.data is Map) {
        final data = Map<String, dynamic>.from(response.data as Map);
        final newAccessToken = data['accessToken']?.toString();
        final newRefreshToken = data['refreshToken']?.toString();
        if (newAccessToken != null &&
            newAccessToken.isNotEmpty &&
            newRefreshToken != null &&
            newRefreshToken.isNotEmpty) {
          final replaced = await sessionManager.replaceTokensIfCurrent(
            refreshToken,
            newAccessToken,
            newRefreshToken,
          );
          return replaced ? newAccessToken : null;
        }
      }
      if ([401, 403].contains(response.statusCode)) {
        await _handleUnauthorized(refreshToken);
      }
    } on DioException {
      // A network or server failure can be retried with the current session.
    }

    return null;
  }

  Future<void> _handleUnauthorized(String? refreshToken) async {
    if (await sessionManager.clearSessionIfCurrent(refreshToken)) {
      onUnauthorized?.call();
    }
  }

  void close() {
    _dio.close(force: true);
    _refreshDio.close(force: true);
  }
}
