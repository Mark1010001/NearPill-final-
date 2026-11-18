import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../../models/order_model.dart';
import '../pickup.dart';
import '../data/order_repository.dart';

/// One order and what changed about it.
class OrderUpdate {
  const OrderUpdate({
    required this.order,
    required this.stage,
    required this.message,
    required this.unread,
  });

  final OrderModel order;
  final String stage;
  final String message;
  final bool unread;
}

/// 'placed', 'preparing', 'ready', 'completed', 'cancelled' or 'expired'.
String updateStage(OrderModel order) {
  switch (order.stage.toLowerCase()) {
    case 'preparing':
      return 'preparing';
    case 'ready':
    case 'ready_for_pickup':
      return 'ready';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return 'placed';
  }
}

bool _activeStage(String stage) =>
    stage == 'placed' || stage == 'preparing' || stage == 'ready';

/// 'today' or 'missed' while an active order's pickup date is today or already passed.
String? orderPickupFlag(OrderModel order, [DateTime? now]) =>
    pickupFlag(order.pickupDate, _activeStage(updateStage(order)), now);

String _seenKey(OrderModel order, [DateTime? now]) {
  final flag = orderPickupFlag(order, now);
  return flag == null ? updateStage(order) : '${updateStage(order)}:$flag';
}

String updateMessage(OrderModel order, [DateTime? now]) {
  final trimmed = order.storeName.trim();
  final store = trimmed.isEmpty ? 'the pharmacy' : trimmed;
  final flag = orderPickupFlag(order, now);
  if (flag == 'today') {
    final window = windowText(order.pickupWindow);
    return 'Pickup is today at $store${window.isEmpty ? '' : ' ($window)'}.';
  }
  if (flag == 'missed') {
    return 'Pickup missed at $store. Your pickup date was ${pickupText(order.pickupDate, null)}.';
  }
  switch (updateStage(order)) {
    case 'preparing':
      return '$store is preparing your order.';
    case 'ready':
      return 'Your order at $store is ready for pickup.';
    case 'completed':
      return 'You collected your order from $store.';
    case 'cancelled':
      return 'Your order at $store was cancelled.';
    case 'expired':
      return 'Your reservation at $store expired.';
    default:
      return 'Your order at $store was placed.';
  }
}

Map<String, String> currentStages(List<OrderModel> orders) => {
  for (final order in orders)
    if (order.id != null) '${order.id}': _seenKey(order),
};

/// Returns null when this phone has never recorded a baseline.
Map<String, String>? parseSeen(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return null;
    return {
      for (final entry in decoded.entries)
        if (entry.value is String) '${entry.key}': entry.value as String,
    };
  } catch (_) {
    return null;
  }
}

/// Newest orders first. With no baseline yet nothing is unread, so a new
/// phone is not flooded with updates.
List<OrderUpdate> buildUpdates(
  List<OrderModel> orders,
  Map<String, String>? seen,
) {
  final sorted = [...orders]..sort((a, b) => (b.id ?? 0).compareTo(a.id ?? 0));
  return [
    for (final order in sorted)
      OrderUpdate(
        order: order,
        stage: updateStage(order),
        message: updateMessage(order),
        unread: seen != null && seen['${order.id}'] != _seenKey(order),
      ),
  ];
}

/// Order updates are worked out from the customer's own orders. An order is
/// new when its stage differs from the stage the customer last saw. The last
/// seen stages stay on the phone (`nearpill_order_seen_user_<id>`).
class OrderUpdatesViewModel extends ChangeNotifier {
  OrderUpdatesViewModel({
    required OrderRepository repository,
    FlutterSecureStorage? storage,
  })
      // ignore: prefer_initializing_formals
      : _repository = repository,
       _storage = storage ?? const FlutterSecureStorage();

  final OrderRepository _repository;
  final FlutterSecureStorage _storage;
  int? _userId;
  List<OrderModel> _orders = const [];
  Map<String, String>? _seen;
  bool _isLoading = false;
  bool _loaded = false;
  String? _error;
  int _request = 0;

  List<OrderUpdate> get updates => buildUpdates(_orders, _seen);
  int get unreadCount => updates.where((update) => update.unread).length;
  bool get isLoading => _isLoading;
  bool get loaded => _loaded;
  String? get error => _error;

  static String storageKey(int userId) => 'nearpill_order_seen_user_$userId';

  /// Forget everything (sign-out). Seen stages stay stored for the account.
  void clear() {
    _request++;
    _userId = null;
    _orders = const [];
    _seen = null;
    _loaded = false;
    _error = null;
    _isLoading = false;
    notifyListeners();
  }

  Future<void> refresh() async {
    final request = ++_request;
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final userId = await _repository.currentAccountId();
      if (request != _request) return;
      if (userId == null) {
        _userId = null;
        _orders = const [];
        _seen = null;
        _loaded = false;
        return;
      }
      final orders = await _repository.listOrders(expectedUserId: userId);
      if (request != _request) return;
      var seen = parseSeen(await _storage.read(key: storageKey(userId)));
      if (seen == null) {
        seen = currentStages(orders);
        await _storage.write(
          key: storageKey(userId),
          value: jsonEncode(seen),
        );
      }
      if (request != _request) return;
      _userId = userId;
      _orders = orders;
      _seen = seen;
      _loaded = true;
    } catch (_) {
      if (request == _request) _error = 'Unable to load order updates';
    } finally {
      if (request == _request) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  Future<void> markAllRead() async {
    final userId = _userId;
    if (userId == null) return;
    final seen = currentStages(_orders);
    _seen = seen;
    notifyListeners();
    try {
      await _storage.write(key: storageKey(userId), value: jsonEncode(seen));
    } catch (_) {
      // Storage unavailable: they stay read until the app is closed.
    }
  }
}
