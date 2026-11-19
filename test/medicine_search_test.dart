import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dio/dio.dart';
import 'package:provider/provider.dart';

import 'package:nearpill/app_theme.dart';
import 'package:nearpill/widgets/skeleton.dart';
import 'package:nearpill/features/catalog/data/catalog_repository.dart';
import 'package:nearpill/features/catalog/presentation/catalog_view_model.dart';
import 'package:nearpill/features/cart/presentation/cart_view_model.dart';
import 'package:nearpill/features/pharmacy/data/pharmacy_repository.dart';
import 'package:nearpill/features/pharmacy/domain/pharmacy.dart';
import 'package:nearpill/features/pharmacy/presentation/pharmacy_view_model.dart';
import 'package:nearpill/models/medicine_model.dart';
import 'package:nearpill/screens/assistant_screen.dart';
import 'package:nearpill/screens/home.dart';
import 'package:nearpill/screens/search.dart';
import 'package:nearpill/screens/srch_medicine_detail.dart';
import 'package:nearpill/features/map/data/location_service.dart';
import 'package:nearpill/core/api/api_client.dart';
import 'package:nearpill/core/auth/session_manager.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'support/np_icon_finders.dart';

class _Location extends LocationService {
  LocationResult result = const LocationResult.failure('Location denied');
  @override
  Future<LocationResult> currentPosition() async => result;
}

class _CatalogRepository implements CatalogRepository {
  Future<List<MedicineModel>> Function() load = () async => [];
  Future<MedicineModel?> Function() loadDetail = () async => null;
  int calls = 0;
  double? latitude;
  double? longitude;
  bool catalog = false;

  @override
  Future<List<MedicineModel>> fetchMedicines({
    String search = '',
    bool catalog = false,
    double? latitude,
    double? longitude,
  }) {
    calls++;
    this.latitude = latitude;
    this.longitude = longitude;
    this.catalog = catalog;
    return load();
  }

