import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/features/auth/data/auth_repository.dart';
import 'package:nearpill/features/auth/presentation/auth_view_model.dart';
import 'package:nearpill/features/orders/data/order_repository.dart';
import 'package:nearpill/features/orders/presentation/order_view_model.dart';
import 'package:nearpill/models/order_model.dart';
import 'package:nearpill/models/user_model.dart';
import 'package:nearpill/screens/profile_screen.dart';
import 'package:nearpill/screens/settings_screen.dart';
import 'package:provider/provider.dart';

OrderModel _order(String stage, String store, int centavos) =>
    OrderModel.fromJson({
      'reference': 'NP-$store',
      'storeName': store,
      'stage': stage,
      'totalCentavos': centavos,
      'placedOn': 'Dec 18, 2026',
      'items': [
        {
          'id': 1,
          'drugstoreId': 1,
          'name': 'Medicine',
          'quantity': 1,
          'priceCentavos': centavos,
        },
      ],
    });

class _Auth implements AuthRepository {
  _Auth({this.phone});
  final String? phone;
  int logoutAllCalls = 0;

  @override
  Future<UserModel> getMe() async => UserModel(
    fullName: 'Mark Test',
    email: 'mark@example.test',
    phone: phone,
  );

  @override
  Future<void> logoutAll() async => logoutAllCalls++;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Orders implements OrderRepository {
  _Orders(this.orders);
  final List<OrderModel> orders;

  @override
  Future<int?> currentAccountId() async => 1;

  @override
  Future<List<OrderModel>> listOrders({int? expectedUserId}) async => orders;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Widget _app(Widget home, _Auth auth, List<OrderModel> orders) => MultiProvider(
  providers: [
    ChangeNotifierProvider(create: (_) => AuthViewModel(repository: auth)),
    ChangeNotifierProvider(
      create: (_) => OrderViewModel(repository: _Orders(orders)),
    ),
  ],
  child: MaterialApp(home: home),
);

void main() {
  testWidgets('profile shows account rows, status chips and View all', (
    tester,
  ) async {
    var viewAll = 0;
    await tester.pumpWidget(
      _app(
        ProfileScreen(onOpenOrders: () => viewAll++),
        _Auth(),
        [
          _order('ready_for_pickup', 'Mercury Drug - Ermita', 48000),
          _order('completed', 'Watsons - SM Manila', 12450),
          _order('cancelled', 'Southstar Drug - Paco', 31000),
          _order('completed', 'Fourth Pharmacy', 100),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Mark Test'), findsWidgets);
    expect(find.text('Not provided'), findsOneWidget);
    expect(find.text('Ready for pickup'), findsOneWidget);
    expect(find.text('Completed'), findsOneWidget);
    expect(find.text('Cancelled'), findsOneWidget);
    expect(find.text('Fourth Pharmacy'), findsNothing);
    final cancelled = tester.widget<Text>(find.text('₱310.00'));
    expect(cancelled.style?.decoration, TextDecoration.lineThrough);
    await tester.tap(find.text('View all'));
    await tester.pumpAndSettle();
    expect(find.text('Order History'), findsOneWidget);
    expect(find.text('Fourth Pharmacy'), findsOneWidget);
    expect(find.text('Mercury Drug - Ermita'), findsOneWidget);
    await tester.tap(find.text('Fourth Pharmacy'));
    await tester.pumpAndSettle();
    expect(viewAll, 1);
    expect(find.text('My Profile'), findsOneWidget);
    expect(find.byTooltip('Logout'), findsNothing);
    expect(find.byTooltip('Settings'), findsOneWidget);
  });

  testWidgets('profile with no orders says so and hides View all', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(ProfileScreen(onOpenOrders: () {}), _Auth(phone: '09171234567'), []),
    );
    await tester.pumpAndSettle();
    expect(find.text('No recent orders.'), findsOneWidget);
    expect(find.text('View all'), findsNothing);
    expect(find.text('09171234567'), findsOneWidget);
    expect(find.text('Not provided'), findsNothing);
  });

  testWidgets('edit account details is a full page with the name shown', (
    tester,
  ) async {
    await tester.pumpWidget(_app(const ProfileScreen(), _Auth(), []));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Edit contact details'));
    await tester.pumpAndSettle();
    expect(find.text('Edit Account Details'), findsOneWidget);
    expect(find.text('Save Changes'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
    expect(find.text('Required'), findsNothing);
    expect(find.text('MM/DD/YYYY'), findsNothing);
    expect(find.text('Birthdate'), findsNothing);
    expect(find.textContaining('order pickup'), findsNothing);
    expect(find.byType(TextFormField), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('My Profile'), findsOneWidget);
  });

  testWidgets('settings has change password, sign out everywhere and sign out', (
    tester,
  ) async {
    final auth = _Auth();
    var signedOut = 0;
    var everywhere = 0;
    await tester.pumpWidget(
      _app(
        SettingsScreen(
          email: 'mark@example.test',
          onAccountDeleted: () async {},
          onSignedOutEverywhere: () async => everywhere++,
          onSignOut: () async => signedOut++,
        ),
        auth,
        [],
      ),
    );
    expect(find.text('Change password'), findsOneWidget);
    expect(find.text('Delete account'), findsOneWidget);
    await tester.tap(find.byKey(const Key('sign-out-all')));
    await tester.pumpAndSettle();
    expect(auth.logoutAllCalls, 1);
    expect(everywhere, 1);
    await tester.ensureVisible(find.byKey(const Key('sign-out')));
    await tester.tap(find.byKey(const Key('sign-out')));
    expect(signedOut, 1);
    await tester.tap(find.byKey(const Key('change-password')));
    await tester.pumpAndSettle();
    expect(find.byType(TextFormField), findsOneWidget);
  });
}
