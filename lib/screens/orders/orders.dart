import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/medicine_model.dart';
import '../../features/orders/pickup.dart';
import '../../models/order_model.dart';
import '../../features/auth/presentation/auth_view_model.dart';
import '../../features/cart/presentation/cart_view_model.dart';
import '../../features/orders/presentation/order_view_model.dart';
import '../../widgets/skeleton.dart';
import 'checkout.dart';
import 'confirmation.dart';
import 'prescription_review.dart';

String _cartPrice(int cents) =>
    '₱${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, this.onBrowseProducts, this.initialTab = 0});

  static const routeName = '/orders';

  final VoidCallback? onBrowseProducts;

  /// 0 = Cart, 1 = My Orders.
  final int initialTab;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  int _refreshKey = 0;

  void _onCheckoutComplete() {
    setState(() => _refreshKey++);
    _tabController.animateTo(1);
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(
      length: 2,
      vsync: this,
      initialIndex: widget.initialTab.clamp(0, 1),
    );
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartViewModel>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Orders'),
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(text: 'Cart (${cart.items.length})'),
            const Tab(text: 'My Orders'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _CartTab(
            cart: cart,
            onCheckoutComplete: _onCheckoutComplete,
            onBrowseProducts: widget.onBrowseProducts,
          ),
          _MyOrdersTab(
            key: ValueKey(_refreshKey),
            onReordered: () => _tabController.animateTo(0),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// CART TAB
// ---------------------------------------------------------------------------

class _CartTab extends StatelessWidget {
  const _CartTab({
    required this.cart,
    required this.onCheckoutComplete,
    required this.onBrowseProducts,
  });

  final CartViewModel cart;
  final VoidCallback onCheckoutComplete;
  final VoidCallback? onBrowseProducts;

  @override
  Widget build(BuildContext context) {
    final items = cart.items;

    if (items.isEmpty) {
      return ListView(
        children: [
          _EmptyState(
            icon: Icons.shopping_bag_outlined,
            title: 'Your cart is empty',
            subtitle: 'Browse products from local pharmacies to get started.',
            action: onBrowseProducts == null
                ? null
                : TextButton(
                    onPressed: onBrowseProducts,
                    child: const Text('Browse products'),
                  ),
          ),
        ],
      );
    }

    // Group items by pharmacy, mirroring how TikTok Shop groups a cart
    // by seller — it makes multi-store carts scannable at a glance.
    final Map<String, List<CartItem>> grouped = {};
    for (final item in items) {
      grouped.putIfAbsent(item.drugstoreId, () => []).add(item);
    }

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'Review pickup to check stock, prices, and GCash availability.',
              ),
              const SizedBox(height: 16),
              for (final entry in grouped.entries) ...[
                _StoreGroupHeader(
                  storeName: entry.value.first.drugstoreName,
                  subtotal: cart.subtotalForPharmacy(entry.key),
                  selected: cart.pharmacyFullySelected(entry.key),
                  onSelectedChanged: (value) =>
                      cart.setPharmacySelected(entry.key, value),
                ),
                const SizedBox(height: 10),
                for (final item in entry.value) ...[
                  _CartItemCard(
                    key: ValueKey((item.drugstoreId, item.id)),
                    item: item,
                  ),
                  const SizedBox(height: 12),
                ],
                const SizedBox(height: 8),
              ],
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: _CheckoutSummaryBar(
            cart: cart,
            onCheckoutComplete: onCheckoutComplete,
          ),
        ),
      ],
    );
  }
}

class _StoreGroupHeader extends StatelessWidget {
  const _StoreGroupHeader({
    required this.storeName,
    required this.subtotal,
    required this.selected,
    required this.onSelectedChanged,
  });

  final String storeName;
  final int subtotal;
  final bool selected;
  final ValueChanged<bool> onSelectedChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Checkbox(
          value: selected,
          visualDensity: VisualDensity.compact,
          onChanged: (value) => onSelectedChanged(value ?? false),
        ),
        const Icon(Icons.storefront, size: 18, color: Color(0xFF2E7D32)),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                storeName,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
              Text('Selected subtotal ${_cartPrice(subtotal)}'),
            ],
          ),
        ),
      ],
    );
  }
}

