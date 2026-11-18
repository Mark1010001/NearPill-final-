import '../../../config/api_config.dart';
import '../../../core/api/api_client.dart';
import '../../../models/medicine_model.dart';

class CatalogRepository {
  CatalogRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<List<MedicineModel>> fetchMedicines({
    String search = '',
    bool catalog = false,
    double? latitude,
    double? longitude,
  }) async {
    if (catalog) {
      final medicines = <MedicineModel>[];
      // shortcut: the API caps offsets at 1,000, add cursor paging before the catalog exceeds 1,050 listings.
      for (var offset = 0; offset <= 1000; offset += 50) {
        final response = await apiClient.dio.get(
          ApiConfig.apiPath('/medicines'),
          queryParameters: {
            'view': 'catalog',
            'limit': 50,
            'offset': offset,
            if (search.trim().isNotEmpty) 'search': search.trim(),
            if (latitude != null && longitude != null) ...{
              'latitude': latitude,
              'longitude': longitude,
            },
          },
        );
        if (response.data is! List ||
            !(response.data as List).every((item) => item is Map)) {
          throw const FormatException('Invalid medicine catalog response.');
        }
        final page = response.data as List;
        medicines.addAll(
          page.map(
            (item) =>
                MedicineModel.fromJson(Map<String, dynamic>.from(item as Map)),
          ),
        );
        if (page.length < 50) return medicines;
      }
      throw StateError('Too many medicine listings. Please narrow the search.');
    }
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/medicines'),
      queryParameters: search.trim().isEmpty ? null : {'search': search.trim()},
    );
    if (response.statusCode == 200 && response.data is List) {
      return (response.data as List)
          .whereType<Map>()
          .map(
            (item) => MedicineModel.fromJson(Map<String, dynamic>.from(item)),
          )
          .toList();
    }
    return const [];
  }

  Future<MedicineModel?> fetchMedicineById(String id) async {
    final response = await apiClient.dio.get(
      ApiConfig.apiPath('/medicines/$id'),
    );
    if (response.statusCode == 200 && response.data is Map) {
      return MedicineModel.fromJson(
        Map<String, dynamic>.from(response.data as Map),
      );
    }
    return null;
  }
}