  @override
  Future<MedicineModel?> fetchMedicineById(String id) => loadDetail();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _PharmacyRepository implements PharmacyRepository {
  List<Pharmacy> stores = [];
  bool unavailable = false;

  @override
  Future<List<Pharmacy>> listStores() async {
    if (unavailable) throw StateError('Offline');
    return stores;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

MedicineModel _medicine(String name, [String? category]) =>
    MedicineModel.fromJson({
      'id': name,
      'name': '[DEMO] $name',
      'drugstoreId': 25,
      'drugstoreName': 'Bing Pharmacy',
      'priceCentavos': 4975,
      'stockCount': 9,
      'publicationStatus': 'published',
      'canOrder': true,
      'category': category,
    });

void main() {
  late _CatalogRepository repository;
  late CatalogViewModel model;
  late _Location location;

  setUp(() {
    repository = _CatalogRepository();
    location = _Location();
    model = CatalogViewModel(repository: repository, locationService: location);
  });
  tearDown(() => model.dispose());

  Future<void> openSearch(WidgetTester tester) async {
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: model,
        child: const MaterialApp(home: Scaffold(body: SearchScreen())),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('refresh replaces an empty catalog and keeps the search text', (
    tester,
  ) async {
    await openSearch(tester);
    expect(find.text('No products found.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'paracetamol');
    final reply = Completer<List<MedicineModel>>();
    repository.load = () => reply.future;
    await tester.tap(find.byTooltip('Refresh products'));
    await tester.pump();
    expect(
      tester
          .widget<IconButton>(findIconButton(NpIcons.refresh))
          .onPressed,
      isNull,
    );
    reply.complete([_medicine('Paracetamol'), _medicine('Cetirizine')]);
    await tester.pumpAndSettle();
    expect(find.text('[DEMO] Paracetamol'), findsOneWidget);
    expect(find.text('[DEMO] Cetirizine'), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'paracetamol',
    );
    expect(repository.calls, 2);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('refresh retries a failed medicine request', (tester) async {
    repository.load = () async => throw StateError('Offline');
    await openSearch(tester);
    expect(
      find.text('Unable to load products. Please try again.'),
      findsOneWidget,
    );
    repository.load = () async => [_medicine('Paracetamol')];
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('[DEMO] Paracetamol'), findsOneWidget);
    expect(
      find.text('Unable to load products. Please try again.'),
      findsNothing,
    );
    expect(repository.calls, 2);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('returning to Home reloads pharmacy status without hours', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 568);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    final pharmacies = _PharmacyRepository()
      ..unavailable = true
      ..stores = [
        const Pharmacy(id: 25, name: 'Bing Pharmacy', address: 'Cebu'),
      ];
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: model),
          ChangeNotifierProvider(
            create: (_) => PharmacyViewModel(repository: pharmacies),
          ),
        ],
        child: MaterialApp(
          theme: appThemeData,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: HomeScreen(onLogout: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Unable to load the latest pharmacy'),
      findsOneWidget,
    );
    pharmacies.unavailable = false;
    await tester.ensureVisible(find.text('Try again'));
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('CLOSED'), findsOneWidget);

    await tester.tap(find.text('Search'));
    await tester.pumpAndSettle();
    pharmacies.stores = [
      const Pharmacy(
        id: 25,
        name: 'Bing Pharmacy',
        address: 'Cebu',
        operatingHours: 'Mon-Sun, 10:30 AM - 10:00 PM',
        openNow: true,
      ),
    ];
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(find.text('OPEN'), findsOneWidget);
    expect(find.textContaining('10:30 AM - 10:00 PM'), findsNothing);
    final semantics = tester.ensureSemantics();
    try {
      await tester.pump();
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    } finally {
      semantics.dispose();
    }
  });

  testWidgets(
    'Home categories filter products by their catalog classification',
    (tester) async {
      const categories = {
        'Non-Prescriptions': ('Paracetamol', 'Non-Prescription (source list)'),
        'Prescriptions': ('Amoxicillin', 'Prescription (source list)'),
        'Non Medicines': ('Gauze', 'Medical Supplies'),
      };
      repository.load = () async => [
        for (final (name, category) in categories.values)
          _medicine(name, category),
        _medicine('Unclassified product', 'Classification Needs Review'),
      ];
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: model),
            ChangeNotifierProvider(
              create: (_) =>
                  PharmacyViewModel(repository: _PharmacyRepository()),
            ),
          ],
          child: MaterialApp(home: HomeScreen(onLogout: () {})),
        ),
      );
      await tester.pumpAndSettle();

      for (final entry in categories.entries) {
        final card = find.text(entry.key);
        await tester.ensureVisible(card);
        await tester.tap(card);
        await tester.pumpAndSettle();
        for (final (name, _) in categories.values) {
          expect(
            find.text('[DEMO] $name'),
            name == entry.value.$1 ? findsOneWidget : findsNothing,
          );
        }
        expect(find.text('[DEMO] Unclassified product'), findsNothing);
        if (entry.key == 'Non Medicines') {
          await tester.enterText(find.byType(TextField), 'unclassified');
          await tester.pump();
          expect(find.text('No products match your search.'), findsOneWidget);
          await tester.tap(find.byTooltip('Clear category filter'));
          await tester.pumpAndSettle();
          expect(find.text('[DEMO] Unclassified product'), findsOneWidget);
          expect(find.text('[DEMO] Gauze'), findsNothing);
        }
        await tester.tap(find.text('Home'));
        await tester.pumpAndSettle();
      }

      await tester.tap(find.text('Search'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'unclassified');
      await tester.pump();
      expect(find.text('[DEMO] Unclassified product'), findsOneWidget);
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ask NearPill'));
      await tester.pumpAndSettle();
      expect(find.byType(AssistantScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  test(
    'catalog uses actual permitted coordinates and supports denied location',
    () async {
      await model.fetchMedicineListings();
      expect(repository.catalog, isTrue);
      expect(repository.latitude, isNull);
      expect(repository.longitude, isNull);
      location.result = const LocationResult.position(10.3157, 123.8854);
      await model.fetchMedicineListings();
      expect(repository.latitude, 10.3157);
      expect(repository.longitude, 123.8854);
    },
  );

  test('catalog fetches every page with one fixed GPS position', () async {
    final client = ApiClient(sessionManager: SessionManager());
    addTearDown(() => client.dio.close(force: true));
    client.dio.interceptors.clear();
    final offsets = <int>[];
    client.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final offset = options.queryParameters['offset'] as int;
          offsets.add(offset);
          expect(options.queryParameters['view'], 'catalog');
          expect(options.queryParameters['latitude'], 10.3157);
          expect(options.queryParameters['longitude'], 123.8854);
          final count = offset < 150 ? 50 : 21;
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: List.generate(
                count,
                (index) => {
                  'id': offset + index,
                  'name': 'Listed item ${offset + index}',
                  'publicationStatus': 'draft',
                  'canOrder': false,
                  'stockCount': 0,
                },
              ),
            ),
          );
        },
      ),
    );
    final results = await CatalogRepository(
      apiClient: client,
    ).fetchMedicines(catalog: true, latitude: 10.3157, longitude: 123.8854);
    expect(results.length, 171);
    expect(results.map((item) => item.id).toSet().length, 171);
    expect(offsets, [0, 50, 100, 150]);
    expect(results.every((item) => !item.canOrder), isTrue);
  });

  testWidgets('medicine details distinguish loading and failure, then retry', (
    tester,
  ) async {
    final reply = Completer<MedicineModel?>();
    repository.loadDetail = () => reply.future;
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: model,
        child: MaterialApp(
          onGenerateRoute: (_) => MaterialPageRoute<void>(
            settings: const RouteSettings(arguments: '1'),
            builder: (_) => const MedicineDetailScreen(),
          ),
        ),
      ),
    );
    expect(find.byType(SkeletonList), findsOneWidget);
    expect(find.text('Medicine not found.'), findsNothing);
    reply.completeError(StateError('Offline'));
    await tester.pumpAndSettle();
    expect(find.text('Unable to load medicine details.'), findsOneWidget);
    repository.loadDetail = () async => _medicine('Paracetamol');
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('[DEMO] Paracetamol'), findsOneWidget);
  });

  testWidgets(
    'unreviewed detail wraps at large text and supports saving to cart',
    (tester) async {
      final medicine = MedicineModel.fromJson({
        'id': 1,
        'name': 'Listed medicine with a long name and formulation',
        'drugstoreId': 25,
        'drugstoreName': 'Bing Pharmacy',
        'priceCentavos': 4975,
        'stockCount': 0,
        'canOrder': false,
        'publicationStatus': 'draft',
        'description': stagingTestApprovalMarker,
        'distanceKm': '2.06',
      });
      expect(medicine.distance, '2.06 km away');
      expect(medicine.canOrder, isFalse);
      await tester.binding.setSurfaceSize(const Size(320, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      FlutterSecureStorage.setMockInitialValues({'user_id': '1'});
      final cart = CartViewModel(sessionManager: SessionManager());
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: cart,
          child: MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(2)),
              child: child!,
            ),
            onGenerateRoute: (_) => MaterialPageRoute<void>(
              settings: RouteSettings(arguments: medicine),
              builder: (_) => const MedicineDetailScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(medicine.name), findsOneWidget);
      expect(find.text(medicine.listingStatus), findsOneWidget);
      expect(find.text('₱49.75'), findsNWidgets(2));
      expect(
        tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
        isNotNull,
      );
      final increase = find.byTooltip('Increase quantity');
      await tester.ensureVisible(increase);
      await tester.tap(increase);
      await tester.pumpAndSettle();
      await tester.tap(increase);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Decrease quantity'));
      await tester.pumpAndSettle();
      expect(find.text('₱99.50'), findsOneWidget);
      final addToCart = find.text('Add 2 to cart');
      await tester.ensureVisible(addToCart);
      await tester.tap(addToCart);
      await tester.pumpAndSettle();
      expect(cart.items.single.quantity, 2);
      expect(cart.checkoutBlockReason, isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
