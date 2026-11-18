import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/auth/data/auth_repository.dart';
import 'package:nearpill/features/auth/presentation/auth_view_model.dart';
import 'package:nearpill/features/cart/presentation/cart_view_model.dart';
import 'package:nearpill/features/orders/data/order_repository.dart';
import 'package:nearpill/features/orders/presentation/order_view_model.dart';
import 'package:nearpill/features/pharmacy/data/pharmacy_repository.dart';
import 'package:nearpill/features/pharmacy/domain/pharmacy.dart';
import 'package:nearpill/features/pharmacy/presentation/pharmacy_view_model.dart';
import 'package:nearpill/models/order_model.dart';
import 'package:nearpill/models/user_model.dart';
import 'package:nearpill/screens/orders/orders.dart';
import 'package:nearpill/screens/orders/prescription_review.dart';
import 'package:nearpill/screens/profile_screen.dart';
import 'package:provider/provider.dart';

PharmacyInventory inventory({
  bool published = true,
  int stock = 5,
  String? sellingUnit,
}) => PharmacyInventory(
  store: const Pharmacy(id: 1, name: 'Pharmacy', address: 'Cebu City'),
  inventory: [
    {
      'id': 5,
      'drugstoreId': 1,
      'stockCount': stock,
      'priceCentavos': 750,
      'sellingUnit': ?sellingUnit,
      'publicationStatus': published ? 'published' : 'draft',
      'canOrder': published,
    },
  ],
);