class _CartItemCard extends StatefulWidget {
  const _CartItemCard({super.key, required this.item});

  final CartItem item;

  @override
  State<_CartItemCard> createState() => _CartItemCardState();
}

class _CartItemCardState extends State<_CartItemCard> {
  Future<void> _updateQuantity(BuildContext context, int newQuantity) async {
    try {
      await context.read<CartViewModel>().updateQuantity(
        widget.item.id,
        widget.item.drugstoreId,
        newQuantity,
      );
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save the quantity change.')),
        );
      }
    }
  }

  Future<void> _removeItem(BuildContext context) async {
    try {
      await context.read<CartViewModel>().removeItem(
        widget.item.id,
        widget.item.drugstoreId,
      );
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save the item removal.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final category = CatalogCategory.fromCatalogValue(item.category);
    final pharmacyId = int.tryParse(item.drugstoreId);
    final medicineId = int.tryParse(item.id);
    final repository = category == CatalogCategory.prescription
        ? context.read<OrderViewModel?>()?.repository
        : null;
    final stock = item.reviewedStockCount;
    final atStockLimit = stock != null && item.quantity >= stock;

    return Dismissible(
      key: ValueKey((item.drugstoreId, item.id)),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) async {
        await _removeItem(context);
        return false;
      },
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 24),
        decoration: BoxDecoration(
          color: Colors.red.shade400,
          borderRadius: BorderRadius.circular(20),
        ),
        child: const Icon(Icons.delete_outline, color: Colors.white),
      ),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                label: 'Select ${item.name} for checkout',
                child: SizedBox(
                  width: 32,
                  child: Checkbox(
                    value: item.selected,
                    visualDensity: VisualDensity.compact,
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onChanged: (value) => context
                        .read<CartViewModel>()
                        .setSelected(item, value ?? false),
                  ),
                ),
              ),
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.medical_services,
                  color: Color(0xFF2E7D32),
                  size: 28,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(
                          tooltip: 'Remove ${item.name} from cart',
                          onPressed: () => _removeItem(context),
                          icon: Icon(
                            Icons.delete_outline,
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    if (category == CatalogCategory.prescription)
                      _RxPill(status: item.prescriptionStatus)
                    else
                      Text(switch (category) {
                        CatalogCategory.nonPrescription => 'Non-prescription',
                        CatalogCategory.nonMedicine => 'Non-medicine',
                        _ => 'Category unavailable',
                      }),
                    if (repository != null &&
                        pharmacyId != null &&
                        medicineId != null)
                      PrescriptionReview(
                        repository: repository,
                        pharmacy: pharmacyId,
                        medicine: medicineId,
                        pharmacyName: item.drugstoreName,
                        onStatus: (status) => context
                            .read<CartViewModel>()
                            .setPrescriptionStatus(item, status),
                      ),
                    Text(
                      item.pricePerUnit,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Colors.black54,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 12,
                      runSpacing: 8,
                      children: [
                        Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Colors.grey.shade300),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _QuantityControl(
                                icon: Icons.remove,
                                onTap: item.quantity > 1
                                    ? () => _updateQuantity(
                                        context,
                                        item.quantity - 1,
                                      )
                                    : null,
                              ),
                              SizedBox(
                                width: 36,
                                child: AnimatedSwitcher(
                                  duration: const Duration(milliseconds: 250),
                                  transitionBuilder: (child, animation) =>
                                      ScaleTransition(
                                        scale: animation,
                                        child: child,
                                      ),
                                  child: Text(
                                    item.quantity.toString(),
                                    textAlign: TextAlign.center,
                                    semanticsLabel: 'Quantity ${item.quantity}',
                                    key: ValueKey(item.quantity),
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ),
                              _QuantityControl(
                                icon: Icons.add,
                                onTap: atStockLimit
                                    ? null
                                    : () => _updateQuantity(
                                        context,
                                        item.quantity + 1,
                                      ),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            const Text(
                              'Item subtotal',
                              style: TextStyle(fontSize: 12, color: Colors.black54),
                            ),
                            Text(
                              _cartPrice(item.priceCentavos * item.quantity),
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    if (atStockLimit)
                      const Text('Stock limit reached at the last check.'),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RxPill extends StatelessWidget {
  const _RxPill({required this.status});

  final String? status;

  @override
  Widget build(BuildContext context) {
    final (String label, Color tone, Color soft) = switch (status) {
      'approved' => ('Prescription approved', const Color(0xFF1B5E20), const Color(0xFFE8F5E9)),
      'pending' => ('Under pharmacist review', const Color(0xFF0D47A1), const Color(0xFFE3F2FD)),
      'rejected' => ('Prescription rejected', const Color(0xFFB71C1C), const Color(0xFFFFEBEE)),
      _ => ('Prescription required', const Color(0xFF8D5A00), const Color(0xFFFFF3CD)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: soft,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: tone),
      ),
    );
  }
}

class _QuantityControl extends StatelessWidget {
  const _QuantityControl({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: icon == Icons.add ? 'Increase quantity' : 'Decrease quantity',
      onPressed: onTap,
      style: IconButton.styleFrom(minimumSize: const Size.square(44)),
      icon: Icon(icon, size: 20),
    );
  }
}

/// Sticky bottom summary + CTA. Kept persistent (rather than requiring a
/// full screen navigation to see the total) so the total price and the
/// primary action are always one tap away, reducing checkout friction.
class _CheckoutSummaryBar extends StatelessWidget {
  const _CheckoutSummaryBar({
    required this.cart,
    required this.onCheckoutComplete,
  });

  final CartViewModel cart;
  final VoidCallback onCheckoutComplete;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 20,
            offset: const Offset(0, -6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (cart.groupedCheckout)
            TextButton(
              onPressed: () async {
                try {
                  final user = await context.read<AuthViewModel>().getMe();
                  if (!context.mounted) return;
                  final groups = {
                    for (final item in cart.selectedItems)
                      item.drugstoreId: item.drugstoreName,
                  };
                  if (!user.xenditTestCheckout) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Grouped checkout is currently unavailable.',
                        ),
                      ),
                    );
                    return;
                  }
                  final pharmacyId = await showModalBottomSheet<String>(
                    context: context,
                    builder: (sheet) => SafeArea(
                      child: ListView(
                        shrinkWrap: true,
                        children: [
                          const ListTile(
                            title: Text(
                              'Review and pay for each pharmacy separately',
                            ),
                            subtitle: Text(
                              'Each pharmacy needs a subtotal of at least ₱100.',
                            ),
                          ),
                          for (final entry in groups.entries)
                            ListTile(
                              title: Text(entry.value),
                              subtitle: Text(
                                'Estimated subtotal ${_cartPrice(cart.itemsForPharmacy(entry.key).fold<int>(0, (sum, item) => sum + item.priceCentavos * item.quantity))}',
                              ),
                              onTap: () => Navigator.pop(sheet, entry.key),
                            ),
                        ],
                      ),
                    ),
                  );
                  if (!context.mounted || pharmacyId == null) return;
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          CheckoutFlowScreen(pharmacyId: pharmacyId),
                    ),
                  );
                  if (context.mounted && cart.items.isEmpty) {
                    onCheckoutComplete();
                  }
                } catch (_) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Could not check payment options. Try again.',
                        ),
                      ),
                    );
                  }
                }
              },
              child: const Text('Review pickups by pharmacy'),
            ),
          if (!cart.groupedCheckout && cart.checkoutBlockReason != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                cart.checkoutBlockReason!,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          OverflowBar(
            alignment: MainAxisAlignment.spaceBetween,
            spacing: 12,
            overflowSpacing: 8,
            children: [
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${cart.selectedItems.length} of ${cart.items.length} selected',
                    style: const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                  const Text('Estimated cart total'),
                  Text(
                    cart.totalPrice,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              if (!cart.groupedCheckout)
                FilledButton(
                  onPressed:
                      cart.checkoutBlockReason != null ||
                          cart.prescriptionBlockLabel != null
                      ? null
                      : () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => const CheckoutFlowScreen(),
                            ),
                          );
                          if (context.mounted && cart.items.isEmpty) {
                            onCheckoutComplete();
                          }
                        },
                  child: Text(cart.prescriptionBlockLabel ?? 'Review checkout'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// MY ORDERS TAB
// ---------------------------------------------------------------------------

// Priority order: what needs the customer's attention first.
enum _OrderFilter { all, toPay, ready, toPickUp, completed, cancelled }

extension on _OrderFilter {
  String get label => switch (this) {
    _OrderFilter.all => 'All',
    _OrderFilter.toPay => 'To pay',
    _OrderFilter.toPickUp => 'To pick up',
    _OrderFilter.ready => 'Ready',
    _OrderFilter.completed => 'Completed',
    _OrderFilter.cancelled => 'Cancelled',
  };

  bool matches(OrderModel order) => switch (this) {
    _OrderFilter.all => true,
    _OrderFilter.toPay => order.toPay,
    _OrderFilter.toPickUp => order.toPickUp,
    _OrderFilter.ready => order.parsedStage == OrderStage.ready,
    _OrderFilter.completed => order.parsedStage == OrderStage.completed,
    _OrderFilter.cancelled => order.parsedStage == OrderStage.cancelled,
  };
}

/// Pickup line shown on order cards.
String pickupSummary(OrderModel order) {
  final text = pickupText(order.pickupDate, order.pickupWindow);
  if (text.isEmpty) return 'No pickup date';
  final flag = pickupFlag(order.pickupDate, order.isActive);
  final suffix = flag == 'today'
      ? ' · Today'
      : flag == 'missed'
      ? ' · Pickup date passed'
      : '';
  return 'Pick up $text$suffix';
}

class _MyOrdersTab extends StatefulWidget {
  const _MyOrdersTab({super.key, required this.onReordered});

  final VoidCallback onReordered;

  @override
  State<_MyOrdersTab> createState() => _MyOrdersTabState();
}

class _MyOrdersTabState extends State<_MyOrdersTab> {
  _OrderFilter _filter = _OrderFilter.all;
  bool _reordering = false;

  Future<void> _reorder(OrderModel order) async {
    if (_reordering) return;
    setState(() => _reordering = true);
    try {
      await context.read<CartViewModel>().addOrderItems(order);
      if (!mounted) return;
      widget.onReordered();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Order items added to cart.')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not add all order items. Check your cart.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _reordering = false);
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<OrderViewModel>().fetchOrders();
    });
  }

  List<OrderModel> _filterOrders(List<OrderModel> orders) =>
      orders.where(_filter.matches).toList();

  @override
  Widget build(BuildContext context) {
    final orderService = context.watch<OrderViewModel>();

    final orders = orderService.orders;
    if (orders.isEmpty) {
      if (orderService.isLoading) {
        return const SingleChildScrollView(
          physics: NeverScrollableScrollPhysics(),
          child: SkeletonList(semanticsLabel: 'Loading orders', itemHeight: 120),
        );
      }
      final failed = orderService.error != null;
      return RefreshIndicator(
        onRefresh: orderService.fetchOrders,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _EmptyState(
              icon: failed ? Icons.error_outline : Icons.receipt_long_outlined,
              title: failed ? 'Unable to load orders' : 'No orders yet',
              subtitle: failed
                  ? 'Check your connection and try again.'
                  : 'Your orders and pickup status will appear here.',
              action: failed
                  ? TextButton(
                      onPressed: orderService.fetchOrders,
                      child: const Text('Try again'),
                    )
                  : null,
            ),
          ],
        ),
      );
    }

    final filteredOrders = _filterOrders(orders);

    return RefreshIndicator(
      onRefresh: orderService.fetchOrders,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        children: [
          // Status tabs, like any e-commerce "My orders" page.
          Container(
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: Color(0xFFE3EAE7))),
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final filter in _OrderFilter.values)
                    _StatusTab(
                      label:
                          '${filter.label} (${orders.where(filter.matches).length})',
                      selected: filter == _filter,
                      onTap: () => setState(() => _filter = filter),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (filteredOrders.isEmpty)
            const _EmptyState(
              icon: Icons.receipt_long_outlined,
              title: 'No orders here',
              subtitle: 'Orders with this status will appear here.',
            ),
          for (final order in filteredOrders) ...[
            _OrderCard(
              order: order,
              onReorder:
                  (order.isPast) && !_reordering && order.items.isNotEmpty
                  ? () => _reorder(order)
                  : null,
            ),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }
}

class _StatusTab extends StatelessWidget {
  const _StatusTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? const Color(0xFF1B5E20) : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected
                  ? const Color(0xFF1B5E20)
                  : const Color(0xFF526071),
            ),
          ),
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order, this.onReorder});

  final OrderModel order;
  final VoidCallback? onReorder;

  Future<void> _openDetail(BuildContext context) async {
    final accountId = context.read<OrderViewModel>().accountId;
    var depositEnabled = false;
    var customerName = '';
    String? customerPhone;
    final testActive = order.reference.startsWith('NP-TEST-') && order.isActive;
    if (testActive || order.hasReceipt) {
      try {
        final me = await context.read<AuthViewModel>().getMe();
        customerName = me.fullName;
        customerPhone = me.phone;
        if (testActive) depositEnabled = me.xenditTestDeposit;
      } catch (_) {}
    }
    if (!context.mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OrderConfirmationScreen(
          reference: order.reference,
          orderId: order.id,
          totalCentavos: order.totalCentavos,
          depositEnabled: depositEnabled,
          accountId: accountId,
          storeName: order.storeName,
          itemSummary: order.itemSummary,
          stage: order.parsedStage,
          status: order.stage,
          receiptItems: order.items,
          placedOn: order.placedOn,
          customerName: customerName,
          customerPhone: customerPhone,
          pickupDate: order.pickupDate,
          pickupWindow: order.pickupWindow,
          pickupRescheduled: order.pickupRescheduled,
        ),
      ),
    );
  }

  List<Widget> _itemRows() {
    final lines = order.items.whereType<Map>().take(2).toList();
    if (lines.isEmpty) {
      return [
        Text(
          order.itemSummary,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            height: 1.3,
            color: Color(0xFF0F172A),
          ),
        ),
      ];
    }
    final more = order.items.length - lines.length;
    return [
      for (final raw in lines)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F3),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.medication_outlined,
                  size: 22,
                  color: Color(0xFF526071),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      raw['name']?.toString() ?? 'Medicine',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        height: 1.3,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '× ${raw['quantity']}${(raw['sellingUnit']?.toString() ?? '').isNotEmpty ? ' (${raw['sellingUnit']})' : ''}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF526071),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(
                _cartPrice(
                  (int.tryParse('${raw['priceCentavos']}') ?? 0) *
                      (int.tryParse('${raw['quantity']}') ?? 0),
                ),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ),
      if (more > 0)
        Text(
          '+$more more item${more == 1 ? '' : 's'}',
          style: const TextStyle(fontSize: 13, color: Color(0xFF526071)),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final orderStage = order.parsedStage;
    const hairline = Color(0xFFE3EAE7);
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: hairline),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F0F172A),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(19),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => _openDetail(context),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OverflowBar(
                  alignment: MainAxisAlignment.spaceBetween,
                  spacing: 8,
                  overflowSpacing: 8,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.storefront_outlined,
                          size: 22,
                          color: Color(0xFF526071),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            order.storeName,
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF0F172A),
                            ),
                          ),
                        ),
                      ],
                    ),
                    _StatusChip(stage: orderStage),
                  ],
                ),
                const Divider(height: 24, thickness: 1, color: hairline),
                ..._itemRows(),
                const SizedBox(height: 4),
                Text(
                  order.toPay
                      ? order.placedOn
                      : '${order.reference} · ${order.placedOn}',
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    color: Color(0xFF526071),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  pickupSummary(order),
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    color: Color(0xFF1B5E20),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Divider(height: 24, thickness: 1, color: hairline),
                OverflowBar(
                  alignment: MainAxisAlignment.spaceBetween,
                  spacing: 8,
                  overflowSpacing: 12,
                  children: [
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${order.itemCount} item${order.itemCount == 1 ? '' : 's'} · Order total',
                          style: const TextStyle(
                            fontSize: 13,
                            color: Color(0xFF526071),
                          ),
                        ),
                        Text(
                          order.totalCentavos != null
                              ? _cartPrice(order.totalCentavos!)
                              : order.total,
                          style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF0F172A),
                        letterSpacing: -0.2,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                        ),
                      ],
                    ),
                    _OrderCardActions(
                      order: order,
                      orderStage: orderStage,
                      onTrack: () => _openDetail(context),
                      onReorder: onReorder,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The action row is the other piece TikTok Shop-style order tabs get
/// right that a generic list doesn't: the button changes with the
/// order's actual state instead of always saying "Track order".
class _OrderCardActions extends StatelessWidget {
  const _OrderCardActions({
    required this.order,
    required this.orderStage,
    required this.onTrack,
    required this.onReorder,
  });

  final OrderModel order;
  final OrderStage orderStage;
  final VoidCallback onTrack;
  final VoidCallback? onReorder;

  @override
  Widget build(BuildContext context) {
    if (order.toPay) return _PrimaryPill(label: 'Pay now', onTap: onTrack);
    if (order.hasReceipt &&
        (orderStage == OrderStage.preparing ||
            order.stage.toLowerCase() == 'confirmed')) {
      return _PrimaryPill(label: 'View receipt', onTap: onTrack);
    }
    return switch (orderStage) {
      OrderStage.placed || OrderStage.preparing => _PrimaryPill(
        label: 'View status',
        onTap: onTrack,
      ),
      OrderStage.ready => _PrimaryPill(
        label: 'View pickup details',
        onTap: onTrack,
      ),
      OrderStage.completed => _PrimaryPill(
        label: 'Buy Again',
        onTap: onReorder,
      ),
      OrderStage.cancelled => _OutlinedPill(label: 'Reorder', onTap: onReorder),
    };
  }
}

class _PrimaryPill extends StatelessWidget {
  const _PrimaryPill({required this.label, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: onTap,
      style: FilledButton.styleFrom(
        backgroundColor: const Color(0xFF1B5E20),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        minimumSize: const Size(0, 48),
        tapTargetSize: MaterialTapTargetSize.padded,
        shape: const StadiumBorder(),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _OutlinedPill extends StatelessWidget {
  const _OutlinedPill({required this.label, required this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        minimumSize: const Size(0, 48),
        tapTargetSize: MaterialTapTargetSize.padded,
        shape: const StadiumBorder(),
        side: const BorderSide(color: Color(0xFF1B5E20)),
        foregroundColor: const Color(0xFF1B5E20),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.stage});

  final OrderStage stage;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (stage) {
      OrderStage.placed => ('Reserved', Colors.blueGrey.shade800),
      OrderStage.preparing => ('Preparing', Colors.orange.shade900),
      OrderStage.ready => ('Ready for Pickup', const Color(0xFF2E7D32)),
      OrderStage.completed => ('Completed', Colors.blue.shade800),
      OrderStage.cancelled => ('Cancelled', Colors.red.shade800),
    };

    return Text(
      label,
      style: TextStyle(
        color: color,
        fontWeight: FontWeight.w700,
        fontSize: 13,
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.action,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            Semantics(
              liveRegion: true,
              child: Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            ?action,
          ],
        ),
      ),
    );
  }
}
