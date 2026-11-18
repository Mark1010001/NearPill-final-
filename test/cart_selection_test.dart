import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/features/cart/presentation/cart_view_model.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<CartViewModel> cartWithTwoItems() async {
    FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
    final cart = CartViewModel(sessionManager: SessionManager());
    await cart.addItem(
      id: '1',
      name: 'Acetylcysteine 600 mg',
      priceCentavos: 2500,
      drugstoreName: 'Dobol B Pharmacy',
      drugstoreId: '7',
      category: 'Prescription (source list)',
      quantity: 4,
    );
    await cart.addItem(
      id: '2',
      name: 'Ascof Forte 300 mg',
      priceCentavos: 1000,
      drugstoreName: 'Dobol B Pharmacy',
      drugstoreId: '7',
      category: 'Non-Prescription (source list)',
      quantity: 11,
    );
    return cart;
  }

  test('total and checkout use only the ticked items', () async {
    final cart = await cartWithTwoItems();
    expect(cart.totalCentavos, 21000);
    await cart.setSelected(cart.items[1], false);
    expect(cart.totalCentavos, 10000);
    expect(cart.itemsForPharmacy('7').map((item) => item.id), ['1']);
    expect(cart.items.length, 2);
    expect(cart.checkoutBlockReason, isNull);
  });

  test('prescription block ignores unticked prescription items', () async {
    final cart = await cartWithTwoItems();
    expect(cart.prescriptionBlockLabel, isNotNull);
    await cart.setSelected(cart.items[0], false);
    expect(cart.prescriptionBlockLabel, isNull);
  });

  test('nothing ticked blocks checkout with a clear reason', () async {
    final cart = await cartWithTwoItems();
    await cart.setAllSelected(false);
    expect(cart.checkoutBlockReason, 'Select the items you want to check out.');
    await cart.setPharmacySelected('7', true);
    expect(cart.checkoutBlockReason, isNull);
  });
}
