import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:provider/provider.dart';

import 'package:nearpill/features/map/data/location_service.dart';
import 'package:nearpill/features/map/presentation/map_view_model.dart';
import 'package:nearpill/features/pharmacy/data/pharmacy_repository.dart';
import 'package:nearpill/features/pharmacy/domain/pharmacy.dart';
import 'package:nearpill/features/pharmacy/presentation/pharmacy_view_model.dart';
import 'package:nearpill/screens/home.dart';
import 'package:nearpill/screens/home_store_detail.dart';
import 'package:nearpill/screens/map.dart';

const _store = Pharmacy(
  id: 7,
  name: 'Test pharmacy',
  address: 'Cebu City',
  latitude: 10.3157,
  longitude: 123.8854,
);
const _results = NearbyPharmacies(mode: 'manual', stores: [_store]);
const _roadRoute = DrivingRoute(
  distanceMeters: 1200,
  durationSeconds: 240,
  coordinates: [
    [123.88, 10.30],
    [123.882, 10.305],
    [123.8854, 10.3157],
  ],
);

class _Location extends LocationService {
  Stream<LocationResult> updates = const Stream.empty();
  @override
  Stream<LocationResult> positions() => updates;
  Future<LocationResult> Function() result = () async =>
      const LocationResult.failure('Search manually without location access.');

  @override
  Future<LocationResult> currentPosition() => result();
}

class _DeviceLocation extends GeolocatorPlatform {
  LocationSettings? requestedSettings;
  LocationPermission permission = LocationPermission.whileInUse;
  Future<LocationPermission> Function()? request;

  @override
  Future<bool> isLocationServiceEnabled() async => true;

  @override
  Future<LocationPermission> checkPermission() async => permission;

  @override
  Future<LocationPermission> requestPermission() => request!();

  @override
  Future<Position> getCurrentPosition({
    LocationSettings? locationSettings,
  }) async {
    requestedSettings = locationSettings;
    throw TimeoutException('No GPS fix');
  }
}

class _Pharmacies implements PharmacyRepository {
  List<Pharmacy> listed = [_store];
  NearbyPharmacies nearby = _results;
  bool nearbyFails = false;
  @override
  Future<List<Pharmacy>> listStores() async => listed;
  Future<NearbyPharmacies> Function(String) search = (_) async => _results;
  final nearbyRequests = <List<double>>[];

  @override
  Future<NearbyPharmacies> searchByLocation(String query) => search(query);

