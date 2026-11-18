import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/models/order_model.dart';

OrderModel _order(String stage) => OrderModel(
  reference: 'NP-1',
  storeName: 'Dobol B Pharmacy',
  itemSummary: 'Biogesic × 1',
  itemCount: 1,
  total: '₱45.00',
  placedOn: 'Nov 14, 2026',
  stage: stage,
  items: const [],
);

void main() {
  test('only paid orders have a pickup receipt', () {
    for (final paid in ['confirmed', 'preparing', 'ready_for_pickup', 'completed']) {
      expect(_order(paid).hasReceipt, isTrue, reason: paid);
    }
    for (final other in ['reserved', 'awaiting_payment', 'cancelled', 'expired', 'cancellation_pending']) {
      expect(_order(other).hasReceipt, isFalse, reason: other);
    }
  });
}
