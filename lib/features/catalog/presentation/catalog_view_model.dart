import 'package:flutter/foundation.dart';

import '../../../models/medicine_model.dart';
import '../data/catalog_repository.dart';
import '../../map/data/location_service.dart';

class CatalogViewModel extends ChangeNotifier {
  CatalogViewModel({
    required this._repository,
    LocationService? locationService,
  }) : _locationService = locationService ?? LocationService();

  final CatalogRepository _repository;
  final LocationService _locationService;

  Future<List<MedicineModel>> fetchMedicines({String search = ''}) =>
      _repository.fetchMedicines(search: search);

  /// Why distances are missing on the last listing load (null when known).
  String? locationNote;

  Future<List<MedicineModel>> fetchMedicineListings() async {
    final location = await _locationService.currentPosition();
    locationNote = location.hasPosition ? null : location.error;
    return _repository.fetchMedicines(
      catalog: true,
      latitude: location.hasPosition ? location.latitude : null,
      longitude: location.hasPosition ? location.longitude : null,
    );
  }

  Future<MedicineModel?> fetchMedicineById(String id) =>
      _repository.fetchMedicineById(id);
}
