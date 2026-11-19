import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:nearpill/app_theme.dart';
import 'package:nearpill/config/service_notices.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/cart/presentation/cart_view_model.dart';
import 'package:nearpill/features/auth/data/auth_repository.dart';
import 'package:nearpill/features/auth/presentation/auth_view_model.dart';
import 'package:nearpill/features/pharmacy/data/pharmacy_repository.dart';
import 'package:nearpill/features/pharmacy/domain/pharmacy.dart';
import 'package:nearpill/features/pharmacy/presentation/pharmacy_view_model.dart';
import 'package:nearpill/models/order_model.dart';
import 'package:nearpill/screens/auth_portal_screen.dart';
import 'package:nearpill/screens/home_store_detail.dart';
import 'package:nearpill/screens/orders/confirmation.dart';
import 'package:nearpill/screens/policies_screen.dart';
import 'package:nearpill/utils/formatters.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'support/np_icon_finders.dart';

class _SignupRepository implements AuthRepository {
  String? verifiedCode;

  @override
  Future<({String? devCode, bool testInbox})> sendOtp({
    required String email,
  }) async => (devCode: null, testInbox: false);

  @override
  Future<void> verifyOtp({required String email, required String code}) async {
    verifiedCode = code;
    throw AuthException('The code has expired. Request a new code.');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _PharmacyRepository implements PharmacyRepository {
  _PharmacyRepository(this.scenario);

  final String scenario;
  int attempts = 0;

  @override
  Future<PharmacyInventory> getStoreInventory(int storeId) async {
    attempts++;
    expect(storeId, 1);
    if (scenario == 'failure') throw StateError('Unavailable');
    if (scenario == 'invalid') throw const FormatException('Invalid JSON');
    if (scenario == 'invalid-items') {
      throw const FormatException('Invalid items');
    }
    return PharmacyInventory(
      store: const Pharmacy(
        id: 1,
        name: 'Actual pharmacy',
        address: 'Cebu City',
        openNow: true,
      ),
      inventory: scenario == 'empty'
          ? const []
          : [
              {
                'id': 99,
                'name': 'Actual listing',
                'priceCentavos': 1200,
                'stockCount': 2,
                'category': 'Non-Prescription (source list)',
                'drugstoreId': 1,
                'publicationStatus': scenario == 'unreviewed'
                    ? 'draft'
                    : 'published',
                'canOrder': scenario != 'unreviewed',
              },
            ],
    );
  }

  @override
  Future<List<Pharmacy>> listStores() async => const [];

  @override
  Future<NearbyPharmacies> findNearby({
    required double latitude,
    required double longitude,
    double radiusKm = 5,
  }) async => const NearbyPharmacies(mode: 'coordinates', stores: []);

  @override
  Future<NearbyPharmacies> searchByLocation(String query) async =>
      const NearbyPharmacies(mode: 'manual', stores: []);
}

void main() {
  test(
    'white button text has sufficient contrast against the primary green',
    () {
      final luminance = appThemeData.colorScheme.primary.computeLuminance();
      expect(1.05 / (luminance + 0.05), greaterThanOrEqualTo(4.5));
    },
  );

  testWidgets('cancelled orders do not promise a refund or a payment outcome', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: OrderConfirmationScreen(
          reference: 'TEST-1',
          storeName: 'Test pharmacy',
          stage: OrderStage.cancelled,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(cancellationNotice), findsOneWidget);
    expect(find.textContaining('3-5 business days'), findsNothing);
    expect(find.textContaining('You were not charged'), findsNothing);
    await tester.pumpWidget(
      const MaterialApp(
        home: OrderConfirmationScreen(
          reference: 'TEST-2',
          storeName: 'Test pharmacy',
          stage: OrderStage.preparing,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Preparing for pickup'), findsOneWidget);
    expect(find.text('Pickup location'), findsNothing);
    expect(find.text('Secs'), findsNothing);
    expect(find.text('Rate now'), findsNothing);
  });

  testWidgets(
    'shared policies load without an API and include the supplied contact',
    (tester) async {
      await tester.pumpWidget(const MaterialApp(home: PoliciesScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Privacy notice'), findsOneWidget);
      expect(find.textContaining('nearpillemail.business@gmail.com'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );

  test('date text formatter rejects letters', () {
    const previous = TextEditingValue(text: '02/29/2000');
    expect(
      DateTextFormatter().formatEditUpdate(
        previous,
        const TextEditingValue(text: 'Feb 29, 2000'),
      ),
      previous,
    );
  });

  testWidgets(
    'signup code entry stays reachable with large text and keyboard',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 568);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetViewInsets);
      final auth = _SignupRepository();
      await tester.pumpWidget(
        ChangeNotifierProvider(
          create: (_) => AuthViewModel(repository: auth),
          child: MaterialApp(
            theme: appThemeData,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: const AuthPortalScreen(),
          ),
        ),
      );
      await tester.ensureVisible(find.text('Create account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'test@example.com');
      await tester.enterText(fields.at(1), 'Test-password1');
      await tester.enterText(fields.at(2), 'Test-password1');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pumpAndSettle();
      await tester.enterText(fields, 'Test Shopper');
      await tester.ensureVisible(find.byKey(const Key('signup-terms')));
      await tester.tap(find.byKey(const Key('signup-terms')));
      await tester.pumpAndSettle();
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      tester.view.viewInsets = const FakeViewPadding(bottom: 240);
      await tester.pumpAndSettle();
      final codeField = find.byType(TextField);
      await tester.ensureVisible(codeField);
      await tester.enterText(codeField, '012345');
      expect(tester.widget<TextField>(codeField).autofillHints, [
        AutofillHints.oneTimeCode,
      ]);
      // The sixth digit submits the code by itself.
      await tester.pumpAndSettle();
      expect(auth.verifiedCode, '012345');
      expect(
        find.textContaining('The code has expired').hitTestable(),
        findsOneWidget,
      );
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'signup works with large text and does not request an unused phone',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: const AuthPortalScreen(),
        ),
      );
      await tester.ensureVisible(find.text('Create account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();
      final fields = find.byType(TextFormField);
      await tester.enterText(fields.at(0), 'test@example.com');
      await tester.enterText(fields.at(1), 'Test-password1');
      await tester.enterText(fields.at(2), 'Test-password1');
      await tester.ensureVisible(find.text('Continue'));
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(find.text('Full name'), findsOneWidget);
      expect(find.text('Mobile number'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final scenario in [
    'available',
    'unreviewed',
    'empty',
    'failure',
    'invalid',
    'invalid-items',
  ]) {
    testWidgets('store inventory handles $scenario without sample stock', (
      tester,
    ) async {
      final repository = _PharmacyRepository(scenario);
      FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
      final cart = CartViewModel(sessionManager: SessionManager());
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            home: StoreDetailScreen(
              viewModel: PharmacyViewModel(repository: repository),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Biogesic 500mg'), findsNothing);
      if (scenario == 'available' || scenario == 'unreviewed') {
        expect(find.textContaining('Actual listing'), findsOneWidget);
        if (scenario == 'available') {
          await tester.tap(find.widgetWithText(ChoiceChip, 'Prescriptions'));
          await tester.pumpAndSettle();
          expect(find.text('Actual listing'), findsNothing);
          await tester.tap(
            find.widgetWithText(ChoiceChip, 'Non-Prescriptions'),
          );
          await tester.pumpAndSettle();
          expect(find.text('Actual listing'), findsOneWidget);
        }
        final increase = find.byTooltip('Increase quantity for Actual listing');
        await tester.ensureVisible(increase);
        await tester.tap(increase);
        await tester.pumpAndSettle();
        expect(find.text('2'), findsOneWidget);
        if (scenario == 'unreviewed') {
          expect(find.text('Stock (2)'), findsOneWidget);
          await tester.tap(increase);
          await tester.pumpAndSettle();
          await tester.tap(
            find.byTooltip('Decrease quantity for Actual listing'),
          );
          await tester.pumpAndSettle();
          final add = find.text('Add to cart');
          await tester.ensureVisible(add);
          await tester.tap(add);
          await tester.pumpAndSettle();
          expect(cart.items.single.quantity, 2);
          expect(cart.checkoutBlockReason, isNull);
        } else {
          expect(
            tester
                .widget<IconButton>(findIconButton(NpIcons.add))
                .onPressed,
            isNull,
          );
        }
        await tester.enterText(find.byType(TextField), 'no match');
        await tester.pump(const Duration(milliseconds: 350));
        await tester.pumpAndSettle();
        expect(find.text('Actual listing'), findsNothing);
        expect(find.text('No items found in this store.'), findsOneWidget);
      } else if (scenario == 'empty') {
        expect(find.text('No items found in this store.'), findsOneWidget);
      } else {
        expect(find.textContaining('Unable to load pharmacy'), findsOneWidget);
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(repository.attempts, 2);
      }
      expect(tester.takeException(), isNull);
    });
  }
}
