import 'package:flutter/foundation.dart';

import '../data/pharmacy_repository.dart';
import '../domain/pharmacy.dart';

class PharmacyViewModel extends ChangeNotifier {
  PharmacyViewModel({required this._repository});

  final PharmacyRepository _repository;

  Future<List<Pharmacy>> listStores() => _repository.listStores();
  Future<PharmacyInventory> getStoreInventory(int storeId) =>
      _repository.getStoreInventory(storeId);
}
