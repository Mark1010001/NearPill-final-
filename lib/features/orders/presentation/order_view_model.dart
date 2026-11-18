import 'dart:async';

import 'package:flutter/material.dart';

import '../../../models/order_model.dart';
import '../data/order_repository.dart';

class OrderViewModel extends ChangeNotifier {
  OrderViewModel({required this.repository});

  final OrderRepository repository;
  List<OrderModel> _orders = const [];
  bool _isLoading = false;
  String? _error;
  int? _accountId;
  int _request = 0;

  List<OrderModel> get orders => List.unmodifiable(_orders);
  bool get isLoading => _isLoading;
  String? get error => _error;
  int? get accountId => _accountId;

  void clearOrders() {
    _request++;
    _accountId = null;
    _orders = const [];
    _isLoading = false;
    _error = null;
    notifyListeners();
  }

  Future<List<OrderModel>> fetchOrders() async {
    final request = ++_request;
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      final accountId = await repository.currentAccountId();
      if (request != _request) return const [];
      if (_accountId != accountId) {
        _orders = const [];
        _accountId = accountId;
      }
      if (accountId == null) return const [];
      final orders = await repository.listOrders(expectedUserId: accountId);
      final currentAccountId = await repository.currentAccountId();
      if (request != _request) return const [];
      _orders = accountId == currentAccountId ? orders : const [];
    } catch (_) {
      if (request == _request) {
        _orders = const [];
        _error = 'Unable to load orders';
      }
    } finally {
      if (request == _request) {
        _isLoading = false;
        notifyListeners();
      }
    }
    return _orders;
  }

  Future<Map<String, dynamic>> placeOrder({
    required List<Map<String, dynamic>> items,
    required String idempotencyKey,
    int? expectedUserId,
    bool grouped = false,
    String? pickupDate,
    String? pickupWindow,
  }) async {
    final result = await repository.createOrder(
      items: items,
      idempotencyKey: idempotencyKey,
      expectedUserId: expectedUserId,
      grouped: grouped,
      pickupDate: pickupDate,
      pickupWindow: pickupWindow,
    );
    unawaited(fetchOrders());
    return result;
  }
}
