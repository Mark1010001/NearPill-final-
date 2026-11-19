import 'dart:async';
import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';
import 'package:shimmer/shimmer.dart';

import '../features/pharmacy/presentation/pharmacy_view_model.dart';
import '../features/cart/presentation/cart_view_model.dart';
import '../widgets/favourite_heart.dart';
import '../app_theme.dart';
import '../models/medicine_model.dart';
import '../widgets/catalog_cards.dart';
import 'orders/orders.dart';

class StoreDetailScreen extends StatefulWidget {
  const StoreDetailScreen({super.key, this.viewModel});

  final PharmacyViewModel? viewModel;

  static const routeName = '/store-detail';

  @override
  State<StoreDetailScreen> createState() => _StoreDetailScreenState();
}

class _StoreDetailScreenState extends State<StoreDetailScreen> {
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;

  // Coalesces rapid repeat taps on "Add" into one toast instead of
  // stacking a new SnackBar per tap.
  Timer? _addFeedbackDebounce;
  String? _addFeedbackItemId;
  int _addFeedbackTotalQty = 0;

  String? _loadError;
  int _inventoryRequest = 0;

  // UI state
  bool _isLoading = false;
  List<dynamic> _inventory = [];
  String _storeId = '';
  Map<String, dynamic>? _storeMeta;

  static const _categories = <CatalogCategory?>[
    null,
    ...CatalogCategory.values,
  ];
  CatalogCategory? _selectedCategory;

  // quantities tracked by item id
  final Map<String, int> _quantities = {};

  String _lastStoreId = '';

  @override
  void initState() {
    super.initState();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final args = ModalRoute.of(context)?.settings.arguments;
    final newStoreId = args is String && args.isNotEmpty ? args : '1';

    // Only fetch if store ID changed
    if (newStoreId != _lastStoreId) {
      _lastStoreId = newStoreId;
      _storeId = newStoreId;
      _selectedCategory = null;
      _quantities.clear();
      _searchController.clear();
      _fetchInventory();
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _addFeedbackDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _fetchInventory);
  }

  Future<void> _fetchInventory() async {
    final request = ++_inventoryRequest;
    final search = _searchController.text.trim().toLowerCase();
    final category = _selectedCategory;
    setState(() {
      _isLoading = true;
      _loadError = null;
    });
    try {
      final storeId = int.tryParse(_storeId);
      if (storeId == null || storeId <= 0) {
        throw const FormatException('Invalid pharmacy ID');
      }
      final viewModel = widget.viewModel ?? context.read<PharmacyViewModel>();
      final result = await viewModel.getStoreInventory(storeId);
      final inventory = result.inventory.where((item) {
        final matchesCategory =
            category == null ||
            CatalogCategory.fromCatalogValue(item['category']?.toString()) ==
                category;
        final matchesQuery =
            search.isEmpty ||
            '${item['name']} ${item['genericName']}'.toLowerCase().contains(
              search,
            );
        return matchesCategory && matchesQuery;
      }).toList();
      if (!mounted || request != _inventoryRequest) return;
      setState(() {
        _storeMeta = {
          'store_id': result.store.id,
          'store_name': result.store.name,
          'address': result.store.address,
          'openNow': result.store.openNow,
          'operating_hours': result.store.operatingHours,
          'distanceKm': result.store.distanceKm,
        };
        _inventory = inventory;
      });
    } catch (_) {
      if (!mounted || request != _inventoryRequest) return;
      setState(() {
        _inventory = [];
        _storeMeta = null;
        _loadError = 'Unable to load pharmacy details and stock. Please retry.';
      });
    } finally {
      if (mounted && request == _inventoryRequest) {
        setState(() => _isLoading = false);
      }
    }
  }

  void _changeQuantity(String id, int quantity) {
    setState(() => _quantities[id] = quantity);
  }

