import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';

import '../app_theme.dart';
import '../models/medicine_model.dart';

/// Shared catalog look used by the pharmacy page and the Search tab: soft search field, filter chips,
/// product cards and the cart bar.
InputDecoration catalogSearchDecoration({required String hint, Widget? suffix}) => InputDecoration(
  hintText: hint,
  hintStyle: const TextStyle(color: NpColors.muted),
  prefixIcon: const Padding(
    padding: EdgeInsets.symmetric(horizontal: 14),
    child: NpIcon(NpIcons.search, size: 20, color: NpColors.muted),
  ),
  prefixIconConstraints: const BoxConstraints(minWidth: 48, minHeight: 48),
  suffixIcon: suffix,
  filled: true,
  fillColor: const Color(0xFFEFF3F1),
  contentPadding: const EdgeInsets.symmetric(vertical: 14),
  border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
  focusedBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(16),
    borderSide: const BorderSide(color: NpColors.primary, width: 1.5),
  ),
);

/// Filter pill: solid green with a check when selected, white with a hairline otherwise.
class CatalogFilterChip extends StatelessWidget {
  const CatalogFilterChip({super.key, required this.label, required this.selected, required this.onSelected});
  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => Center(
    child: ChoiceChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      avatar: selected ? const NpIcon(NpIcons.check, size: 16, color: Colors.white) : null,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      shape: StadiumBorder(side: BorderSide(color: selected ? NpColors.primary : NpColors.line)),
      onSelected: (_) => onSelected(),
      selectedColor: NpColors.primary,
      backgroundColor: Colors.white,
      labelStyle: TextStyle(
        fontSize: 13,
        color: selected ? Colors.white : NpColors.ink,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

/// "Open now" / "Closed" / "Hours not confirmed" pill beside the pharmacy name.
class StoreStatusPill extends StatelessWidget {
  const StoreStatusPill({super.key, required this.openNow});
  final Object? openNow;

  @override
  Widget build(BuildContext context) {
    final open = openNow == true;
    final fg = open ? NpColors.primaryDark : NpColors.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: open ? NpColors.primarySoft : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: open ? NpColors.primaryBorder : NpColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: open ? NpColors.primary : NpColors.faint, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            openNow == null ? 'Hours not confirmed' : open ? 'Open now' : 'Closed',
            style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

/// One catalog item: tinted icon tile (the Rx mark for prescriptions), category + stock, name, price,
/// then the quantity stepper and Add to cart.
class CatalogProductCard extends StatelessWidget {
  const CatalogProductCard({
    super.key,
    required this.medicine,
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
    required this.onAdd,
    this.subtitle,
    this.onOpen,
    this.showAvailability = false,
  });

  /// Pharmacy name and distance, shown under the name on the Search tab.
  final String? subtitle;

  /// Opens the product page when the top of the card is tapped.
  final VoidCallback? onOpen;

  /// Search tab: show "Not available right now" for listings that cannot be ordered yet.
  final bool showAvailability;

  final MedicineModel medicine;
  final int quantity;
  final VoidCallback? onDecrease;
  final VoidCallback? onIncrease;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final category = CatalogCategory.fromCatalogValue(medicine.category);
    final rx = category == CatalogCategory.prescription;
    final (String label, Color labelColor) = switch (category) {
      CatalogCategory.prescription => ('Prescription', const Color(0xFFC62828)),
      CatalogCategory.nonPrescription => ('Non-Prescription', NpColors.primary),
      _ => (category?.label ?? medicine.category, NpColors.muted),
    };
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: NpColors.line),
        boxShadow: const [BoxShadow(color: Color(0x0A0F172A), blurRadius: 10, offset: Offset(0, 2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: onOpen,
            borderRadius: BorderRadius.circular(12),
            child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _tile(category, rx),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: labelColor)),
                        _stockPill(),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      medicine.name,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, height: 1.25, color: NpColors.ink),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: NpColors.muted)),
                    ],
                    const SizedBox(height: 4),
                    Text.rich(
                      TextSpan(
                        text: medicine.price,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: NpColors.ink),
                        children: [
                          if (medicine.sellingUnit != null)
                            TextSpan(
                              text: ' / ${medicine.sellingUnit}',
                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: NpColors.muted),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 14),
            child: Divider(height: 1, color: NpColors.line),
          ),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F3),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: NpColors.line),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _stepButton(
                      tooltip: 'Decrease quantity for ${medicine.name}',
                      icon: NpIcons.remove,
                      onPressed: onDecrease,
                    ),
                    SizedBox(
                      width: 32,
                      child: Text(
                        '$quantity',
                        textAlign: TextAlign.center,
                        semanticsLabel: 'Quantity $quantity',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                      ),
                    ),
                    _stepButton(
                      tooltip: 'Increase quantity for ${medicine.name}',
                      icon: NpIcons.add,
                      onPressed: onIncrease,
                      accent: true,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton.icon(
                  onPressed: onAdd,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
                  icon: const NpIcon(NpIcons.shopping_bag_outlined, size: 18),
                  label: const Text('Add to cart'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stockPill() {
    final String text;
    final Color fg;
    final Color bg;
    final Color border;
    if (medicine.stockCount == 0) {
      (text, fg, bg, border) = ('Out of stock', const Color(0xFFB71C1C), const Color(0xFFFFEBEE), const Color(0xFFFFCDD2));
    } else if (showAvailability && !medicine.canOrder) {
      (text, fg, bg, border) = ('Not available right now', NpColors.warning, NpColors.warningSoft, const Color(0xFFFFE0A3));
    } else {
      (text, fg, bg, border) = ('Stock (${medicine.stockCount})', NpColors.primaryDark, NpColors.primarySoft, NpColors.primaryBorder);
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999), border: Border.all(color: border)),
      child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
    );
  }

  Widget _tile(CatalogCategory? category, bool rx) =>
      CatalogThumb(category: rx ? CatalogCategory.prescription : category, size: rx ? 80 : 44);

  Widget _stepButton({
    required String tooltip,
    required NpIconData icon,
    required VoidCallback? onPressed,
    bool accent = false,
  }) => IconButton(
    tooltip: tooltip,
    onPressed: onPressed,
    style: IconButton.styleFrom(
      backgroundColor: Colors.white,
      disabledBackgroundColor: Colors.white,
      foregroundColor: accent ? NpColors.primaryDark : NpColors.ink,
      fixedSize: const Size(40, 40),
      minimumSize: const Size(40, 40),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    icon: NpIcon(icon, size: 18),
  );
}

/// Bottom bar with the cart count, running total and View Cart.
class CatalogCartDock extends StatelessWidget {
  const CatalogCartDock({super.key, required this.count, required this.centavos, required this.onViewCart});
  final int count;
  final int centavos;
  final VoidCallback onViewCart;

  @override
  Widget build(BuildContext context) {
    final total = '₱${centavos ~/ 100}.${(centavos % 100).toString().padLeft(2, '0')}';
    return Material(
      color: Colors.white,
      elevation: 8,
      shadowColor: const Color(0x330F172A),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Row(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: NpColors.primarySoft,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: NpColors.primaryBorder),
                    ),
                    alignment: Alignment.center,
                    child: const NpIcon(NpIcons.shopping_bag_outlined, size: 22, color: NpColors.primaryDark),
                  ),
                  Positioned(
                    top: -6,
                    right: -6,
                    child: Container(
                      constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                      padding: const EdgeInsets.symmetric(horizontal: 5),
                      decoration: BoxDecoration(
                        color: NpColors.primary,
                        shape: count > 9 ? BoxShape.rectangle : BoxShape.circle,
                        borderRadius: count > 9 ? BorderRadius.circular(10) : null,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                      alignment: Alignment.center,
                      child: Text('$count', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(count == 1 ? '1 item in cart' : '$count items in cart',
                        style: const TextStyle(fontSize: 12, color: NpColors.muted, fontWeight: FontWeight.w500)),
                    const SizedBox(height: 2),
                    Text(total, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: NpColors.ink)),
                  ],
                ),
              ),
              FilledButton(
                onPressed: onViewCart,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  padding: const EdgeInsets.only(left: 20, right: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [Text('View Cart'), SizedBox(width: 4), NpIcon(NpIcons.chevron_right, size: 18)],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Thumbnail used wherever a medicine has no photo (catalog, cart, order lines).
/// A white tile: the Rx mark for prescription items, a pharmacy / box icon otherwise.
class CatalogThumb extends StatelessWidget {
  const CatalogThumb({super.key, required this.category, this.size = 52});

  final CatalogCategory? category;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (category == CatalogCategory.prescription) {
      return Container(
        width: size,
        height: size,
        padding: EdgeInsets.all(size * 0.14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(size * 0.28),
          border: Border.all(color: NpColors.line),
        ),
        child: Image.asset('assets/images/rx_mark.png', fit: BoxFit.contain, excludeFromSemantics: true),
      );
    }
    final medicine = category == CatalogCategory.nonPrescription;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: NpColors.line),
      ),
      alignment: Alignment.center,
      child: NpIcon(
        medicine ? NpIcons.local_pharmacy : NpIcons.box,
        size: size * 0.5,
        color: medicine ? NpColors.primary : NpColors.ink,
      ),
    );
  }
}
