import 'package:geolocator/geolocator.dart';

class LocationResult {
  const LocationResult._({this.latitude, this.longitude, this.error});

  const LocationResult.position(double latitude, double longitude)
    : this._(latitude: latitude, longitude: longitude);
  const LocationResult.failure(String error) : this._(error: error);

  final double? latitude;
  final double? longitude;
  final String? error;
  bool get hasPosition =>
      latitude != null &&
      longitude != null &&
      latitude!.isFinite &&
      longitude!.isFinite &&
      latitude! >= -90 &&
      latitude! <= 90 &&
      longitude! >= -180 &&
      longitude! <= 180;
}

class LocationService {
  Stream<LocationResult> positions() => Geolocator.getPositionStream(
    locationSettings: const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 25,
    ),
  ).map((p) => LocationResult.position(p.latitude, p.longitude));

  Future<LocationResult> currentPosition() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return const LocationResult.failure(
          'Location services are off. Search by pharmacy or area instead.',
        );
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied) {
        return const LocationResult.failure(
          'Location permission was denied. Search by pharmacy or area instead.',
        );
      }
      if (permission == LocationPermission.deniedForever) {
        return const LocationResult.failure(
          'Location permission is disabled in system settings. Search manually instead.',
        );
      }

      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 10),
          ),
        );
      } catch (_) {
        // Indoors a GPS fix often times out; the phone's last known location
        // is still accurate enough to show "how far is this pharmacy".
        position = await _lastKnown();
      }
      if (position == null) {
        return const LocationResult.failure(
          'Current location is unavailable. Search by pharmacy or area instead.',
        );
      }
      return LocationResult.position(position.latitude, position.longitude);
    } catch (_) {
      return const LocationResult.failure(
        'Current location is unavailable. Search by pharmacy or area instead.',
      );
    }
  }

  Future<Position?> _lastKnown() async {
    try {
      return await Geolocator.getLastKnownPosition();
    } catch (_) {
      return null;
    }
  }
}
