import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_theme.dart';
import 'core/api/api_client.dart';
import 'core/auth/session_manager.dart';
import 'features/assistant/assistant_repository.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/presentation/auth_view_model.dart';
import 'features/cart/presentation/cart_view_model.dart';
import 'features/favourites/favourites_view_model.dart';
import 'features/orders/presentation/order_updates_view_model.dart';
import 'screens/notifications_screen.dart';
import 'features/catalog/data/catalog_repository.dart';
import 'features/catalog/presentation/catalog_view_model.dart';
import 'features/map/data/location_service.dart';
import 'features/map/presentation/map_view_model.dart';
import 'features/orders/data/order_repository.dart';
import 'features/orders/presentation/order_view_model.dart';
import 'features/pharmacy/data/pharmacy_repository.dart';
import 'features/pharmacy/presentation/pharmacy_view_model.dart';
import 'screens/auth_portal_screen.dart';
import 'screens/home.dart';
import 'screens/home_store_detail.dart';
import 'screens/orders/checkout.dart';
import 'screens/orders/confirmation.dart';
import 'screens/orders/orders.dart';
import 'screens/search.dart';
import 'screens/srch_medicine_detail.dart';
import 'widgets/auth_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final navigatorKey = GlobalKey<NavigatorState>();
  final sessionManager = SessionManager();
  final cartViewModel = CartViewModel(sessionManager: sessionManager);
  late final OrderViewModel orderViewModel;
  late final OrderUpdatesViewModel orderUpdatesViewModel;
  final apiClient = ApiClient(
    sessionManager: sessionManager,
    onUnauthorized: () {
      orderViewModel.clearOrders();
      orderUpdatesViewModel.clear();
      unawaited(cartViewModel.loadCart().catchError((_) {}));
      navigatorKey.currentState?.pushNamedAndRemoveUntil(
        '/login',
        (route) => false,
      );
    },
  );
  final authRepository = AuthRepository(apiClient: apiClient);
  final catalogRepository = CatalogRepository(apiClient: apiClient);
  final pharmacyRepository = ApiPharmacyRepository(apiClient: apiClient);
  final authViewModel = AuthViewModel(repository: authRepository);
  final catalogViewModel = CatalogViewModel(repository: catalogRepository);
  final pharmacyViewModel = PharmacyViewModel(repository: pharmacyRepository);
  final orderRepository = OrderRepository(apiClient: apiClient);
  final assistantRepository = AssistantRepository(apiClient: apiClient);
  await cartViewModel.loadCart();
  orderViewModel = OrderViewModel(repository: orderRepository);
  orderUpdatesViewModel = OrderUpdatesViewModel(repository: orderRepository);
  final favouritesViewModel = FavouritesViewModel(
    sessionManager: sessionManager,
  );
  final mapViewModel = MapViewModel(
    pharmacies: pharmacyRepository,
    locationService: LocationService(),
    routeLoader: pharmacyRepository.drivingRoute,
  );

  runApp(
    MultiProvider(
      providers: [
        Provider<AssistantChat>.value(value: assistantRepository),
        ChangeNotifierProvider<AuthViewModel>.value(value: authViewModel),
        ChangeNotifierProvider<CatalogViewModel>.value(value: catalogViewModel),
        ChangeNotifierProvider<PharmacyViewModel>.value(
          value: pharmacyViewModel,
        ),
        ChangeNotifierProvider<CartViewModel>.value(value: cartViewModel),
        ChangeNotifierProvider<OrderViewModel>.value(value: orderViewModel),
        ChangeNotifierProvider<OrderUpdatesViewModel>.value(
          value: orderUpdatesViewModel,
        ),
        ChangeNotifierProvider<FavouritesViewModel>.value(
          value: favouritesViewModel,
        ),
        ChangeNotifierProvider<MapViewModel>.value(value: mapViewModel),
      ],
      child: NearPillApp(navigatorKey: navigatorKey),
    ),
  );
}

class NearPillApp extends StatelessWidget {
  const NearPillApp({super.key, required this.navigatorKey});

  final GlobalKey<NavigatorState> navigatorKey;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navigatorKey,
      title: 'NearPill',
      theme: appThemeData,
      home: AuthGate(
        authService: context.read<AuthViewModel>(),
        navigatorKey: navigatorKey,
      ),
      routes: {
        '/login': (context) => const AuthPortalScreen(),
        HomeScreen.routeName: (context) => HomeScreen(
          onLogout: () => Navigator.of(
            context,
          ).pushNamedAndRemoveUntil('/login', (route) => false),
        ),
        SearchScreen.routeName: (context) => const SearchScreen(),
        MedicineDetailScreen.routeName: (context) =>
            const MedicineDetailScreen(),
        OrdersScreen.routeName: (context) => const OrdersScreen(),
        NotificationsScreen.routeName: (context) => const NotificationsScreen(),
        StoreDetailScreen.routeName: (context) => const StoreDetailScreen(),
        CheckoutFlowScreen.routeName: (context) => const CheckoutFlowScreen(),
        OrderConfirmationScreen.routeName: (context) =>
            const OrderConfirmationScreen(
              reference: 'NP-00000000',
              storeName: 'Pharmacy',
            ),
      },
    );
  }
}
