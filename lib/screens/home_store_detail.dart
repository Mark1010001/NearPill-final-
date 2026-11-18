import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:shimmer/shimmer.dart';

import '../features/pharmacy/presentation/pharmacy_view_model.dart';
import '../features/cart/presentation/cart_view_model.dart';
import '../widgets/favourite_heart.dart';
import '../models/medicine_model.dart';

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

  Future<void> _launchPhone(String phone) async {
    final uri = Uri(scheme: 'tel', path: phone.replaceAll(' ', ''));
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
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
    final hours = _storeMeta?['operating_hours'] ?? '';
    final phone = _storeMeta?['phone'] ?? 'N/A';
    final fb = _storeMeta?['facebook'] ?? 'N/A';
    final distance = _storeMeta?['distance'] ?? '';

    return Scaffold(
      appBar: AppBar(
        title: Text('$storeName ${branch.isNotEmpty ? '– $branch' : ''}'),
        actions: [
          if ((int.tryParse(_storeId) ?? 0) > 0)
            FavouriteHeart(
              storeId: int.parse(_storeId),
              name: '$storeName${branch.isNotEmpty ? ' — $branch' : ''}',
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Name + open status read as one unit instead of two
                  // separate lines the eye has to reconnect.
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          '$storeName${branch.isNotEmpty ? ' — $branch' : ''}',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: openNow == true
                              ? Colors.green.shade100
                              : Colors.grey.shade200,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          openNow == null
                              ? 'Hours not confirmed'
                              : openNow == true
                              ? 'Open now'
                              : 'Closed',
                          style: TextStyle(
                            color: openNow == true
                                ? Colors.green.shade700
                                : Colors.grey.shade700,
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),

                  // Distance and hours merged into one chunk (Miller's
                  // Law) instead of two rows fighting for attention.
                  Text(
                    [
                      if (distance.toString().isNotEmpty) distance.toString(),
                      if (hours.toString().isNotEmpty)
                        'Hours ${hours.toString()}',
                    ].join('  ·  '),
                    style: const TextStyle(color: Colors.grey, fontSize: 13),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 12),

                  // Contact becomes two tappable actions instead of a
                  // card of text to read: fewer things to parse (Hick's
                  // Law), bigger targets side by side (Fitts's Law).
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: phone == 'N/A'
                              ? null
                              : () => _launchPhone(phone.toString()),
                          icon: const Icon(Icons.call, size: 18),
                          label: const Text('Call'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(44),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: fb == 'N/A'
                              ? null
                              : () => _launchUrl(fb.toString()),
                          icon: const Icon(Icons.facebook, size: 18),
                          label: const Text('Message'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(44),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),

                  TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      labelText: 'Search in this store',
                      prefixIcon: const Icon(Icons.search),
                      contentPadding: const EdgeInsets.symmetric(vertical: 14),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onChanged: _onSearchChanged,
                  ),
                ],
              ),
            ),

            // Categories bar. Chips get uniform 44px height and generous
            // horizontal padding so each one is easy to hit without
            // clipping a neighbor (Fitts's Law), and the list stays short
            // enough to scan in one glance (Hick's Law).
            SizedBox(
              height: 44,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                scrollDirection: Axis.horizontal,
                itemCount: _categories.length,
                separatorBuilder: (context, index) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final category = _categories[i];
                  final selected = category == _selectedCategory;
                  return ChoiceChip(
                    label: Text(category?.label ?? 'All'),
                    selected: selected,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onSelected: (_) {
                      _debounce?.cancel();
                      _selectedCategory = category;
                      _fetchInventory();
                    },
                    selectedColor: const Color(0xFF2E7D32),
                    backgroundColor: Colors.white,
                    labelStyle: TextStyle(
                      color: selected ? Colors.white : Colors.black87,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    ),
                  );
                },
              ),
            ),

            const SizedBox(height: 8),

            // Inventory list
            Expanded(
              child: _isLoading
                  ? ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: 5,
                      separatorBuilder: (context, index) =>
                          const SizedBox(height: 12),
                      itemBuilder: (context, index) => Shimmer.fromColors(
                        baseColor: Colors.grey[300]!,
                        highlightColor: Colors.grey[100]!,
                        child: Container(
                          height: 120,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
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
                      padding: const EdgeInsets.all(12),
                      itemCount: _inventory.length,
                      separatorBuilder: (context, index) =>
                          const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final item = _inventory[index] as Map<String, dynamic>;
                        final medicine = MedicineModel.fromJson(item);
                        final id = item['id']?.toString() ?? index.toString();
                        final qty = (_quantities[id] ?? 1).clamp(
                          1,
                          medicine.cartQuantityLimit,
                        );

                        return Card(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: Icon(
                                    Icons.medication,
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.primary,
                                  ),
                                  title: Text(
                                    medicine.name,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  subtitle: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        CatalogCategory.fromCatalogValue(
                                              medicine.category,
                                            )?.label ??
                                            medicine.category,
                                      ),
                                      Text(medicine.listingStatus),
                                    ],
                                  ),
                                ),
                                OverflowBar(
                                  spacing: 8,
                                  overflowSpacing: 8,
                                  alignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text(
                                      medicine.pricePerUnit,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    Wrap(
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        IconButton(
                                          tooltip:
                                              'Decrease quantity for ${medicine.name}',
                                          onPressed: qty > 1
                                              ? () =>
                                                    _changeQuantity(id, qty - 1)
                                              : null,
                                          icon: const Icon(Icons.remove),
                                        ),
                                        Text(
                                          '$qty',
                                          semanticsLabel: 'Quantity $qty',
                                        ),
                                        IconButton(
                                          tooltip:
                                              'Increase quantity for ${medicine.name}',
                                          onPressed:
                                              qty < medicine.cartQuantityLimit
                                              ? () =>
                                                    _changeQuantity(id, qty + 1)
                                              : null,
                                          icon: const Icon(Icons.add),
                                        ),
                                      ],
                                    ),
                                    FilledButton.icon(
                                      onPressed: () => _addToCart(item, qty),
                                      icon: const Icon(
                                        Icons.add_shopping_cart,
                                        size: 18,
                                      ),
                                      label: const Text('Add to cart'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
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
