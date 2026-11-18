import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/features/orders/pickup.dart';
import 'package:nearpill/features/orders/presentation/order_updates_view_model.dart';
import 'package:nearpill/features/orders/receipt_pdf.dart';
import 'package:nearpill/models/order_model.dart';
import 'package:nearpill/screens/orders/orders.dart' show pickupSummary;
import 'package:nearpill/widgets/pickup_picker.dart';

// 2026-11-16 10:00 Philippine time.
final _now = DateTime.utc(2026, 11, 16, 2);

OrderModel _order({
  String stage = 'reserved',
  String? date,
  String? window,
  bool rescheduled = false,
  List<dynamic> items = const [],
}) => OrderModel.fromJson({
  'id': 1,
  'reference': 'NP-TEST-1',
  'storeName': 'Dobol B Pharmacy',
  'totalCentavos': 13000,
  'stage': stage,
  'items': items,
  'pickupDate': date,
  'pickupWindow': window,
  'pickupRescheduled': rescheduled,
});

void main() {
  test('pickup days run from today to 7 days ahead in Philippine time', () {
    final days = pickupDays(_now);
    expect(days.length, 8);
    expect(days.first, '2026-11-16');
    expect(days.last, '2026-11-23');
    expect(chipLabel('2026-11-16', _now), 'Today');
    expect(chipLabel('2026-11-17', _now), 'Tomorrow');
    expect(chipLabel('2026-11-18', _now), 'Wed 18');
    expect(shortDate('2026-11-17'), 'Tue, 17 Nov');
    expect(manilaToday(DateTime.utc(2026, 11, 15, 17)), '2026-11-16');
  });

  test('time windows that already ended today cannot be chosen', () {
    final evening = DateTime.utc(2026, 11, 16, 10); // 18:00
    expect(windowAvailable('2026-11-16', 'afternoon', evening), isFalse);
    expect(windowAvailable('2026-11-16', 'evening', evening), isTrue);
    expect(windowAvailable('2026-11-17', 'morning', evening), isTrue);
    expect(pickupText('2026-11-17', 'morning'), 'Tue, 17 Nov · Morning (8–12)');
    expect(pickupText(null, null), '');
  });

  test('pickup flags only apply to active orders', () {
    expect(pickupFlag('2026-11-16', true, _now), 'today');
    expect(pickupFlag('2026-11-15', true, _now), 'missed');
    expect(pickupFlag('2026-11-17', true, _now), isNull);
    expect(pickupFlag('2026-11-15', false, _now), isNull);
  });

  test('order model reads the pickup date and the order card line says it', () {
    final order = _order(date: '2026-11-17', window: 'morning');
    expect(order.pickupDate, '2026-11-17');
    expect(pickupSummary(order), contains('Pick up Tue, 17 Nov · Morning (8–12)'));
    expect(pickupSummary(_order()), 'No pickup date');
    expect(order.toPay, isTrue);
    expect(_order(stage: 'confirmed').toPickUp, isTrue);
    expect(_order(stage: 'completed').toPay, isFalse);
  });

  test('order updates say when pickup is today or missed', () {
    final today = _order(stage: 'confirmed', date: '2026-11-16', window: 'afternoon');
    expect(updateMessage(today, _now), 'Pickup is today at Dobol B Pharmacy (Afternoon (12–5)).');
    final missed = _order(stage: 'preparing', date: '2026-11-15');
    expect(updateMessage(missed, _now), contains('Pickup missed at Dobol B Pharmacy'));
    final dueNow = _order(stage: 'confirmed', date: manilaToday());
    expect(buildUpdates([dueNow], {'1': 'placed'}).single.unread, isTrue);
    expect(buildUpdates([_order(stage: 'confirmed')], {'1': 'placed'}).single.unread, isFalse);
  });

  test('receipt PDF carries the claim code, pickup, items and test-payment footer', () {
    final bytes = buildReceiptPdf(
      const ReceiptFacts(
        reference: 'NP-TEST-1',
        storeName: 'Dobol B Pharmacy',
        customerName: 'Sam Customer',
        placedOn: 'Nov 14, 2026',
        totalCentavos: 13000,
        balanceDue: 3000,
        pickupDate: '2026-11-17',
        pickupWindow: 'morning',
        items: [
          {'name': 'Biogesic', 'quantity': 2, 'priceCentavos': 6500, 'prescriptionRequired': true},
        ],
      ),
    );
    final text = latin1.decode(bytes);
    expect(text, startsWith('%PDF-1.4'));
    for (final expected in [
      'NP-TEST-1',
      'Dobol B Pharmacy',
      'Sam Customer',
      'Tue, 17 Nov',
      'Deposit paid',
      'PHP 100.00',
      'Balance due at pickup',
      'PHP 30.00',
      'Biogesic',
      'Physical prescription check required',
      'Capstone test payment, no real money was charged.',
    ]) {
      expect(text, contains(expected));
    }
    expect(receiptFileName('NP-TEST-1'), 'NearPill-receipt-NP-TEST-1.pdf');
  });

  testWidgets('picking a date and time reports the choice', (tester) async {
    String? date = pickupDays().first;
    String? window;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) => PickupPicker(
              date: date!,
              window: window,
              onChanged: (d, w) => setState(() {
                date = d;
                window = w;
              }),
            ),
          ),
        ),
      ),
    );
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Tomorrow'), findsOneWidget);
    await tester.tap(find.text('Tomorrow'));
    await tester.pump();
    expect(date, pickupDays()[1]);
    await tester.tap(find.text('Evening 5–8'));
    await tester.pump();
    expect(window, 'evening');
    await tester.tap(find.text('Any time'));
    await tester.pump();
    expect(window, isNull);
  });
}
