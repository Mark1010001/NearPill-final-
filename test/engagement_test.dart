import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/favourites/favourites_view_model.dart';
import 'package:nearpill/features/orders/data/order_repository.dart';
import 'package:nearpill/features/orders/presentation/order_updates_view_model.dart';
import 'package:nearpill/models/order_model.dart';

OrderModel order(int id, String stage, {String store = 'Test Central Pharmacy'}) =>
    OrderModel(
      id: id,
      reference: 'NP-$id',
      storeName: store,
      itemSummary: '',
      itemCount: 0,
      total: '₱0.00',
      placedOn: 'Nov 1, 2026',
      stage: stage,
      items: const [],
    );

class _Repository implements OrderRepository {
  _Repository(this.orders);
  List<OrderModel> orders;

  @override
  Future<int?> currentAccountId() async => 7;

  @override
  Future<List<OrderModel>> listOrders({int? expectedUserId}) async => orders;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('order update wording matches the website', () {
    test('every stage has its own message', () {
      expect(updateMessage(order(1, 'placed')), 'Your order at Test Central Pharmacy was placed.');
      expect(updateMessage(order(1, 'reserved')), 'Your order at Test Central Pharmacy was placed.');
      expect(updateMessage(order(1, 'preparing')), 'Test Central Pharmacy is preparing your order.');
      expect(updateMessage(order(1, 'ready_for_pickup')), 'Your order at Test Central Pharmacy is ready for pickup.');
      expect(updateMessage(order(1, 'completed')), 'You collected your order from Test Central Pharmacy.');
      expect(updateMessage(order(1, 'cancelled')), 'Your order at Test Central Pharmacy was cancelled.');
      expect(updateMessage(order(1, 'expired')), 'Your reservation at Test Central Pharmacy expired.');
      expect(updateMessage(order(1, 'placed', store: '  ')), 'Your order at the pharmacy was placed.');
    });

    test('a changed stage is unread, newest order first, and no baseline means none unread', () {
      final orders = [order(31, 'completed'), order(32, 'preparing')];
      final updates = buildUpdates(orders, {'31': 'completed', '32': 'placed'});
      expect(updates.map((u) => u.order.id), [32, 31]);
      expect(updates.map((u) => u.unread), [true, false]);
      expect(buildUpdates(orders, null).any((u) => u.unread), isFalse);
      expect(buildUpdates(orders, {}).every((u) => u.unread), isTrue);
    });

    test('seen stages parse safely', () {
      expect(parseSeen(null), isNull);
      expect(parseSeen('not json'), isNull);
      expect(parseSeen('[1,2]'), isNull);
      expect(parseSeen('{"1":"ready","2":3}'), {'1': 'ready'});
    });
  });

  group('order updates on the phone', () {
    test('the first load records a baseline, later changes are new, and mark all read clears them', () async {
      FlutterSecureStorage.setMockInitialValues({});
      final repository = _Repository([order(32, 'placed'), order(31, 'completed')]);
      final model = OrderUpdatesViewModel(repository: repository);
      await model.refresh();
      expect(model.unreadCount, 0);

      repository.orders = [order(32, 'ready'), order(31, 'completed')];
      await model.refresh();
      expect(model.unreadCount, 1);
      expect(model.updates.first.message, 'Your order at Test Central Pharmacy is ready for pickup.');

      await model.markAllRead();
      expect(model.unreadCount, 0);

      // A new view model on the same phone remembers what was seen.
      final again = OrderUpdatesViewModel(repository: repository);
      await again.refresh();
      expect(again.unreadCount, 0);
      repository.orders = [order(32, 'completed'), order(31, 'completed')];
      await again.refresh();
      expect(again.unreadCount, 1);
    });
  });

  group('favourite pharmacies', () {
    test('parse only positive whole numbers', () {
      expect(parseFavourites(null), isEmpty);
      expect(parseFavourites('oops'), isEmpty);
      expect(parseFavourites('{"a":1}'), isEmpty);
      expect(parseFavourites('[3, 3, -1, 0, "x", 8]'), {3, 8});
    });

    test('are kept per account and survive a restart', () async {
      FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
      final session = SessionManager();
      final model = FavouritesViewModel(sessionManager: session);
      expect(model.signedIn, isFalse);
      await model.toggle(5); // ignored: not signed in yet
      await model.refresh();
      expect(model.signedIn, isTrue);

      await model.toggle(5);
      await model.toggle(9);
      expect(model.ids, {5, 9});
      expect(model.isFavourite(5), isTrue);

      final restarted = FavouritesViewModel(sessionManager: session);
      await restarted.refresh();
      expect(restarted.ids, {5, 9});

      await restarted.toggle(5);
      await restarted.toggle(9);
      final empty = FavouritesViewModel(sessionManager: session);
      await empty.refresh();
      expect(empty.ids, isEmpty);
    });

    test('another account does not see them', () async {
      FlutterSecureStorage.setMockInitialValues({
        'user_id': '2',
        'nearpill_favourites_user_1': '[5]',
      });
      final model = FavouritesViewModel(sessionManager: SessionManager());
      await model.refresh();
      expect(model.ids, isEmpty);
    });
  });
}
