import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/auth/session_manager.dart';

/// Favourite pharmacies stay on the phone for each account
/// (`nearpill_favourites_user_<id>`), the same way the cart does.
class FavouritesViewModel extends ChangeNotifier {
  FavouritesViewModel({
    required SessionManager sessionManager,
    FlutterSecureStorage? storage,
  })
      // ignore: prefer_initializing_formals
      : _sessionManager = sessionManager,
       _storage = storage ?? const FlutterSecureStorage();

  final SessionManager _sessionManager;
  final FlutterSecureStorage _storage;
  int? _userId;
  Set<int> _ids = const {};

  bool get signedIn => _userId != null;
  Set<int> get ids => Set.unmodifiable(_ids);
  bool isFavourite(int storeId) => _ids.contains(storeId);

  static String storageKey(int userId) => 'nearpill_favourites_user_$userId';

  /// Reads the signed-in account's favourites. Call when a screen opens.
  Future<void> refresh() async {
    final userId = await _sessionManager.getUserId();
    final next = userId == null ? <int>{} : await _read(userId);
    if (userId == _userId && setEquals(next, _ids)) return;
    _userId = userId;
    _ids = next;
    notifyListeners();
  }

  Future<void> toggle(int storeId) async {
    final userId = _userId;
    if (userId == null || storeId <= 0) return;
    final next = {..._ids};
    if (!next.add(storeId)) next.remove(storeId);
    _ids = next;
    notifyListeners();
    try {
      if (next.isEmpty) {
        await _storage.delete(key: storageKey(userId));
      } else {
        await _storage.write(
          key: storageKey(userId),
          value: jsonEncode(next.toList()..sort()),
        );
      }
    } catch (_) {
      // Storage unavailable: the heart still works until the app is closed.
    }
  }

  Future<Set<int>> _read(int userId) async {
    try {
      final raw = await _storage.read(key: storageKey(userId));
      return parseFavourites(raw);
    } catch (_) {
      return <int>{};
    }
  }
}

Set<int> parseFavourites(String? raw) {
  if (raw == null || raw.isEmpty) return <int>{};
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return <int>{};
    return decoded.whereType<int>().where((id) => id > 0).toSet();
  } catch (_) {
    return <int>{};
  }
}
