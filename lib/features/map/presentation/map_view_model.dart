import 'package:flutter/foundation.dart';
import 'dart:async';
import 'package:geolocator/geolocator.dart';

import '../../pharmacy/data/pharmacy_repository.dart';
import '../../pharmacy/domain/pharmacy.dart';
import '../data/location_service.dart';

enum MapLoadState { idle, loading, ready, manualFallback, error }

class MapViewModel extends ChangeNotifier {
  MapViewModel({
    required this.pharmacies,
    required this.locationService,
    this.routeLoader,
  });
  final Future<DrivingRoute> Function(Pharmacy, double, double)? routeLoader;
  Pharmacy? selectedStore;
  DrivingRoute? route;
  bool routeLoading = false;
  String? routeError;
  int _routeRequest = 0;
  StreamSubscription<LocationResult>? _tracking;
  DateTime? _lastRouteAt;

  void closeRoute() {
    final changed = selectedStore != null || routeLoading || routeError != null;
    ++_routeRequest;
    _tracking?.cancel();
    _tracking = null;
    selectedStore = null;
    route = null;
    routeLoading = false;
    routeError = null;
    if (changed) notifyListeners();
  }

  void pauseTracking() {
    ++_routeRequest;
    _tracking?.cancel();
    _tracking = null;
    routeLoading = false;
  }

  Future<void> selectRoute(Pharmacy store) async {
    closeRoute();
    selectedStore = store;
    final request = ++_routeRequest;
    routeLoading = true;
    notifyListeners();
    final position = await locationService.currentPosition();
    if (request != _routeRequest) return;
    if (!position.hasPosition) {
      routeLoading = false;
      routeError = position.error;
      notifyListeners();
      return;
    }
    await _updateRoute(position, request);
    if (request != _routeRequest || routeLoader == null) return;
    _tracking = locationService.positions().listen(
      (position) {
        if (request != _routeRequest || !position.hasPosition) return;
        _latitude = position.latitude;
        _longitude = position.longitude;
        if (!routeLoading &&
            DateTime.now()
                    .difference(_lastRouteAt ?? DateTime(1970))
                    .inSeconds >=
                15) {
          unawaited(_updateRoute(position, request));
        }
        notifyListeners();
      },
      onError: (_) {
        if (request != _routeRequest) return;
        routeError = 'Location updates paused. Refresh your route.';
        notifyListeners();
      },
    );
  }

  Future<void> _updateRoute(LocationResult position, int request) async {
    _latitude = position.latitude;
    _longitude = position.longitude;
    routeLoading = true;
    route = null;
    routeError = null;
    _lastRouteAt = DateTime.now();
    notifyListeners();
    try {
      if (routeLoader == null) {
        throw StateError('Route provider not configured');
      }
      final result = await routeLoader!(
        selectedStore!,
        position.latitude!,
        position.longitude!,
      );
      if (request != _routeRequest) return;
      route = result;
    } catch (_) {
      if (request != _routeRequest) return;
      routeError = 'Road route unavailable. Refresh or open Google Maps.';
    }
    routeLoading = false;
    notifyListeners();
  }

  final PharmacyRepository pharmacies;
  final LocationService locationService;

  MapLoadState _state = MapLoadState.idle;
  List<Pharmacy> _stores = const [];
  double? _latitude;
  double? _longitude;
  String? _message;
  int _requestId = 0;

  MapLoadState get state => _state;
  List<Pharmacy> get stores => List.unmodifiable(_stores);
  double? get latitude => _latitude;
  double? get longitude => _longitude;
  String? get message => _message;

  Future<void> loadNearby() async {
    closeRoute();
    final request = ++_requestId;
    _state = MapLoadState.loading;
    _message = null;
    _stores = const [];
    _latitude = null;
    _longitude = null;
    notifyListeners();

    try {
      final location = await locationService.currentPosition();
      if (request != _requestId) return;
      final allStores = await pharmacies.listStores();
      if (request != _requestId) return;
      if (!location.hasPosition) {
        _state = MapLoadState.manualFallback;
        _message = location.error ?? 'Search by pharmacy or area instead.';
        _stores = allStores;
        notifyListeners();
        return;
      }

      _latitude = location.latitude;
      _longitude = location.longitude;
      var listed = allStores;
      try {
        final result = await pharmacies.findNearby(
          latitude: location.latitude!,
          longitude: location.longitude!,
        );
        if (request != _requestId) return;
        listed = {
          for (final store in allStores) store.id: store,
          for (final store in result.stores) store.id: store,
        }.values.toList();
        _message = result.stores.isEmpty
            ? 'No verified pharmacies within 5 km. Try searching by name or area.${listed.isNotEmpty ? ' Showing all listed pharmacies.' : ''}'
            : null;
      } catch (_) {
        if (request != _requestId) return;
        _message =
            'Nearby availability could not be checked. Showing listed pharmacies; try again.';
      }
      _stores =
          listed
              .map(
                (store) => !store.hasCoordinates
                    ? store
                    : Pharmacy(
                        id: store.id,
                        name: store.name,
                        address: store.address,
                        latitude: store.latitude,
                        longitude: store.longitude,
                        operatingHours: store.operatingHours,
                        openNow: store.openNow,
                        distanceKm:
                            Geolocator.distanceBetween(
                              location.latitude!,
                              location.longitude!,
                              store.latitude!,
                              store.longitude!,
                            ) /
                            1000,
                      ),
              )
              .toList()
            ..sort(
              (a, b) => (a.distanceKm ?? double.infinity).compareTo(
                b.distanceKm ?? double.infinity,
              ),
            );
      _state = MapLoadState.ready;
    } catch (_) {
      if (request != _requestId) return;
      _state = MapLoadState.error;
      _message =
          'Nearby pharmacies could not be loaded. Search manually or try again.';
    }
    notifyListeners();
  }

  Future<void> searchManually(String query) async {
    closeRoute();
    final request = ++_requestId;
    final normalized = query.trim();
    _stores = const [];
    _latitude = null;
    _longitude = null;
    if (normalized.isEmpty) {
      _state = MapLoadState.manualFallback;
      _message = 'Enter a pharmacy, street, or area.';
      notifyListeners();
      return;
    }

    _state = MapLoadState.loading;
    _message = null;
    notifyListeners();
    try {
      final result = await pharmacies.searchByLocation(normalized);
      if (request != _requestId) return;
      _stores = result.stores;
      _state = MapLoadState.ready;
      _message = _stores.isEmpty
          ? 'No verified pharmacies matched that search.'
          : null;
    } catch (_) {
      if (request != _requestId) return;
      _state = MapLoadState.error;
      _message = 'Pharmacy search is unavailable. Please try again.';
    }
    notifyListeners();
  }

  @override
  void dispose() {
    ++_routeRequest;
    _tracking?.cancel();
    ++_requestId;
    super.dispose();
  }
}
