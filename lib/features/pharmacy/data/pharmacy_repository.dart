import '../../../config/api_config.dart';
import '../../../core/api/api_client.dart';
import '../domain/pharmacy.dart';

abstract interface class PharmacyRepository {
  Future<List<Pharmacy>> listStores();
  Future<PharmacyInventory> getStoreInventory(int storeId);
  Future<NearbyPharmacies> findNearby({
    required double latitude,
    required double longitude,
    double radiusKm = 5,
  });
  Future<NearbyPharmacies> searchByLocation(String query);
}

class ApiPharmacyRepository implements PharmacyRepository {
  ApiPharmacyRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<DrivingRoute> drivingRoute(
    Pharmacy store,
    double latitude,
    double longitude,
  ) async {
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/stores/${store.id}/route'),
      queryParameters: {'latitude': latitude, 'longitude': longitude},
    );
    if (response.data is! Map) throw const FormatException('Invalid route');
    return DrivingRoute.fromJson(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  @override
  Future<List<Pharmacy>> listStores() async {
    final response = await apiClient.dio.get(ApiConfig.apiPath('/stores'));
    if (response.statusCode != 200 || response.data is! List) {
      throw const FormatException('Invalid pharmacy list.');
    }
    return (response.data as List)
        .whereType<Map>()
        .map((item) => Pharmacy.fromJson(Map<String, dynamic>.from(item)))
        .where((store) => store.id > 0)
        .toList();
  }

  @override
  Future<PharmacyInventory> getStoreInventory(int storeId) async {
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/stores/$storeId/inventory'),
      queryParameters: {'view': 'catalog'},
    );
    if (response.statusCode != 200 || response.data is! Map) {
      throw StateError('Pharmacy inventory is unavailable.');
    }
    final data = Map<String, dynamic>.from(response.data as Map);
    if (data['store'] is! Map || data['inventory'] is! List) {
      throw const FormatException('Invalid pharmacy inventory response.');
    }
    final inventory = (data['inventory'] as List)
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    return PharmacyInventory(
      store: Pharmacy.fromJson(Map<String, dynamic>.from(data['store'] as Map)),
      inventory: inventory,
    );
  }

  @override
  Future<NearbyPharmacies> findNearby({
    required double latitude,
    required double longitude,
    double radiusKm = 5,
  }) => _nearby({
    'latitude': latitude,
    'longitude': longitude,
    'radiusKm': radiusKm,
  });

  @override
  Future<NearbyPharmacies> searchByLocation(String query) =>
      _nearby({'q': query.trim()});

  Future<NearbyPharmacies> _nearby(Map<String, dynamic> query) async {
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/stores/nearby'),
      queryParameters: query,
    );
    if (response.statusCode != 200 || response.data is! Map) {
      throw StateError('Nearby pharmacy search failed.');
    }
    final data = Map<String, dynamic>.from(response.data as Map);
    final rawStores = data['stores'];
    if (rawStores is! List) {
      throw const FormatException('Invalid nearby response.');
    }
    final stores = rawStores
        .whereType<Map>()
        .map((item) => Pharmacy.fromJson(Map<String, dynamic>.from(item)))
        .where((store) => store.id > 0)
        .toList();
    final center = data['center'] is Map
        ? Map<String, dynamic>.from(data['center'] as Map)
        : const <String, dynamic>{};
    return NearbyPharmacies(
      mode: data['mode']?.toString() ?? 'manual',
      stores: stores,
      latitude: double.tryParse((center['latitude'] ?? '').toString()),
      longitude: double.tryParse((center['longitude'] ?? '').toString()),
      radiusKm: double.tryParse((data['radiusKm'] ?? '').toString()),
      query: data['query']?.toString(),
    );
  }
}
