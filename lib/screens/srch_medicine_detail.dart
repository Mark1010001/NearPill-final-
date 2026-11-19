import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';

import '../models/medicine_model.dart';
import '../widgets/skeleton.dart';
import '../features/cart/presentation/cart_view_model.dart';
import '../features/catalog/presentation/catalog_view_model.dart';

class MedicineDetailScreen extends StatefulWidget {
  const MedicineDetailScreen({super.key});

  static const routeName = '/medicine-detail';

  @override
  State<MedicineDetailScreen> createState() => _MedicineDetailScreenState();
}

class _MedicineDetailScreenState extends State<MedicineDetailScreen> {
  int _quantity = 1;
  Future<MedicineModel?>? _medicineFuture;

  // Coalesces rapid repeat taps of "Add to cart" into one toast instead
  // of stacking a SnackBar per tap.
  Timer? _addFeedbackDebounce;
  int _addFeedbackTotalQty = 0;

  @override
  void dispose() {
    _addFeedbackDebounce?.cancel();
    super.dispose();
  }

  void _updateQuantity(int newQuantity) {
    if (newQuantity < 1) return;
    setState(() {
      _quantity = newQuantity;
    });
  }

  // Same fix as the store detail and search screens: merges rapid
  // repeat taps of "Add to cart" into one toast instead of stacking a
  // SnackBar per tap.
  void _queueAddedToCartFeedback(int qty) {
    _addFeedbackTotalQty += qty;

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
            'Added $_addFeedbackTotalQty item${_addFeedbackTotalQty == 1 ? '' : 's'} to cart',
          ),
        ),
      );
      _addFeedbackTotalQty = 0;
    });
  }

  Widget _quantityPillButton({
    required NpIconData icon,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    return IconButton.outlined(
      tooltip: icon == NpIcons.add ? 'Increase quantity' : 'Decrease quantity',
      onPressed: enabled ? onTap : null,
      style: IconButton.styleFrom(
        minimumSize: const Size.square(48),
        foregroundColor: Theme.of(context).colorScheme.primary,
      ),
      icon: NpIcon(icon, size: 20),
    );
  }

  @override
  Widget build(BuildContext context) {
    final args = ModalRoute.of(context)?.settings.arguments;

    return FutureBuilder<MedicineModel?>(
      initialData: args is MedicineModel ? args : null,
      future: args is String
          ? (_medicineFuture ??= context
                .read<CatalogViewModel>()
                .fetchMedicineById(args))
          : null,
      builder: (context, snapshot) {
        final medicine = snapshot.data;

        if (medicine == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('Medicine Details')),
            body: snapshot.connectionState == ConnectionState.waiting
                ? const SingleChildScrollView(
                    physics: NeverScrollableScrollPhysics(),
                    child: SkeletonList(
                      semanticsLabel: 'Loading medicine',
                      count: 3,
                      itemHeight: 140,
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      Text(
                        snapshot.hasError
                            ? 'Unable to load medicine details.'
                            : 'Medicine not found.',
                        textAlign: TextAlign.center,
                      ),
                      if (snapshot.hasError)
                        Center(
                          child: TextButton(
                            onPressed: () =>
                                setState(() => _medicineFuture = null),
                            child: const Text('Try again'),
                          ),
                        ),
                    ],
                  ),
          );
        }

        final totalCentavos = medicine.priceCentavos * _quantity;
        final description = medicine.description
            ?.split(stagingTestApprovalMarker)
            .first
            .trim();
        final totalPrice =
            '${totalCentavos ~/ 100}.${(totalCentavos % 100).toString().padLeft(2, '0')}';

        return Scaffold(
          appBar: AppBar(
            title: const Text('Medicine Details'),
            elevation: 0,
            backgroundColor: Colors.white,
            foregroundColor: Colors.black87,
          ),
          backgroundColor: Colors.grey.shade100,
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withAlpha(13),
                          blurRadius: 20,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 54,
                              height: 54,
                              decoration: BoxDecoration(
                                color: Colors.green.shade50,
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: const NpIcon(
                                NpIcons.medical_services,
                                color: Color(0xFF2E7D32),
                                size: 30,
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    medicine.name,
                                    style: const TextStyle(
                                      fontSize: 22,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    medicine.drugstoreName,
                                    style: const TextStyle(
                                      color: Colors.grey,
                                      fontSize: 14,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.green.shade50,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Text(
                            medicine.listingStatus,
                            style: const TextStyle(
                              color: Color(0xFF2E7D32),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        Wrap(
                          spacing: 16,
                          runSpacing: 12,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Price',
                                  style: TextStyle(
                                    color: Colors.grey,
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  medicine.price,
                                  style: const TextStyle(
                                    fontSize: 28,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                if (medicine.sellingUnit case final unit?)
                                  Text('Per $unit'),
                                if (medicine.packageSize case final size?)
                                  Text('Supplier package $size'),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.green.shade50,
                                borderRadius: BorderRadius.circular(18),
                              ),
                              child: Wrap(
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  _quantityPillButton(
                                    icon: NpIcons.remove,
                                    enabled: _quantity > 1,
                                    onTap: () => _updateQuantity(_quantity - 1),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                    ),
                                    child: Text(
                                      '$_quantity',
                                      semanticsLabel: 'Quantity $_quantity',
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  _quantityPillButton(
                                    icon: NpIcons.add,
                                    enabled:
                                        _quantity < medicine.cartQuantityLimit,
                                    onTap: () => _updateQuantity(_quantity + 1),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        OverflowBar(
                          alignment: MainAxisAlignment.spaceBetween,
                          spacing: 12,
                          overflowSpacing: 6,
                          children: [
                            const Text(
                              'Total',
                              style: TextStyle(color: Colors.grey),
                            ),
                            Text(
                              '₱$totalPrice',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: () async {
                              final quantity = _quantity;
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
                                if (mounted) {
                                  _queueAddedToCartFeedback(quantity);
                                }
                              } catch (_) {
                                if (context.mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Could not save this item to your cart.',
                                      ),
                                    ),
                                  );
                                }
                              }
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF2E7D32),
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                            ),
                            child: Text(
                              'Add $_quantity to cart',
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withAlpha(10),
                          blurRadius: 18,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Description',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          description == null || description.isEmpty
                              ? 'No description provided.'
                              : description,
                          style: const TextStyle(
                            fontSize: 15,
                            color: Colors.grey,
                            height: 1.6,
                          ),
                        ),
                        const SizedBox(height: 20),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'ID',
                              style: TextStyle(color: Colors.grey),
                            ),
                            Text(
                              medicine.id,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