class _PharmacyRepository implements PharmacyRepository {
  @override
  Future<PharmacyInventory> getStoreInventory(int storeId) async {
    expect(storeId, 1);
    return inventory();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _OrderRepository implements OrderRepository {
  bool unavailable = false;
  String? reviewStatus;

  @override
  Future<int?> currentAccountId() async => 1;

  @override
  Future<({String? status, String? reason})> prescriptionStatus(
    int account,
    int pharmacy,
    int medicine,
  ) async => (status: reviewStatus, reason: null);

  @override
  Future<void> submitPrescription(
    int account,
    int pharmacy,
    int medicine,
    String mimeType,
    String photo,
  ) async {
    expect(
      (account, pharmacy, medicine, mimeType, photo),
      (1, 2, 5, 'image/png', 'AQID'),
    );
    reviewStatus = 'pending';
  }

  @override
  Future<List<OrderModel>> listOrders({int? expectedUserId}) async {
    if (unavailable) throw StateError('Offline');
    return [
      OrderModel.fromJson({
        'reference': 'NP-5',
        'storeName': 'Pharmacy',
        'itemSummary': 'Medicine x2',
        'itemCount': 2,
        'stage': 'completed',
        'items': [
          {
            'id': 5,
            'drugstoreId': 1,
            'name': 'Medicine',
            'quantity': 2,
            'priceCentavos': 500,
          },
        ],
      }),
    ];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _AuthRepository implements AuthRepository {
  String phone = '09170000000';
  bool saveFails = false;
  static const birthDate = '01/01/2000';

  @override
  Future<UserModel> getMe() async => UserModel(
    fullName: 'Example Customer',
    email: 'customer@example.test',
    phone: phone,
    birthDate: birthDate,
  );

  @override
  Future<void> updateProfile({String? phone, String? birthDate}) async {
    expect(birthDate, _AuthRepository.birthDate);
    if (saveFails) throw StateError('Offline');
    this.phone = phone!;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'Android submits a sample for the selected prescription listing',
    (tester) async {
      const picker = MethodChannel('nearpill/prescription_photo');
      final messenger = tester.binding.defaultBinaryMessenger;
      var pickerCalls = 0;
      messenger.setMockMethodCallHandler(picker, (call) async {
        expect(call.method, 'pick');
        if (++pickerCalls == 1) return null;
        return {
          'mimeType': 'image/png',
          'bytes': Uint8List.fromList([1, 2, 3]),
        };
      });
      addTearDown(() => messenger.setMockMethodCallHandler(picker, null));
      final repository = _OrderRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PrescriptionReview(
              repository: repository,
              pharmacy: 2,
              medicine: 5,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Upload prescription'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose photo'));
      await tester.pumpAndSettle();
      expect(repository.reviewStatus, isNull);
      expect(find.text('Upload prescription'), findsOneWidget);
      await tester.tap(find.text('Upload prescription'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Choose photo'));
      await tester.pumpAndSettle();
      expect(find.text('Waiting for the pharmacy to review your prescription.'), findsOneWidget);
      repository.reviewStatus = 'approved';
      await tester.tap(find.text('Check review status'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Prescription approved. You can place your order. Bring this prescription when you pick it up.',
        ),
        findsOneWidget,
      );
    },
    variant: TargetPlatformVariant.only(TargetPlatform.android),
  );

  test(
    'cart retains the selling unit and blocks a changed unit at review',
    () async {
      FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
      final cart = CartViewModel(sessionManager: SessionManager());
      addTearDown(cart.dispose);
      await cart.addItem(
        id: '5',
        name: 'Medicine',
        priceCentavos: 750,
        drugstoreName: 'Pharmacy',
        drugstoreId: '1',
        category: 'Non-prescription',
        quantity: 2,
        sellingUnit: 'Capsule',
      );
      expect(
        CartItem.fromJson(cart.items.single.toJson()).sellingUnit,
        'Capsule',
      );
      expect(cart.items.single.pricePerUnit, '₱7.50 per Capsule');
      expect(
        await cart.reviewCheckout(
          (_) async => inventory(sellingUnit: 'Capsule'),
        ),
        isNull,
      );
      expect(
        await cart.reviewCheckout(
          (_) async => inventory(sellingUnit: 'Box of 10'),
        ),
        contains('selling unit changed'),
      );
      expect(cart.items.single.quantity, 2);
    },
  );

  testWidgets('large text keeps the cart and checkout actions reachable', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 640);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
    final cart = CartViewModel(sessionManager: SessionManager());
    final auth = _AuthRepository();
    await cart.addItem(
      id: '5',
      name: 'Medicine with a long name and formulation',
      priceCentavos: 125050,
      drugstoreName: 'A pharmacy with a long display name',
      drugstoreId: '1',
      category: 'Non-Prescription (source list)',
      quantity: 2,
    );
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: cart),
          ChangeNotifierProvider(
            create: (_) => AuthViewModel(repository: auth),
          ),
          ChangeNotifierProvider(
            create: (_) => PharmacyViewModel(repository: _PharmacyRepository()),
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(2)),
            child: child!,
          ),
          home: const OrdersScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final increase = find.widgetWithIcon(IconButton, Icons.add);
    await tester.scrollUntilVisible(
      increase,
      100,
      scrollable: find
          .descendant(
            of: find.byType(ListView),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pumpAndSettle();
    expect(increase.hitTestable(), findsOneWidget);
    expect(find.text('Non-prescription'), findsOneWidget);
    await tester.tap(increase);
    await tester.pumpAndSettle();
    expect(cart.items.single.quantity, 3);
    final decrease = find.widgetWithIcon(IconButton, Icons.remove);
    await tester.ensureVisible(decrease);
    await tester.pumpAndSettle();
    await tester.tap(decrease);
    await tester.pumpAndSettle();
    expect(cart.items.single.quantity, 2);
    final checkoutButton = find.widgetWithText(FilledButton, 'Review checkout');
    expect(tester.widget<FilledButton>(checkoutButton).onPressed, isNotNull);
    expect(checkoutButton.hitTestable(), findsOneWidget);
    await tester.tap(checkoutButton);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Review').hitTestable(), findsOneWidget);
    expect(find.text('2 × ₱7.50 each'), findsOneWidget);
    expect(find.text('Unit price updated from ₱1250.50.'), findsOneWidget);
    expect(find.text('₱15.00'), findsWidgets);
    final placeOrder = find.widgetWithText(FilledButton, 'Place order');
    expect(tester.widget<FilledButton>(placeOrder).onPressed, isNull);
    expect(find.text('GCash unavailable'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Edit contact details'), 180);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit contact details'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, '123');
    final save = find.text('Save Changes');
    Future<void> scrollToBottom() async {
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      final position = tester
          .state<ScrollableState>(
            find
                .descendant(
                  of: find.byType(SingleChildScrollView).last,
                  matching: find.byType(Scrollable),
                )
                .first,
          )
          .position;
      position.jumpTo(position.maxScrollExtent);
    }

    await scrollToBottom();
    await tester.pumpAndSettle();
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(
      find.text('Enter an 11-digit mobile number starting with 09.'),
      findsOneWidget,
    );
    expect(auth.phone, '09170000000');
    await tester.enterText(find.byType(TextFormField).first, '09171234567');
    await scrollToBottom();
    await tester.pumpAndSettle();
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(auth.phone, '09171234567');
    expect(cart.items, hasLength(1));
    expect(tester.takeException(), isNull);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Review checkout').hitTestable(), findsOneWidget);
    expect(cart.items, hasLength(1));
  });

  testWidgets('Buy Again adds the past order items and returns to the cart', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
    final cart = CartViewModel(sessionManager: SessionManager());
    final orders = _OrderRepository()..unavailable = true;
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: cart),
          ChangeNotifierProvider(
            create: (_) => OrderViewModel(repository: orders),
          ),
        ],
        child: const MaterialApp(home: OrdersScreen()),
      ),
    );
    await tester.tap(find.text('My Orders'));
    await tester.pumpAndSettle();
    expect(find.text('Unable to load orders'), findsOneWidget);
    orders.unavailable = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Buy Again'));
    await tester.tap(find.text('Buy Again'));
    await tester.pumpAndSettle();
    expect(cart.items.single.quantity, 2);
    expect(find.text('Review checkout').hitTestable(), findsOneWidget);
  });

  testWidgets('profile contact form retains changes when saving fails', (
    tester,
  ) async {
    final auth = _AuthRepository()..saveFails = true;
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 640);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
            create: (_) => AuthViewModel(repository: auth),
          ),
          ChangeNotifierProvider(
            create: (_) => OrderViewModel(repository: _OrderRepository()),
          ),
        ],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: const ProfileScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final edit = find.byTooltip('Edit contact details');
    await tester.ensureVisible(edit);
    await tester.tap(edit);
    await tester.pumpAndSettle();
    final fields = find.byType(TextFormField);
    expect(fields, findsNWidgets(2));
    await tester.enterText(fields.first, '09171234567');
    final save = find.text('Save Changes');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(
      find.text('Could not save your contact details. Try again.'),
      findsOneWidget,
    );
    expect(auth.phone, '09170000000');
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller?.text,
      '09171234567',
    );

    auth.saveFails = false;
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(fields, findsNothing);
    expect(find.text('Contact details saved.'), findsOneWidget);
    expect(auth.phone, '09171234567');
    expect(tester.takeException(), isNull);
  });

  test(
    'saved carts use current approval, stock and price instead of old flags',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        'user_id': '1',
        'nearpill_cart_user_1': jsonEncode([
          {
            'id': '5',
            'drugstoreId': '1',
            'name': 'Medicine',
            'quantity': 2,
            'priceCentavos': 500,
            'canOrder': false,
          },
        ]),
      });
      final session = SessionManager();
      final cart = CartViewModel(sessionManager: session);

      expect(
        await cart.reviewCheckout((_) async => inventory(published: false)),
        contains('Not available to order right now'),
      );
      expect(
        await cart.reviewCheckout((_) async => inventory(stock: 0)),
        contains('Out of stock. Remove it from your cart'),
      );
      expect(
        await cart.reviewCheckout((_) async => inventory(stock: 1)),
        contains('Reduce the quantity'),
      );
      expect(cart.totalCentavos, 1000);
      expect(await cart.reviewCheckout((_) async => inventory()), isNull);
      expect(cart.totalCentavos, 1500);

      Future<void> add(String pharmacy) => cart.addItem(
        id: '5',
        name: 'Medicine',
        priceCentavos: 500,
        drugstoreName: pharmacy,
        drugstoreId: pharmacy,
        category: 'Medicine',
        quantity: 1,
      );

      expect(cart.checkoutBlockReason, isNull);
      await add('2');
      expect(cart.checkoutBlockReason, contains('one pharmacy'));
      await add('3');

      final restored = CartViewModel(sessionManager: session);
      await restored.loadCart();
      expect(restored.items, hasLength(3));
      expect(restored.checkoutBlockReason, contains('one pharmacy'));
      await restored.updateQuantity('5', '2', 3);
      expect(restored.items.map((item) => item.quantity), [2, 3, 1]);
      await restored.removeItem('5', '3');
      expect(restored.checkoutBlockReason, contains('one pharmacy'));
      await restored.removeItem('5', '2');
      expect(restored.checkoutBlockReason, isNull);
      await restored.addItem(
        id: '6',
        name: 'Other product',
        priceCentavos: 20000,
        drugstoreName: 'Other pharmacy',
        drugstoreId: '2',
        category: 'Non-medicine',
        quantity: 1,
      );
      expect(
        await restored.reviewCheckout(
          (_) async => inventory(),
          pharmacyId: '1',
        ),
        isNull,
      );
      final first = await restored.rememberCheckout('1', 1, grouped: true);
      final other = await restored.rememberCheckout('2', 1, grouped: true);
      expect(first.key, isNot(other.key));
      await restored.finishCheckout(first, 1, reserved: true);
      expect(restored.items.single.drugstoreId, '2');
      expect(restored.groupedCheckout, isTrue);
      final reopened = CartViewModel(sessionManager: session);
      await reopened.loadCart();
      expect(reopened.groupedCheckout, isTrue);
      await reopened.updateQuantity('6', '2', 2);
      final retry = await reopened.rememberCheckout('2', 1, grouped: true);
      expect(retry.key, other.key);
      expect(retry.items.single.quantity, 1);
      await reopened.finishCheckout(retry, 1, reserved: true);
      await reopened.finishCheckout(retry, 1, reserved: true);
      expect(reopened.items.single.quantity, 1);
      expect(await reopened.pendingCheckout('2'), isNull);
      await session.saveTokens('test-access', 'test-refresh', userId: 2);
      expect(await reopened.pendingCheckout('1'), isNull);
      expect(reopened.items, isEmpty);
    },
  );
}
