import 'package:flutter/foundation.dart' show kReleaseMode;

/// Centralized mobile API configuration.
class ApiConfig {
  ApiConfig._();

  /// Release builds talk to the public NearPill site; debug builds default to the Android
  /// emulator's host machine. Override either with --dart-define=API_BASE_URL=https://...
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: kReleaseMode ? 'https://nearpill.xyz' : 'http://10.0.2.2:8080',
  );

  static const String apiPrefix = '/api/v1';

  static String apiPath(String path) {
    final normalized = path.startsWith('/') ? path : '/$path';
    return '$apiPrefix$normalized';
  }

  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 10);
}
