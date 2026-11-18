import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

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
  });

  static const routeName = '/search';

  final CatalogCategory? category;
  final VoidCallback? onClearCategory;
  final ValueChanged<CatalogCategory>? onSelectCategory;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  bool _isLoadingMedicines = true;
  String? _medicineError;
  final TextEditingController _searchController = TextEditingController();
  List<MedicineModel> _medicines = [];
  String? _locationNote;

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

  Widget _filterChip(String label, bool selected, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => onTap(),
        labelStyle: TextStyle(
          fontWeight: FontWeight.w700,
          color: selected ? Colors.white : NpColors.ink,
        ),
      ),
    );
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
    return SafeArea(
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
                          icon: const Icon(Icons.close),
                        ),
                      IconButton(
                        tooltip: 'Refresh products',
                        onPressed: _isLoadingMedicines ? null : _loadMedicines,
                        icon: const Icon(Icons.refresh),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  TextField(
                    controller: _searchController,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      hintText: 'Search products, brands, or symptoms',
                      prefixIcon: const Icon(
                        Icons.search_rounded,
                        color: NpColors.faint,
                      ),
                      suffixIcon: query.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              onPressed: _searchController.clear,
                              icon: const Icon(
                                Icons.close_rounded,
                                color: NpColors.faint,
                              ),
                            ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 40,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        _filterChip('All Items', category == null, () {
                          widget.onClearCategory?.call();
                        }),
                        for (final c in CatalogCategory.values)
                          _filterChip(
                            c.label,
                            category == c,
                            () => widget.onSelectCategory?.call(c),
                          ),
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
              SliverList.builder(
                itemCount: products.length,
                itemBuilder: (context, index) {
                  final medicine = products[index];
                  final listingLabel = medicine.listingStatus == 'Available' && !medicine.canOrder
                      ? 'Not available right now'
                      : medicine.listingStatus;
                  final available = listingLabel == 'Available';
                  void open() => Navigator.of(context).pushNamed(
                    MedicineDetailScreen.routeName,
                    arguments: medicine,
                  );
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Card(
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: open,
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const IconTile(
                                    icon: Icons.add_rounded,
                                    size: 56,
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          medicine.name,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: Theme.of(
                                            context,
                                          ).textTheme.titleSmall,
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          medicine.hasDistance
                                              ? '${medicine.drugstoreName} · ${medicine.distance}'
                                              : medicine.drugstoreName,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        const SizedBox(height: 8),
                                        Wrap(
                                          spacing: 8,
                                          runSpacing: 4,
                                          crossAxisAlignment:
                                              WrapCrossAlignment.center,
                                          children: [
                                            StatusPill(
                                              label: listingLabel,
                                              dot: true,
                                              color: available
                                                  ? NpColors.primary
                                                  : NpColors.warning,
                                              background: available
                                                  ? NpColors.primarySoft
                                                  : NpColors.warningSoft,
                                            ),
                                            if (medicine.stockCount > 0)
                                              Text(
                                                '${medicine.stockCount} listed in stock',
                                              ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              const Padding(
                                padding: EdgeInsets.symmetric(vertical: 12),
                                child: Divider(),
                              ),
                              Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        const Text(
                                          'UNIT PRICE',
                                          style: TextStyle(
                                            fontSize: 11,
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: 0.8,
                                            color: NpColors.faint,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          medicine.pricePerUnit,
                                          style: const TextStyle(
                                            fontSize: 17,
                                            fontWeight: FontWeight.w800,
                                            color: NpColors.ink,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: open,
                                    icon: const Icon(Icons.add, size: 18),
                                    label: const Text('Add'),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: NpColors.primary,
                                      backgroundColor: NpColors.primarySoft,
                                      side: const BorderSide(
                                        color: NpColors.primaryBorder,
                                      ),
                                      shape: const StadiumBorder(),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
          ],
        ),
      ),
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
            const Icon(
              Icons.location_off_outlined,
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
