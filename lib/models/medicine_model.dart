const stagingTestApprovalMarker =
    '[NEARPILL_STAGING_TEST_APPROVAL:afqqozfjpiodanpogvfb]';

enum CatalogCategory {
  nonPrescription('Non-Prescriptions'),
  prescription('Prescriptions'),
  nonMedicine('Non Medicines');

  const CatalogCategory(this.label);

  final String label;

  static CatalogCategory? fromCatalogValue(String? value) =>
      switch (value?.trim().toLowerCase()) {
        'non-prescription (source list)' ||
        'non-prescription' ||
        'non-prescriptions' ||
        'non - prescriptions' ||
        'otc' ||
        'general otc' => nonPrescription,
        'prescription (source list)' ||
        'prescription' ||
        'prescriptions' => prescription,
        'medical supplies' ||
        'non-medicine' ||
        'non-medicines' ||
        'non medicine' ||
        'non medicines' => nonMedicine,
        _ => null,
      };
}

class MedicineModel {
  MedicineModel({
    required this.id,
    required this.name,
    required this.priceCentavos,
    required this.drugstoreName,
    required this.drugstoreId,
    required this.category,
    required this.distance,
    required this.stockCount,
    this.description,
    this.canOrder = false,
    this.publicationStatus = 'draft',
    this.activeIngredients = const [],
    this.dosageForm,
    this.sellingUnit,
    this.packageSize,
    this.adultUseReviewed = false,
    this.otcEligible = false,
  });

  final String id;
  final String name;
  final int priceCentavos;
  final String drugstoreName;
  final String drugstoreId;
  final String category;
  final String distance;
  final int stockCount;
  final String? description;
  final bool canOrder;
  final String publicationStatus;
  final List<String> activeIngredients;
  final String? dosageForm;
  final String? sellingUnit, packageSize;
  final bool adultUseReviewed, otcEligible;

  int get cartQuantityLimit => canOrder ? stockCount : 999;

  /// False when the server could not compute a distance for this listing.
  bool get hasDistance => !distance.toLowerCase().contains('unavailable');

  String get listingStatus {
    if (stockCount == 0) return 'Out of stock';
    return 'Available';
  }

  String get price =>
      '₱${priceCentavos ~/ 100}.${(priceCentavos % 100).toString().padLeft(2, '0')}';

  String get pricePerUnit =>
      sellingUnit == null ? price : '$price per $sellingUnit';

  factory MedicineModel.fromJson(Map<String, dynamic> json) {
    final stockCount = int.tryParse(json['stockCount']?.toString() ?? '') ?? 0;
    final publicationStatus = json['publicationStatus']?.toString() ?? 'draft';
    final category = json['category']?.toString() ?? 'General';
    final distanceKm = double.tryParse(json['distanceKm']?.toString() ?? '');
    final centavos =
        int.tryParse(json['priceCentavos']?.toString() ?? '') ??
        ((double.tryParse(json['price']?.toString() ?? '') ?? 0) * 100).round();
    return MedicineModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      priceCentavos: centavos,
      drugstoreName:
          json['drugstoreName']?.toString() ??
          json['pharmacy']?.toString() ??
          'Unknown pharmacy',
      drugstoreId: json['drugstoreId']?.toString() ?? '',
      category: category,
      distance: distanceKm != null && distanceKm.isFinite && distanceKm >= 0
          ? '${distanceKm.toStringAsFixed(2)} km away'
          : json['distance']?.toString() ?? 'Distance unavailable',
      stockCount: stockCount,
      publicationStatus: publicationStatus,
      canOrder:
          publicationStatus == 'published' &&
          stockCount > 0 &&
          json['canOrder'] == true,
      activeIngredients:
          json['activeIngredients'] is List &&
              (json['activeIngredients'] as List).every(
                (item) => item is String && item.trim().isNotEmpty,
              )
          ? List<String>.unmodifiable(json['activeIngredients'] as List)
          : const [],
      dosageForm: json['dosageForm'] is String
          ? json['dosageForm'] as String
          : null,
      sellingUnit: json['sellingUnit'] is String
          ? json['sellingUnit'] as String
          : null,
      packageSize: json['packageSize'] is String
          ? json['packageSize'] as String
          : null,
      adultUseReviewed: json['adultUseReviewed'] == true,
      otcEligible: json['otcEligible'] == true,
      description: json['description']?.toString(),
    );
  }
}