  @override
  Future<NearbyPharmacies> findNearby({
    required double latitude,
    required double longitude,
    double radiusKm = 5,
  }) async {
    nearbyRequests.add([latitude, longitude, radiusKm]);
    if (nearbyFails) throw StateError('Nearby unavailable');
    return nearby;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _MapPlatform extends MethodChannelGoogleMapsFlutter {
  final createdMaps = <int>{};
  final cameraUpdates = <Object?>[];

  @override
  Future<void> updateGroundOverlays(
    GroundOverlayUpdates updates, {
    required int mapId,
  }) async {}

  @override
  Widget buildViewWithConfiguration(
    int creationId,
    PlatformViewCreatedCallback onPlatformViewCreated, {
    required MapWidgetConfiguration widgetConfiguration,
    MapConfiguration mapConfiguration = const MapConfiguration(),
    MapObjects mapObjects = const MapObjects(),
  }) {
    if (createdMaps.add(creationId)) {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(ensureChannelInitialized(creationId), (
            call,
          ) async {
            if (call.method == 'camera#move') {
              cameraUpdates.add(call.arguments['cameraUpdate']);
            }
            return null;
          });
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => onPlatformViewCreated(creationId),
      );
    }
    return const SizedBox.expand();
  }
}

void main() {
  test('foreground location updates stop after closing the route', () async {
    var cancelled = false;
    final stream = StreamController<LocationResult>(
      onCancel: () {
        cancelled = true;
      },
    );
    final location = _Location()..updates = stream.stream;
    location.result = () async => const LocationResult.position(10.30, 123.88);
    final model = MapViewModel(
      pharmacies: _Pharmacies(),
      locationService: location,
      routeLoader: (_, _, _) async => _roadRoute,
    );
    await model.selectRoute(_store);
    stream.add(const LocationResult.position(10.31, 123.89));
    await Future<void>.delayed(Duration.zero);
    expect(model.latitude, 10.31);
    expect(model.longitude, 123.89);
    model.closeRoute();
    expect(cancelled, isTrue);
    stream.add(const LocationResult.position(10.32, 123.90));
    await Future<void>.delayed(Duration.zero);
    expect(model.latitude, 10.31);
    await stream.close();
    model.dispose();
  });
  test(
    'closing a route discards late replies and denied location sends no request',
    () async {
      final location = _Location();
      final pending = Completer<DrivingRoute>();
      var calls = 0;
      final model = MapViewModel(
        pharmacies: _Pharmacies(),
        locationService: location,
        routeLoader: (_, _, _) {
          calls++;
          return pending.future;
        },
      );
      await model.selectRoute(_store);
      expect(calls, 0);
      location.result = () async =>
          const LocationResult.position(10.30, 123.88);
      final loading = model.selectRoute(_store);
      await Future<void>.delayed(Duration.zero);
      model.closeRoute();
      pending.complete(_roadRoute);
      await loading;
      expect(model.route, isNull);
      expect(model.selectedStore, isNull);
      model.dispose();
      expect(
        () => DrivingRoute.fromJson({
          'distanceMeters': 1,
          'durationSeconds': 1,
          'coordinates': [
            [999, 1],
            [1, 1],
          ],
        }),
        throwsFormatException,
      );
    },
  );
  test(
    'device location requests GPS accuracy and fails without invented coordinates',
    () async {
      final original = GeolocatorPlatform.instance;
      final device = _DeviceLocation();
      GeolocatorPlatform.instance = device;
      addTearDown(() => GeolocatorPlatform.instance = original);
      final result = await LocationService().currentPosition();
      expect(device.requestedSettings?.accuracy, LocationAccuracy.high);
      expect(device.requestedSettings?.timeLimit, const Duration(seconds: 10));
      expect(result.hasPosition, isFalse);
      expect(result.latitude, isNull);
      expect(result.longitude, isNull);
      expect(result.error, contains('Current location is unavailable'));
    },
  );

  late _Location location;
  late _Pharmacies pharmacies;
  late MapViewModel model;

  setUp(() {
    location = _Location();
    pharmacies = _Pharmacies();
    model = MapViewModel(
      pharmacies: pharmacies,
      locationService: location,
      routeLoader: (_, _, _) async => _roadRoute,
    );
  });
  tearDown(() => model.dispose());

  testWidgets('tapping the Home location card requests location permission', (
    tester,
  ) async {
    final originalLocation = GeolocatorPlatform.instance;
    final originalMaps = GoogleMapsFlutterPlatform.instance;
    final permission = Completer<LocationPermission>();
    var requests = 0;
    GeolocatorPlatform.instance = _DeviceLocation()
      ..permission = LocationPermission.denied
      ..request = () {
        requests++;
        return permission.future;
      };
    GoogleMapsFlutterPlatform.instance = _MapPlatform();
    addTearDown(() {
      GeolocatorPlatform.instance = originalLocation;
      GoogleMapsFlutterPlatform.instance = originalMaps;
    });
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
            create: (_) => PharmacyViewModel(repository: pharmacies),
          ),
          ChangeNotifierProvider(
            create: (_) => MapViewModel(
              pharmacies: pharmacies,
              locationService: LocationService(),
            ),
          ),
        ],
        child: MaterialApp(home: HomeScreen(onLogout: () {})),
      ),
    );
    await tester.pumpAndSettle();
    expect(requests, 0);
    await tester.tap(find.text('Cebu City, Philippines'));
    await tester.pump();
    expect(requests, 1);
    expect(find.byType(MapScreen), findsOneWidget);

    permission.complete(LocationPermission.denied);
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Location permission was denied'),
      findsOneWidget,
    );
    expect(pharmacies.nearbyRequests, isEmpty);
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('See all pharmacies'));
    await tester.pumpAndSettle();
    expect(find.byType(MapScreen), findsOneWidget);
    expect(requests, 2);
    await tester.pumpWidget(const SizedBox());
  });

  test(
    'permission fallback supports manual search without inventing GPS',
    () async {
      await model.loadNearby();
      expect(model.state, MapLoadState.manualFallback);
      expect(pharmacies.nearbyRequests, isEmpty);
      expect(model.stores, [_store]);
      await model.searchManually('  Cebu  ');
      expect(model.stores, [_store]);
      expect(model.latitude, isNull);
      expect(model.longitude, isNull);
    },
  );

  test('nearby search uses actual location and the supported radius', () async {
    location.result = () async => const LocationResult.position(10.31, 123.89);
    await model.loadNearby();
    expect(pharmacies.nearbyRequests, [
      [10.31, 123.89, 5],
    ]);
    expect(model.latitude, 10.31);
    expect(model.longitude, 123.89);
    expect(model.state, MapLoadState.ready);
  });

  test(
    'outside-radius pharmacies stay visible with distances and the nearby warning',
    () async {
      location.result = () async => const LocationResult.position(10.0, 123.0);
      pharmacies.nearby = const NearbyPharmacies(
        mode: 'coordinates',
        stores: [],
      );
      await model.loadNearby();
      expect(model.stores.single.id, _store.id);
      expect(model.stores.single.distanceKm, greaterThan(5));
      expect(model.message, contains('No verified pharmacies within 5 km'));
      expect(model.state, MapLoadState.ready);
    },
  );

  test(
    'a failed nearby check retains listed pharmacies without claiming none are nearby',
    () async {
      location.result = () async =>
          const LocationResult.position(10.31, 123.89);
      pharmacies.nearbyFails = true;
      await model.loadNearby();
      expect(model.stores.single.id, _store.id);
      expect(model.message, contains('could not be checked'));
      expect(model.message, isNot(contains('No verified pharmacies within')));
    },
  );

  test(
    'older search and GPS results cannot overwrite newer manual search',
    () async {
      final oldSearch = Completer<NearbyPharmacies>();
      pharmacies.search = (query) =>
          query == 'old' ? oldSearch.future : Future.value(_results);
      final first = model.searchManually('old');
      await model.searchManually('Cebu');
      oldSearch.complete(const NearbyPharmacies(mode: 'manual', stores: []));
      await first;
      expect(model.stores, [_store]);

      final oldGps = Completer<LocationResult>();
      location.result = () => oldGps.future;
      final gps = model.loadNearby();
      await model.searchManually('Cebu');
      oldGps.complete(const LocationResult.position(10.31, 123.89));
      await gps;
      expect(pharmacies.nearbyRequests, isEmpty);
      expect(model.stores, [_store]);
      expect(model.latitude, isNull);
    },
  );

  test(
    'failed and blank searches clear stale pins and support retry',
    () async {
      await model.searchManually('Cebu');
      pharmacies.search = (_) async => throw StateError('Offline');
      await model.searchManually('Cebu');
      expect(model.stores, isEmpty);
      expect(model.state, MapLoadState.error);
      pharmacies.search = (_) async => _results;
      await model.searchManually('Cebu');
      expect(model.stores, [_store]);
      await model.searchManually(' ');
      expect(model.stores, isEmpty);
      expect(model.state, MapLoadState.manualFallback);
    },
  );

  test('platform location errors become a recoverable state', () async {
    location.result = () async => throw StateError('Platform unavailable');
    await model.loadNearby();
    expect(model.state, MapLoadState.error);
    expect(model.stores, isEmpty);
    await model.searchManually('Cebu');
    expect(model.state, MapLoadState.ready);
  });

  test('disposed models ignore pending replies', () async {
    final result = Completer<NearbyPharmacies>();
    pharmacies.search = (_) => result.future;
    final disposed = MapViewModel(
      pharmacies: pharmacies,
      locationService: location,
    );
    var notifications = 0;
    disposed.addListener(() => notifications++);
    final pending = disposed.searchManually('Cebu');
    disposed.dispose();
    result.complete(_results);
    await pending;
    expect(notifications, 1);
  });

  test('invalid coordinates cannot produce pins or directions', () {
    for (final latitude in [double.nan, double.infinity, -91.0, 91.0]) {
      final store = Pharmacy(
        id: 1,
        name: 'Invalid',
        address: '',
        latitude: latitude,
        longitude: 123,
      );
      expect(store.hasCoordinates, isFalse);
      expect(store.directionsUri, isNull);
      expect(LocationResult.position(latitude, 123).hasPosition, isFalse);
    }
    expect(
      const Pharmacy(id: 1, name: 'Missing', address: '').directionsUri,
      isNull,
    );
    expect(const LocationResult.position(10, 181).hasPosition, isFalse);
    expect(_store.directionsUri!.host, 'www.google.com');
    expect(_store.directionsUri!.queryParameters, {
      'api': '1',
      'destination': '10.3157,123.8854',
    });
  });

  testWidgets('outside-radius warning and pharmacy pins are visible together', (
    tester,
  ) async {
    final original = GoogleMapsFlutterPlatform.instance;
    GoogleMapsFlutterPlatform.instance = _MapPlatform();
    addTearDown(() => GoogleMapsFlutterPlatform.instance = original);
    location.result = () async => const LocationResult.position(10.0, 123.0);
    pharmacies.nearby = const NearbyPharmacies(mode: 'coordinates', stores: []);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: model,
        child: const MaterialApp(home: MapScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('No verified pharmacies within 5 km'),
      findsOneWidget,
    );
    expect(find.text(_store.name), findsOneWidget);
    final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
    expect(map.markers.length, 2);
    expect(map.markers.any((m) => m.markerId.value == 'pharmacy-7'), isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'manual results create real-coordinate markers and open inventory',
    (tester) async {
      final originalPlatform = GoogleMapsFlutterPlatform.instance;
      final platform = _MapPlatform();
      GoogleMapsFlutterPlatform.instance = platform;
      addTearDown(() => GoogleMapsFlutterPlatform.instance = originalPlatform);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: model,
          child: MaterialApp(
            home: const MapScreen(),
            onGenerateRoute: (settings) {
              expect(settings.name, StoreDetailScreen.routeName);
              expect(settings.arguments, '7');
              return MaterialPageRoute<void>(
                builder: (_) => const Scaffold(body: Text('Store inventory')),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Search manually without location access.'),
        findsOneWidget,
      );
      await tester.enterText(find.byType(TextField), 'Cebu');
      await tester.tap(find.byTooltip('Search pharmacies'));
      await tester.pumpAndSettle();
      final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      expect(map.myLocationEnabled, isFalse);
      expect(
        map.markers.where((m) => m.markerId.value == 'current-user'),
        isEmpty,
      );
      expect(map.markers.single.position, const LatLng(10.3157, 123.8854));
      expect(platform.cameraUpdates.last, [
        'newLatLngZoom',
        [10.3157, 123.8854],
        15.0,
      ]);
      expect(find.byTooltip('Directions to Test pharmacy'), findsOneWidget);
      location.result = () async =>
          const LocationResult.position(10.30, 123.88);
      await model.loadNearby();
      await tester.pumpAndSettle();
      final user = tester
          .widget<GoogleMap>(find.byType(GoogleMap))
          .markers
          .singleWhere((m) => m.markerId.value == 'current-user');
      expect(user.position, const LatLng(10.30, 123.88));
      expect(user.infoWindow.title, 'You are here');
      expect(user.zIndexInt, greaterThan(0));
      expect(find.text('You'), findsOneWidget);
      expect(find.text('Pharmacies'), findsOneWidget);
      expect(
        tester.widget<GoogleMap>(find.byType(GoogleMap)).myLocationEnabled,
        isTrue,
      );
      expect(platform.cameraUpdates.last, [
        'newLatLngBounds',
        [
          [10.30, 123.88],
          [10.3157, 123.8854],
        ],
        48.0,
      ]);
      await model.selectRoute(_store);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<GoogleMap>(find.byType(GoogleMap))
            .polylines
            .single
            .points
            .length,
        3,
      );
      expect(find.textContaining('1.20 km by road'), findsOneWidget);
      expect(find.textContaining('4 min estimated'), findsOneWidget);
      await tester.ensureVisible(find.text('View medicines'));
      await tester.tap(find.text('View medicines'));
      await tester.pumpAndSettle();
      expect(find.text('Store inventory'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'map search and route actions fit at large text on short screens',
    (tester) async {
      final original = GoogleMapsFlutterPlatform.instance;
      GoogleMapsFlutterPlatform.instance = _MapPlatform();
      addTearDown(() => GoogleMapsFlutterPlatform.instance = original);
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 568);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: model,
          child: MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: const MapScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Cebu');
      tester.view.viewInsets = const FakeViewPadding(bottom: 260);
      await tester.pumpAndSettle();
      expect(find.byTooltip('Search pharmacies').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.testTextInput.receiveAction(TextInputAction.search);
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      expect(find.text(_store.name), findsOneWidget);

      location.result = () async =>
          const LocationResult.position(10.30, 123.88);
      await model.selectRoute(_store);
      tester.view.physicalSize = const Size(640, 320);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Navigate'));
      await tester.pumpAndSettle();
      expect(find.text('Navigate').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
