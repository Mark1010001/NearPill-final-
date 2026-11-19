import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';

import '../features/cart/presentation/cart_view_model.dart';
import '../widgets/catalog_cards.dart';
import 'orders/orders.dart';
import '../models/medicine_model.dart';
import '../features/catalog/presentation/catalog_view_model.dart';
import '../app_theme.dart';
import '../widgets/np_ui.dart';
import '../widgets/skeleton.dart';
import 'srch_medicine_detail.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({
    super.key,
    this.category,
    this.onClearCategory,
    this.onSelectCategory,
    this.onViewCart,
  });

  static const routeName = '/search';

  final CatalogCategory? category;
  final VoidCallback? onClearCategory;
  final ValueChanged<CatalogCategory>? onSelectCategory;

  /// Switches to the Orders tab (the cart). Falls back to opening the Orders route.
  final VoidCallback? onViewCart;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  bool _isLoadingMedicines = true;
  String? _medicineError;
  final TextEditingController _searchController = TextEditingController();
  List<MedicineModel> _medicines = [];
  String? _locationNote;
  final Map<String, int> _quantities = {};

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_onSearchChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadMedicines();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadMedicines() async {
    if (!mounted) return;
    setState(() {
      _isLoadingMedicines = true;
      _medicineError = null;
    });
    try {
      final medicines = await context
          .read<CatalogViewModel>()
          .fetchMedicineListings();

      if (!mounted) return;

      setState(() {
        _locationNote = context.read<CatalogViewModel>().locationNote;
        _medicines = medicines;
        _medicineError = null;
        _isLoadingMedicines = false;
      });
    } catch (_) {
      if (!mounted) return;

      setState(() {
        _medicineError = 'Unable to load products. Please try again.';
        _isLoadingMedicines = false;
      });
    }
  }

  void _onSearchChanged() => setState(() {});

  Future<void> _addToCart(MedicineModel medicine, int quantity) async {
    if (quantity <= 0 || quantity > medicine.cartQuantityLimit) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<CartViewModel>().addItem(
        id: medicine.id,
        name: medicine.name,
        priceCentavos: medicine.priceCentavos,
        sellingUnit: medicine.sellingUnit,
        drugstoreName: medicine.drugstoreName,
        drugstoreId: medicine.drugstoreId,
        category: medicine.category,
        quantity: quantity,
      );
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 2),
            content: Text(quantity > 1 ? 'Added $quantity ${medicine.name} to cart' : 'Added ${medicine.name} to cart'),
          ),
        );
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not save this item to your cart.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final query = _searchController.text.trim().toLowerCase();
    final category = widget.category;
    final products = _medicines.where((product) {
      return (category == null ||
              CatalogCategory.fromCatalogValue(product.category) == category) &&
          (product.name.toLowerCase().contains(query) ||
              product.drugstoreName.toLowerCase().contains(query));
    }).toList();
    final cart = context.watch<CartViewModel?>();
    final cartCount = cart?.items.fold<int>(0, (sum, line) => sum + line.quantity) ?? 0;
    final cartCentavos = cart?.items.fold<int>(0, (sum, line) => sum + line.priceCentavos * line.quantity) ?? 0;
    final list = SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: CustomScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          slivers: [
            SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PageHeader(
                    title: 'Search products',
                    actions: [
                      if (category != null && widget.onClearCategory != null)
                        IconButton(
                          tooltip: 'Clear category filter',
                          onPressed: widget.onClearCategory,
                          icon: const NpIcon(NpIcons.close),
                        ),
                      IconButton(
                        tooltip: 'Refresh products',
                        onPressed: _isLoadingMedicines ? null : _loadMedicines,
                        icon: const NpIcon(NpIcons.refresh),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  TextField(
                    controller: _searchController,
                    textInputAction: TextInputAction.search,
                    decoration: catalogSearchDecoration(
                      hint: 'Search products, brands, or symptoms',
                      suffix: query.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              onPressed: _searchController.clear,
                              icon: const NpIcon(NpIcons.close, color: NpColors.muted),
                            ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 44,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        CatalogFilterChip(
                          label: 'All Items',
                          selected: category == null,
                          onSelected: () => widget.onClearCategory?.call(),
                        ),
                        for (final c in CatalogCategory.values) ...[
                          const SizedBox(width: 8),
                          CatalogFilterChip(
                            label: c.label,
                            selected: category == c,
                            onSelected: () => widget.onSelectCategory?.call(c),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (!_isLoadingMedicines && _locationNote != null) ...[
                    const SizedBox(height: 12),
                    _LocationBanner(
                      message: _locationNote!,
                      onRetry: _loadMedicines,
                    ),
                  ],
                  const SizedBox(height: 16),
                ],
              ),
            ),
            if (_isLoadingMedicines)
              const SliverToBoxAdapter(
                child: SkeletonList(
                  semanticsLabel: 'Loading products',
                  itemHeight: 88,
                  count: 5,
                ),
              )
            else if (_medicineError case final message?)
              SliverToBoxAdapter(
                child: Column(
                  children: [
                    Semantics(
                      liveRegion: true,
                      child: Text(message, textAlign: TextAlign.center),
                    ),
                    TextButton(
                      onPressed: _loadMedicines,
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              )
            else if (products.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      query.isEmpty
                          ? category == null
                                ? 'No products found.'
                                : 'No products in this category.'
                          : 'No products match your search.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              )
            else
              SliverList.separated(
                itemCount: products.length,
                separatorBuilder: (context, index) => const SizedBox(height: 14),
                itemBuilder: (context, index) {
                  final medicine = products[index];
                  final key = '${medicine.drugstoreId}:${medicine.id}';
                  final qty = (_quantities[key] ?? 1).clamp(1, medicine.cartQuantityLimit);
                  return CatalogProductCard(
                    medicine: medicine,
                    quantity: qty,
                    showAvailability: true,
                    subtitle: medicine.hasDistance
                        ? '${medicine.drugstoreName} · ${medicine.distance}'
                        : medicine.drugstoreName,
                    onOpen: () => Navigator.of(context).pushNamed(
                      MedicineDetailScreen.routeName,
                      arguments: medicine,
                    ),
                    onDecrease: qty > 1 ? () => setState(() => _quantities[key] = qty - 1) : null,
                    onIncrease: qty < medicine.cartQuantityLimit ? () => setState(() => _quantities[key] = qty + 1) : null,
                    onAdd: () => _addToCart(medicine, qty),
                  );
                },
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 16)),
          ],
        ),
      ),
    );
    if (cartCount == 0) return list;
    return Column(
      children: [
        Expanded(child: list),
        CatalogCartDock(
          count: cartCount,
          centavos: cartCentavos,
          onViewCart: widget.onViewCart ?? () => Navigator.pushNamed(context, OrdersScreen.routeName),
        ),
      ],
    );
  }
}

class _LocationBanner extends StatelessWidget {
  const _LocationBanner({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: NpColors.warningSoft,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFFE0A3)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
        child: Row(
          children: [
            const NpIcon(
              NpIcons.location_off_outlined,
              color: NpColors.warning,
              size: 20,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(color: NpColors.warning, fontSize: 13),
              ),
            ),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
