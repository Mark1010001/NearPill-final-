import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:nearpill/core/api/api_client.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/orders/data/order_repository.dart';
import 'package:nearpill/features/orders/presentation/order_view_model.dart';
import 'package:nearpill/models/user_model.dart';
import 'package:nearpill/models/order_model.dart';
import 'package:nearpill/screens/orders/confirmation.dart';
import 'package:provider/provider.dart';

class _Orders implements OrderRepository {
  String? status = 'pending';

  @override
  Future<OrderPayment> paymentStatus(
    int orderId, {
    bool refresh = false,
    int? expectedUserId,
  }) async {
    expect(orderId, 17);
    lastRefresh = refresh;
    return (
      status: status,
      plan: plan,
      amountCentavos: amountCentavos,
      orderStatus: orderStatus,
    );
  }

  String? plan;
  int? amountCentavos;
  String? orderStatus;
  bool lastRefresh = false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('the app reads the order stage even when no payment exists', () async {
    final api = ApiClient(sessionManager: SessionManager());
    addTearDown(api.close);
    final requests = <String>[];
    api.dio.interceptors
      ..clear()
      ..add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests.add(options.path);
            expect(options.headers['X-NearPill-Account'], '7');
            handler.resolve(
              Response(
                requestOptions: options,
                statusCode: 200,
                data: options.path.endsWith('/payment')
                    ? {'payment': null}
                    : {'status': 'expired'},
              ),
            );
          },
        ),
      );
    final payment = await OrderRepository(
      apiClient: api,
    ).paymentStatus(17, expectedUserId: 7);
    expect(requests.map((path) => path.substring(path.indexOf('/orders'))), [
      '/orders/17/payment',
      '/orders/17',
    ]);
    expect(payment.status, isNull);
    expect(payment.orderStatus, 'expired');
  });

  test(
    'a late session refresh cannot overwrite or clear the new account',
    () async {
      FlutterSecureStorage.setMockInitialValues({});
      final session = SessionManager();
      await session.saveTokens('first-access', 'first-refresh', userId: 7);
      final before = (await session.getRefreshToken())!;
      await session.saveTokens('second-access', 'second-refresh', userId: 8);
      expect(
        await session.replaceTokensIfCurrent(
          before,
          'late-access',
          'late-refresh',
        ),
        isFalse,
      );
      expect(await session.clearSessionIfCurrent(before), isFalse);
      expect(await session.getUserId(), 8);
      expect(await session.getAccessToken(), 'second-access');
    },
  );

  testWidgets('order details wait for a server-confirmed test payment', (
    tester,
  ) async {
    final orders = _Orders();
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => OrderViewModel(repository: orders),
        child: const MaterialApp(
          home: OrderConfirmationScreen(
            orderId: 17,
            reference: 'NP-TEST-17',
            storeName: 'Test Pharmacy',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Waiting for payment.'), findsOneWidget);
    expect(find.text('Payment confirmed'), findsNothing);
    orders.status = 'confirmed';
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('Payment confirmed'), findsOneWidget);
    expect(orders.lastRefresh, isTrue);
    expect(find.text('Open GCash test checkout'), findsNothing);
  });

  testWidgets('deposit is optional and shows only this order’s balance', (
    tester,
  ) async {
    final orders = _Orders()..status = null;
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => OrderViewModel(repository: orders),
        child: const MaterialApp(
          home: OrderConfirmationScreen(
            orderId: 17,
            reference: 'NP-TEST-17',
            storeName: 'Test Pharmacy',
            totalCentavos: 12000,
            depositEnabled: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('How would you like to pay?'), findsOneWidget);
    expect(find.text('Pay a deposit'), findsOneWidget);
    expect(find.text('Pay in full'), findsOneWidget);
    expect(find.text('Pay now ₱100.00'), findsOneWidget);
    expect(find.text('Pay ₱20.00 at pickup'), findsOneWidget);
    expect(find.text('Pay ₱100.00 deposit with GCash'), findsOneWidget);
    await tester.tap(find.text('Pay in full'));
    await tester.pumpAndSettle();
    expect(find.text('Pay ₱120.00 in full with GCash'), findsOneWidget);
    expect(find.text('Due at pickup ₱0.00'), findsOneWidget);
    await tester.tap(find.text('Pay a deposit'));
    await tester.pumpAndSettle();
    expect(find.text('Pay ₱100.00 deposit with GCash'), findsOneWidget);
    orders.status = 'confirmed';
    orders.plan = 'deposit';
    orders.amountCentavos = 10000;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(
      find.text('Deposit confirmed. Balance due: ₱20.00.'),
      findsOneWidget,
    );
  });

  testWidgets('orders of ₱100 or less are paid in full only', (tester) async {
    final orders = _Orders()..status = null;
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => OrderViewModel(repository: orders),
        child: const MaterialApp(
          home: OrderConfirmationScreen(
            orderId: 17,
            reference: 'NP-TEST-17',
            storeName: 'Test Pharmacy',
            totalCentavos: 8000,
            depositEnabled: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Pay a deposit'), findsNothing);
    expect(find.text('Pay ₱80.00 in full with GCash'), findsOneWidget);
    expect(
      find.text('Orders of ₱100 or less are paid in full.'),
      findsOneWidget,
    );
  });

  testWidgets('receipt shows the claim code and a prescription reminder', (
    tester,
  ) async {
    final orders = _Orders()..status = 'confirmed';
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => OrderViewModel(repository: orders),
        child: const MaterialApp(
          home: OrderConfirmationScreen(
            orderId: 17,
            reference: 'NP-TEST-17',
            storeName: 'Test Pharmacy',
            stage: OrderStage.ready,
            status: 'ready_for_pickup',
            totalCentavos: 10000,
            receiptItems: [
              {
                'name': 'Acetylcysteine 600 mg',
                'quantity': 4,
                'priceCentavos': 2500,
                'sellingUnit': 'Sachet',
                'prescriptionRequired': true,
              },
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('PICKUP CLAIM CODE'),
      120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('PICKUP CLAIM CODE'), findsOneWidget);
    expect(
      find.textContaining('Physical prescription check required'),
      findsOneWidget,
    );
    expect(find.text('₱25.00 each'), findsOneWidget);
  });

  testWidgets(
    'ready pickup offers GCash for the remaining balance or pay at pickup',
    (tester) async {
      final orders = _Orders()
        ..status = 'confirmed'
        ..plan = 'deposit'
        ..amountCentavos = 10000;
      await tester.pumpWidget(
        ChangeNotifierProvider(
          create: (_) => OrderViewModel(repository: orders),
          child: const MaterialApp(
            home: OrderConfirmationScreen(
              orderId: 17,
              reference: 'NP-TEST-17',
              storeName: 'Test Pharmacy',
              stage: OrderStage.ready,
              totalCentavos: 16000,
              depositEnabled: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Pay ₱60.00 with GCash'), findsOneWidget);
      expect(find.text('You can also pay at pickup.'), findsOneWidget);
    },
  );

  testWidgets('returning from checkout refreshes payment and pickup stage', (
    tester,
  ) async {
    final orders = _Orders()
      ..status = 'pending'
      ..plan = 'balance'
      ..amountCentavos = 6000
      ..orderStatus = 'ready_for_pickup';
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => OrderViewModel(repository: orders),
        child: const MaterialApp(
          home: OrderConfirmationScreen(
            orderId: 17,
            reference: 'NP-TEST-17',
            storeName: 'Test Pharmacy',
            stage: OrderStage.ready,
            totalCentavos: 16000,
            depositEnabled: true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Resume GCash balance checkout'), findsOneWidget);
    orders.status = 'confirmed';
    orders.orderStatus = 'completed';
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(orders.lastRefresh, isTrue);
    expect(find.text('Collected'), findsOneWidget);
    expect(find.text('Balance paid with GCash. ₱0.00 due.'), findsOneWidget);
    expect(find.text('Resume GCash balance checkout'), findsNothing);
  });

  test('only the server can enable Xendit Test Mode', () {
    expect(UserModel.fromJson({}).xenditTestCheckout, isFalse);
    expect(
      UserModel.fromJson({'xenditTestCheckout': 'true'}).xenditTestCheckout,
      isFalse,
    );
    expect(
      UserModel.fromJson({'xenditTestCheckout': true}).xenditTestCheckout,
      isTrue,
    );
  });

  test('the mobile payment link accepts only official Xendit test hosts', () {
    expect(
      OrderRepository.trustedTestCheckoutUri('https://dev.xen.to/example'),
      isNotNull,
    );
    expect(
      OrderRepository.trustedTestCheckoutUri(
        'https://checkout-staging.xendit.co/example',
      ),
      isNotNull,
    );
    for (final url in [
      'http://dev.xen.to/example',
      'https://dev.xen.to:444/example',
      'https://checkout.xendit.co/example',
      'https://dev.xen.to.example.com/example',
      'https://anything@dev.xen.to/example',
    ]) {
      expect(OrderRepository.trustedTestCheckoutUri(url), isNull);
    }
  });
}
