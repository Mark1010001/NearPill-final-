class Pharmacy {
  const Pharmacy({
    required this.id,
    required this.name,
    required this.address,
    this.latitude,
    this.longitude,
    this.operatingHours,
    this.openNow,
    this.distanceKm,
  });

  final int id;
  final String name;
  final String address;
  final double? latitude;
  final double? longitude;
  final String? operatingHours;
  final bool? openNow;
  final double? distanceKm;

  bool get hasCoordinates {
    final lat = latitude;
    final lng = longitude;
    return lat != null &&
        lng != null &&
        lat.isFinite &&
        lng.isFinite &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;
  }

  Uri? get directionsUri => hasCoordinates
      ? Uri.https('www.google.com', '/maps/dir/', {
          'api': '1',
          'destination': '$latitude,$longitude',
        })
      : null;

  factory Pharmacy.fromJson(Map<String, dynamic> json) => Pharmacy(
    id: int.tryParse((json['store_id'] ?? json['id'] ?? '').toString()) ?? 0,
    name: (json['store_name'] ?? json['name'] ?? 'Pharmacy').toString(),
    address: (json['address'] ?? '').toString(),
    latitude: double.tryParse((json['latitude'] ?? '').toString()),
    longitude: double.tryParse((json['longitude'] ?? '').toString()),
    operatingHours: json['operating_hours']?.toString(),
    openNow: json['openNow'] is bool ? json['openNow'] as bool : null,
    distanceKm: double.tryParse((json['distanceKm'] ?? '').toString()),
  );
}

class DrivingRoute {
  const DrivingRoute({
    required this.distanceMeters,
    required this.durationSeconds,
    required this.coordinates,
  });
  final double distanceMeters;
  final double durationSeconds;
  final List<List<double>> coordinates;

  factory DrivingRoute.fromJson(Map<String, dynamic> json) {
    final distance = double.tryParse('${json['distanceMeters']}');
    final duration = double.tryParse('${json['durationSeconds']}');
    final raw = json['coordinates'];
    if (distance == null ||
        !distance.isFinite ||
        distance < 0 ||
        duration == null ||
        !duration.isFinite ||
        duration < 0 ||
        raw is! List ||
        raw.length < 2 ||
        raw.length > 20000) {
      throw const FormatException('Invalid road route');
    }
    final points = raw.map((p) {
      if (p is! List ||
          p.length != 2 ||
          p[0] is! num ||
          p[1] is! num ||
          !(p[0] as num).isFinite ||
          !(p[1] as num).isFinite ||
          (p[0] as num).abs() > 180 ||
          (p[1] as num).abs() > 90) {
        throw const FormatException('Invalid route coordinates');
      }
      return [(p[0] as num).toDouble(), (p[1] as num).toDouble()];
    }).toList();
    return DrivingRoute(
      distanceMeters: distance,
      durationSeconds: duration,
      coordinates: points,
    );
  }
}

class PharmacyInventory {
  const PharmacyInventory({required this.store, required this.inventory});

  final Pharmacy store;
  final List<Map<String, dynamic>> inventory;
}

class NearbyPharmacies {
  const NearbyPharmacies({
    required this.mode,
    required this.stores,
    this.latitude,
    this.longitude,
    this.radiusKm,
    this.query,
  });

  final String mode;
  final List<Pharmacy> stores;
  final double? latitude;
  final double? longitude;
  final double? radiusKm;
  final String? query;
}
