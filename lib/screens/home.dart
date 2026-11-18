import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/medicine_model.dart';
import '../features/pharmacy/domain/pharmacy.dart';
import '../features/pharmacy/presentation/pharmacy_view_model.dart';
import '../app_theme.dart';
import '../features/cart/presentation/cart_view_model.dart';
import '../features/favourites/favourites_view_model.dart';
import '../features/orders/presentation/order_updates_view_model.dart';
import '../widgets/favourite_heart.dart';
import '../widgets/bottom_nav_bar.dart';
import '../widgets/np_ui.dart';
import 'orders/orders.dart';
import 'home_store_detail.dart';
import 'search.dart';
import 'map.dart';
import 'profile_screen.dart';
import 'assistant_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onLogout});

  final VoidCallback onLogout;

  static const routeName = '/home';

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;

  CatalogCategory? _selectedCategory;

  List<Pharmacy> _drugstores = [];
  bool _loadingDrugstores = true;
  bool _drugstoreLoadFailed = false;
  int _drugstoreRequest = 0;
  bool _openOnly = false;
  bool _favouritesOnly = false;
  Timer? _updatesTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _loadDrugstores();
      _refreshEngagement();
    });
    _updatesTimer = Timer.periodic(
      const Duration(seconds: 60),
      (_) => _refreshEngagement(),
    );
  }

  @override
  void dispose() {
    _updatesTimer?.cancel();
    super.dispose();
  }

  T? _maybeRead<T>() {
    try {
      return context.read<T>();
    } on ProviderNotFoundException {
      return null;
    }
  }

  T? _maybeWatch<T>() {
    try {
      return context.watch<T>();
    } on ProviderNotFoundException {
      return null;
    }
  }

  void _refreshEngagement() {
    if (!mounted) return;
    _maybeRead<FavouritesViewModel>()?.refresh();
    _maybeRead<OrderUpdatesViewModel>()?.refresh();
  }

  int _unreadUpdates(BuildContext context) {
    try {
      return context.watch<OrderUpdatesViewModel>().unreadCount;
    } on ProviderNotFoundException {
      return 0;
    }
  }

  List<Pharmacy> _visibleDrugstores() {
    final favourites = _maybeWatch<FavouritesViewModel>();
    return _drugstores
        .where(
          (store) =>
              (!_openOnly || store.openNow == true) &&
              (!_favouritesOnly ||
                  (favourites?.isFavourite(store.id) ?? false)),
        )
        .toList();
  }

  int _ordersTab = 0;

  void _onItemTapped(int index, {CatalogCategory? category, int ordersTab = 0}) {
    setState(() {
      _ordersTab = ordersTab;
      _selectedIndex = index;
      _selectedCategory = category;
    });
    if (index == 0) _loadDrugstores();
  }

  Future<void> _loadDrugstores() async {
    final request = ++_drugstoreRequest;
    setState(() {
      _loadingDrugstores = true;
      _drugstoreLoadFailed = false;
    });
    try {
      final stores = await context.read<PharmacyViewModel>().listStores();
      if (!mounted || request != _drugstoreRequest) return;
      setState(() {
        _drugstores = stores;
        _loadingDrugstores = false;
      });
    } catch (_) {
      if (!mounted || request != _drugstoreRequest) return;
      setState(() {
        _loadingDrugstores = false;
        _drugstoreLoadFailed = true;
      });
    }
  }

  void _openAssistant() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const AssistantScreen()),
    );
  }

  bool _cartHasItems(BuildContext context) {
    try {
      return context.watch<CartViewModel>().items.isNotEmpty;
    } on ProviderNotFoundException {
      return false;
    }
  }

  Widget _pharmacyCards() {
    final theme = Theme.of(context);
    final stores = _visibleDrugstores();
    return SizedBox(
      height: 132 + MediaQuery.textScalerOf(context).scale(48),
      child: ListView.separated(
        clipBehavior: Clip.none,
        scrollDirection: Axis.horizontal,
        itemCount: stores.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final store = stores[index];
          final isOpen = store.openNow == true;
          final km = store.distanceKm;
          return SizedBox(
            width: 208,
            child: Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => Navigator.of(context).pushNamed(
                  StoreDetailScreen.routeName,
                  arguments: store.id.toString(),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const IconTile(
                            icon: Icons.local_pharmacy_outlined,
                            size: 44,
                          ),
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (km != null)
                                StatusPill(
                                  label: '${km.toStringAsFixed(1)} km',
                                  color: NpColors.muted,
                                  background: const Color(0xFFF1F5F9),
                                ),
                              FavouriteHeart(
                                storeId: store.id,
                                name: store.name,
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        store.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        store.address,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium,
                      ),
                      const Spacer(),
                      StatusPill(
                        label: isOpen ? 'OPEN' : 'CLOSED',
                        dot: true,
                        color: isOpen ? NpColors.primary : NpColors.danger,
                        background: isOpen
                            ? NpColors.primarySoft
                            : NpColors.dangerSoft,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _pharmacyFilters() {
    final signedIn = _maybeWatch<FavouritesViewModel>()?.signedIn ?? false;
    return Wrap(
      spacing: 8,
      children: [
        FilterChip(
          label: const Text('Open now'),
          selected: _openOnly,
          onSelected: (value) => setState(() => _openOnly = value),
        ),
        if (signedIn)
          FilterChip(
            label: const Text('Favourites'),
            selected: _favouritesOnly,
            onSelected: (value) => setState(() => _favouritesOnly = value),
          ),
      ],
    );
  }

  Widget _buildHomeContent() {
    return SafeArea(
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PageHeader(
              title: 'NearPill',
              actions: [
                PillButton(
                  onPressed: _openAssistant,
                  icon: Icons.chat_bubble_outline,
                  label: 'Ask NearPill',
                ),
              ],
            ),
            const SizedBox(height: 8),
            Card(
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                minTileHeight: 76,
                leading: const IconTile(icon: Icons.place_rounded),
                title: const Text(
                  'Cebu City, Philippines',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                subtitle: const Text('Use current location'),
                trailing: const Icon(
                  Icons.chevron_right,
                  color: NpColors.faint,
                ),
                onTap: () => _onItemTapped(2),
              ),
            ),
            const SizedBox(height: 28),
            OverflowBar(
              alignment: MainAxisAlignment.spaceBetween,
              spacing: 8,
              children: [
                Text(
                  'Nearby Drugstores',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                TextButton(
                  onPressed: () => _onItemTapped(2),
                  child: const Text('See all pharmacies'),
                ),
              ],
            ),
            if (_loadingDrugstores && _drugstores.isEmpty)
              const LinearProgressIndicator(
                semanticsLabel: 'Loading pharmacies',
              )
            else if (_drugstoreLoadFailed) ...[
              Semantics(
                liveRegion: true,
                child: const Text(
                  'Unable to load the latest pharmacy information.',
                ),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _loadDrugstores,
                  child: const Text('Try again'),
                ),
              ),
            ] else if (_drugstores.isEmpty)
              const Text('No pharmacies are listed yet.'),
            if (_drugstores.isNotEmpty) _pharmacyFilters(),
            if (_drugstores.isNotEmpty && _visibleDrugstores().isEmpty)
              Semantics(
                liveRegion: true,
                child: Text(
                  _favouritesOnly && _openOnly
                      ? 'None of your favourite pharmacies are open right now.'
                      : _favouritesOnly
                      ? 'You have no favourite pharmacies yet. Tap the heart on a pharmacy to add one.'
                      : 'No pharmacies are open right now.',
                ),
              )
            else if (_drugstores.isNotEmpty)
              _pharmacyCards(),
            const SizedBox(height: 24),
            Text('Categories', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 16),
            Column(
              children: CatalogCategory.values.map((category) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Card(
                    clipBehavior: Clip.antiAlias,
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      leading: IconTile(
                        icon: switch (category) {
                          CatalogCategory.nonPrescription =>
                            Icons.medical_services_outlined,
                          CatalogCategory.prescription =>
                            Icons.assignment_outlined,
                          CatalogCategory.nonMedicine =>
                            Icons.shopping_bag_outlined,
                        },
                      ),
                      title: Text(
                        category.label,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                      subtitle: Text(switch (category) {
                        CatalogCategory.nonPrescription =>
                          'OTC remedies, vitamins, supplements',
                        CatalogCategory.prescription =>
                          "Upload doctor's prescription",
                        CatalogCategory.nonMedicine =>
                          'Personal care, hygiene & supplies',
                      }),
                      trailing: const Icon(
                        Icons.chevron_right,
                        color: NpColors.faint,
                      ),
                      onTap: () => _onItemTapped(1, category: category),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      _buildHomeContent(),
      SearchScreen(
        category: _selectedCategory,
        onClearCategory: () => _onItemTapped(1),
        onSelectCategory: (c) => _onItemTapped(1, category: c),
      ),
      const MapScreen(),
      OrdersScreen(
        key: ValueKey('orders-$_ordersTab'),
        initialTab: _ordersTab,
        onBrowseProducts: () => _onItemTapped(1),
      ),
      ProfileScreen(
        onLogout: widget.onLogout,
        onOpenAssistant: _openAssistant,
        onOpenOrders: () => _onItemTapped(3, ordersTab: 1),
      ),
    ];

    return Scaffold(
      appBar: null,
      body: _selectedIndex == 0
          ? RefreshIndicator(onRefresh: _loadDrugstores, child: pages[0])
          : pages[_selectedIndex],
      bottomNavigationBar: BttmNaviBar(
        ordersBadge: _cartHasItems(context),
        profileBadge: _unreadUpdates(context) > 0,
        currentIndex: _selectedIndex,
        onTap: _onItemTapped,
      ),
    );
  }
}