  Future<void> _addToCart(Map<String, dynamic> item, int quantity) async {
    final medicine = MedicineModel.fromJson(item);
    if (quantity <= 0 || quantity > medicine.cartQuantityLimit) {
      return;
    }

    final cartService = context.read<CartViewModel>();
    final id = item['id']?.toString() ?? '';
    final name = item['name']?.toString() ?? 'Unknown';
    final priceCentavos =
        int.tryParse(item['priceCentavos']?.toString() ?? '') ?? 0;
    final drugstoreName =
        _storeMeta?['store_name']?.toString() ??
        item['drugstoreName']?.toString() ??
        '';
    final drugstoreId = item['drugstoreId']?.toString() ?? _storeId;
    final category = item['category']?.toString() ?? '';

    try {
      await cartService.addItem(
        id: id,
        name: name,
        priceCentavos: priceCentavos,
        sellingUnit: medicine.sellingUnit,
        drugstoreName: drugstoreName,
        drugstoreId: drugstoreId,
        category: category,
        quantity: quantity,
      );
      if (mounted) {
        _queueAddedToCartFeedback(id: id, name: name, quantity: quantity);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not save this item to your cart.'),
          ),
        );
      }
    }
  }

  // Rapid-tapping "Add" used to fire one SnackBar per tap, so they piled
  // up faster than each could animate out and the message visibly
  // spammed. This coalesces every tap on the same item within a short
  // window into a single, updated toast instead:
  //  - Hick's Law: the user is choosing "add more" repeatedly, not
  //    making N distinct decisions, so they should see one updated
  //    result, not N separate confirmations to read.
  //  - Miller's Law: only one chunk of feedback is ever on screen, so
  //    there's nothing to queue up and mentally sort through.
  //  - Fitts's Law: clearing any pending SnackBar before showing the
  //    new one keeps the notification a single stationary target the
  //    eye can find in the same spot, instead of a shifting stack.
  void _queueAddedToCartFeedback({
    required String id,
    required String name,
    required int quantity,
  }) {
    if (_addFeedbackItemId == id) {
      _addFeedbackTotalQty += quantity;
    } else {
      _addFeedbackItemId = id;
      _addFeedbackTotalQty = quantity;
    }

    _addFeedbackDebounce?.cancel();
    _addFeedbackDebounce = Timer(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      messenger.clearSnackBars();
      messenger.showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 2),
          content: Text(
            _addFeedbackTotalQty > 1
                ? 'Added $_addFeedbackTotalQty $name to cart'
                : 'Added $name to cart',
          ),
        ),
      );
      _addFeedbackItemId = null;
      _addFeedbackTotalQty = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final storeName = _storeMeta?['store_name'] ?? 'Store';
    final branch = _storeMeta?['branch'] ?? '';
    final openNow = _storeMeta?['openNow'];
    final cart = context.watch<CartViewModel?>();
    final cartCount = cart?.items.fold<int>(0, (sum, line) => sum + line.quantity) ?? 0;
    final cartCentavos = cart?.items.fold<int>(0, (sum, line) => sum + line.priceCentavos * line.quantity) ?? 0;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        centerTitle: true,
        titleSpacing: 0,
        leadingWidth: 56,
        leading: Padding(
          padding: const EdgeInsets.only(left: 8),
          child: IconButton(
            tooltip: 'Back',
            onPressed: () => Navigator.maybePop(context),
            style: IconButton.styleFrom(
              fixedSize: const Size(40, 40),
              minimumSize: const Size(40, 40),
              foregroundColor: NpColors.ink,
            ),
            icon: const NpIcon(NpIcons.arrow_back),
          ),
        ),
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                '$storeName${branch.isNotEmpty ? ' – $branch' : ''}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: NpColors.ink,
                  letterSpacing: -0.3,
                ),
              ),
            ),
            const SizedBox(width: 8),
            StoreStatusPill(openNow: openNow),
          ],
        ),
        actions: [
          if ((int.tryParse(_storeId) ?? 0) > 0)
            FavouriteHeart(
              storeId: int.parse(_storeId),
              name: '$storeName${branch.isNotEmpty ? ' — $branch' : ''}',
            ),
          const SizedBox(width: 8),
        ],
      ),
      bottomNavigationBar: cartCount > 0
          ? CatalogCartDock(
              count: cartCount,
              centavos: cartCentavos,
              onViewCart: () => Navigator.pushNamed(context, OrdersScreen.routeName),
            )
          : null,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: TextField(
                controller: _searchController,
                textInputAction: TextInputAction.search,
                decoration: catalogSearchDecoration(hint: 'Search in this store'),
                onChanged: _onSearchChanged,
              ),
            ),

            // Category chips: the selected one is solid green with a check, the rest are white pills.
            SizedBox(
              height: 44,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: _categories.length,
                separatorBuilder: (context, index) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final category = _categories[i];
                  final selected = category == _selectedCategory;
                  return CatalogFilterChip(
                    label: category?.label ?? 'All',
                    selected: selected,
                    onSelected: () {
                      _debounce?.cancel();
                      _selectedCategory = category;
                      _fetchInventory();
                    },
                  );
                },
              ),
            ),

            const SizedBox(height: 8),

            // Inventory list
            Expanded(
              child: _isLoading
                  ? ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: 5,
                      separatorBuilder: (context, index) => const SizedBox(height: 14),
                      itemBuilder: (context, index) => Shimmer.fromColors(
                        baseColor: Colors.grey[300]!,
                        highlightColor: Colors.grey[100]!,
                        child: Container(
                          height: 150,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                      ),
                    )
                  : _inventory.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_loadError ?? 'No items found in this store.'),
                          if (_loadError != null)
                            TextButton(
                              onPressed: _fetchInventory,
                              child: const Text('Retry'),
                            ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                      itemCount: _inventory.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 14),
                      itemBuilder: (context, index) {
                        final item = _inventory[index] as Map<String, dynamic>;
                        final medicine = MedicineModel.fromJson(item);
                        final id = item['id']?.toString() ?? index.toString();
                        final qty = (_quantities[id] ?? 1).clamp(1, medicine.cartQuantityLimit);
                        return CatalogProductCard(
                          medicine: medicine,
                          quantity: qty,
                          onDecrease: qty > 1 ? () => _changeQuantity(id, qty - 1) : null,
                          onIncrease: qty < medicine.cartQuantityLimit
                              ? () => _changeQuantity(id, qty + 1)
                              : null,
                          onAdd: () => _addToCart(item, qty),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
