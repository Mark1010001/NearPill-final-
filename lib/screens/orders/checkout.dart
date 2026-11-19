import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import '../../app_theme.dart';
import '../../config/service_notices.dart';
import 'package:provider/provider.dart';

import '../../features/auth/presentation/auth_view_model.dart';
import '../../features/cart/presentation/cart_view_model.dart';
import '../../features/orders/pickup.dart';
import '../../features/orders/presentation/order_view_model.dart';
import '../../features/pharmacy/presentation/pharmacy_view_model.dart';
import '../../models/medicine_model.dart';
import '../../models/order_model.dart';
import '../../models/user_model.dart';
import '../../widgets/contact_details_sheet.dart';
import '../../widgets/pickup_picker.dart';
import 'confirmation.dart';

/// Reviews the cart and pickup details before placing an order.
class CheckoutFlowScreen extends StatefulWidget {
  const CheckoutFlowScreen({super.key, this.pharmacyId});

  final String? pharmacyId;

  static const routeName = '/checkout';

  @override
  State<CheckoutFlowScreen> createState() => _CheckoutFlowScreenState();
}

typedef _CheckoutReview = ({
  String? issue,
  CheckoutAttempt? attempt,
  String? address,
  String? blockedItemId,
  Map<String, int> previousPrices,
});

class _CheckoutFlowScreenState extends State<CheckoutFlowScreen> {
  bool _isPlacingOrder = false;
  bool _isCheckingProfile = false;
  Future<_CheckoutReview>? _checkoutReview;
  Future<UserModel>? _profile;
  bool _testCheckout = false;
  String _pickupDate = pickupDays().first;
  String? _pickupWindow;
  String? _operatingHours;

  String? _blockReason(CartViewModel cart) => widget.pharmacyId == null
      ? cart.checkoutBlockReason
      : cart.itemsForPharmacy(widget.pharmacyId).isEmpty
      ? 'Your cart is empty.'
      : null;

  Future<UserModel> _loadProfile() async {
    final user = await context.read<AuthViewModel>().getMe();
    if (mounted) {
      setState(
        () => _testCheckout = user.xenditTestCheckout && user.id != null,
      );
    }
    return user;
  }

  /// Pickup today is not offered in the last hour before the pharmacy closes, and "any time" is not allowed for today.
  void _useOperatingHours(String? hours) {
    if (!mounted) return;
    setState(() {
      _operatingHours = hours;
      if (!dayAvailable(_pickupDate, hours)) _pickupDate = firstPickupDay(hours);
      _pickupWindow = windowForDay(_pickupDate, _pickupWindow, hours);
    });
  }

  Future<_CheckoutReview> _review(
    CartViewModel cart,
    PharmacyViewModel pharmacies,
  ) async {
    final pharmacyId = widget.pharmacyId ?? cart.selectedItems.first.drugstoreId;
    final attempt = await cart.pendingCheckout(pharmacyId);
    if (attempt != null) {
      return (
        issue: null,
        attempt: attempt,
        address: null,
        blockedItemId: null,
        previousPrices: const <String, int>{},
      );
    }
    String? address;
    String? blockedItemId;
    final previousPrices = {
      for (final item in cart.itemsForPharmacy(pharmacyId))
        item.id: item.priceCentavos,
    };
    var issue = await cart.reviewCheckout(
      (storeId) async {
        final inventory = await pharmacies.getStoreInventory(storeId);
        address = inventory.store.address;
        _useOperatingHours(inventory.store.operatingHours);
        return inventory;
      },
      pharmacyId: widget.pharmacyId,
      onBlockedItem: (item) => blockedItemId = item.id,
    );
    issue ??= await _prescriptionIssue(cart, pharmacyId);
    return (
      issue: issue,
      attempt: null,
      address: address,
      blockedItemId: blockedItemId,
      previousPrices: previousPrices,
    );
  }

  /// Prescription items can only be ordered once the pharmacy approved the customer's uploaded prescription.
  Future<String?> _prescriptionIssue(CartViewModel cart, String pharmacyId) async {
    final repository = context.read<OrderViewModel?>()?.repository;
    if (repository == null) return null;
    final account = await repository.currentAccountId();
    for (final item in cart.itemsForPharmacy(pharmacyId)) {
      if (CatalogCategory.fromCatalogValue(item.category) !=
          CatalogCategory.prescription) {
        continue;
      }
      final message =
          '${item.name} needs an approved prescription. Go back to your cart, upload your prescription and wait for the pharmacy to approve it.';
      final pharmacy = int.tryParse(item.drugstoreId);
      final medicine = int.tryParse(item.id);
      if (account == null || pharmacy == null || medicine == null) {
        return message;
      }
      try {
        final status = await repository.prescriptionStatus(
          account,
          pharmacy,
          medicine,
        );
        if (status.status != 'approved') return message;
      } on DioException {
        return message;
      }
    }
    return null;
  }

  Future<void> _placeOrder(CheckoutAttempt? previous) async {
    final cartService = context.read<CartViewModel>();
    final authService = context.read<AuthViewModel>();

    if (_isCheckingProfile ||
        _isPlacingOrder ||
        _blockReason(cartService) != null) {
      return;
    }
    setState(() => _isCheckingProfile = true);

    late final UserModel user;
    try {
      user = await authService.getMe();
      if (!mounted) return;
      if (!user.xenditTestCheckout) {
        setState(() => _testCheckout = false);
        return;
      }
      if (user.id == null || (await _profile)?.id != user.id) {
        if (mounted) {
          setState(() {
            _checkoutReview = null;
            _profile = null;
            _testCheckout = false;
          });
        }
        return;
      }
      if (!mounted) return;
      if (user.phone == null || user.phone!.isEmpty) {
        if (!mounted) return;
        final saved = await showContactDetailsSheet(
          context,
          phone: user.phone,
        );
        if (mounted && saved != null) await _placeOrderCore(user, previous);
        return;
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not check your contact details. Try again.'),
          ),
        );
      }
      return;
    } finally {
      if (mounted) setState(() => _isCheckingProfile = false);
    }

    if (mounted) await _placeOrderCore(user, previous);
  }

  Future<void> _placeOrderCore(
    UserModel user,
    CheckoutAttempt? previous,
  ) async {
    final cartService = context.read<CartViewModel>();
    if (_isPlacingOrder || _blockReason(cartService) != null) return;
    final userId = user.id;
    if (userId == null) return;
    final orderViewModel = context.read<OrderViewModel>();
    final pharmacyId = widget.pharmacyId ?? cartService.selectedItems.first.drugstoreId;

    setState(() => _isPlacingOrder = true);

    CheckoutAttempt? attempt;
    try {
      if ((await cartService.pendingCheckout(pharmacyId))?.key !=
          previous?.key) {
        throw StateError('The reservation attempt changed.');
      }
      attempt = await cartService.rememberCheckout(
        pharmacyId,
        userId,
        grouped: widget.pharmacyId != null,
      );
      if (!mounted) return;
      if (previous != null && previous.key != attempt.key) {
        throw StateError('The reservation attempt changed.');
      }
      final items = attempt.items;
      final subtotal = items.fold<int>(
        0,
        (sum, item) => sum + item.priceCentavos * item.quantity,
      );
      final data = await orderViewModel.placeOrder(
        idempotencyKey: attempt.key,
        expectedUserId: userId,
        grouped: attempt.grouped,
        pickupDate: _pickupDate,
        pickupWindow: _pickupWindow,
        items: items
            .map(
              (item) => {
                'id': int.tryParse(item.id) ?? item.id,
                'quantity': item.quantity,
                'drugstoreId':
                    int.tryParse(item.drugstoreId) ?? item.drugstoreId,
                'expectedUnitPriceCentavos': item.priceCentavos,
                if (item.sellingUnit != null)
                  'expectedSellingUnit': item.sellingUnit,
              },
            )
            .toList(),
      );
      final reference = data['reference']?.toString() ?? '';
      final storeName =
          data['storeName']?.toString() ?? items.first.drugstoreName;

      // The server reserved the order. Payment can be resumed from My Orders.
      try {
        await cartService.finishCheckout(attempt, userId, reserved: true);
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Order saved. The cart could not be updated. Check My Orders.',
              ),
            ),
          );
        }
      }

      if (!mounted) return;

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => OrderConfirmationScreen(
            reference: reference,
            orderId: int.tryParse(data['id']?.toString() ?? ''),
            storeName: storeName,
            hasRemainingCart: cartService.items.isNotEmpty,
            itemSummary: items
                .map(
                  (item) =>
                      '${item.name} × ${item.quantity}${item.sellingUnit == null ? '' : ' (${item.sellingUnit})'}',
                )
                .join(', '),
            totalCentavos: int.tryParse('${data['totalCentavos']}') ?? subtotal,
            depositEnabled: user.xenditTestDeposit,
            pickupDate: data['pickupDate']?.toString() ?? _pickupDate,
            pickupWindow: data.containsKey('pickupDate')
                ? data['pickupWindow']?.toString()
                : _pickupWindow,
            accountId: userId,
            stage: stageFromString(data['stage']?.toString() ?? 'reserved'),
            status: data['status']?.toString(),
            customerName: user.fullName,
            customerPhone: user.phone,
            receiptItems: items
                .map(
                  (item) => {
                    'name': item.name,
                    'quantity': item.quantity,
                    'priceCentavos': item.priceCentavos,
                    'sellingUnit': item.sellingUnit,
                    'drugstoreId': item.drugstoreId,
                  },
                )
                .toList(),
          ),
        ),
      );
    } catch (error) {
      if (attempt != null &&
          error is DioException &&
          [400, 409, 422].contains(error.response?.statusCode)) {
        try {
          await cartService.finishCheckout(attempt, userId, reserved: false);
        } catch (_) {
          // Keep the same attempt if storage cannot be updated.
        }
      }
      if (!mounted) return;
      setState(() {
        _isPlacingOrder = false;
        _checkoutReview = null;
      });

      final message = error is DioException
          ? (error.response?.data is Map
                ? (error.response?.data['error']?.toString() ??
                      'Could not place order. Please try again.')
                : 'Could not place order. Please try again.')
          : 'Could not place order. Please try again.';

      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartViewModel>();
    if (_blockReason(cart) case final reason?) {
      return _buildCheckout(cart, reviewMessage: reason);
    }
    return FutureBuilder<_CheckoutReview>(
      future: _checkoutReview ??= _review(
        cart,
        context.read<PharmacyViewModel>(),
      ),
      builder: (context, snapshot) => _buildCheckout(
        cart,
        reviewing: snapshot.connectionState != ConnectionState.done,
        reviewMessage: snapshot.hasError
            ? 'Could not check stock and prices. Check your connection and try again.'
            : snapshot.data?.issue,
        attempt: snapshot.data?.attempt,
        address: snapshot.data?.address,
        blockedItemId: snapshot.data?.blockedItemId,
        previousPrices: snapshot.data?.previousPrices ?? const {},
      ),
    );
  }

  Widget _buildCheckout(
    CartViewModel cart, {
    bool reviewing = false,
    String? reviewMessage,
    CheckoutAttempt? attempt,
    String? address,
    String? blockedItemId,
    Map<String, int> previousPrices = const {},
  }) {
    final theme = Theme.of(context);
    final items = attempt?.items ?? cart.itemsForPharmacy(widget.pharmacyId);
    final subtotal = items.fold<int>(
      0,
      (sum, item) => sum + item.priceCentavos * item.quantity,
    );
    if (!reviewing &&
        reviewMessage == null &&
        attempt == null &&
        widget.pharmacyId != null &&
        subtotal < 10000) {
      reviewMessage =
          'This pharmacy’s subtotal is below ₱100. Add items or return to your cart.';
    }
    final reviewed = !reviewing && reviewMessage == null;

    return Scaffold(
      backgroundColor: NpColors.background,
      appBar: AppBar(
        titleSpacing: 4,
        title: const Text('Checkout'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
        children: [
          _StaggeredEntrance(
            index: 0,
            child: _SectionCard(
              title: 'Review',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (items.isEmpty)
                    Text(
                      'Your cart is empty.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: NpColors.muted,
                      ),
                    ),
                  for (var i = 0; i < items.length; i++) ...[
                    Builder(
                      builder: (context) {
                        final item = items[i];
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          item.name,
                                          style: theme.textTheme.bodyLarge
                                              ?.copyWith(
                                                fontWeight: FontWeight.w700,
                                                color: NpColors.ink,
                                                height: 1.3,
                                              ),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          '${item.quantity} × ${item.pricePerUnit}',
                                          style: theme.textTheme.bodyMedium
                                              ?.copyWith(
                                                fontSize: 13.5,
                                                color: NpColors.muted,
                                                height: 1.35,
                                              ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Text(
                                    _price(item.priceCentavos * item.quantity),
                                    textAlign: TextAlign.end,
                                    style: theme.textTheme.bodyLarge?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: NpColors.ink,
                                      fontFeatures: const [
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (blockedItemId == item.id &&
                                reviewMessage != null)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Semantics(
                                  liveRegion: true,
                                  child: Text(
                                    reviewMessage,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      color: NpColors.danger,
                                      fontWeight: FontWeight.w600,
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                              ),
                            if (previousPrices[item.id] case final previous?
                                when previous != item.priceCentavos)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Text(
                                  'Unit price updated from ${_price(previous)}.',
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: NpColors.warning,
                                    fontWeight: FontWeight.w600,
                                    height: 1.35,
                                  ),
                                ),
                              ),
                            const Divider(
                              height: 12,
                              thickness: 1,
                              color: NpColors.line,
                            ),
                          ],
                        );
                      },
                    ),
                  ],
                  if (reviewing)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        'Checking stock and prices…',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: NpColors.muted,
                          height: 1.35,
                        ),
                      ),
                    )
                  else if (attempt != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(
                        'Your previous reservation may already exist. Retry the same request or check My Orders.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: NpColors.warning,
                          fontWeight: FontWeight.w600,
                          height: 1.35,
                        ),
                      ),
                    )
                  else if (reviewMessage != null && blockedItemId == null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Semantics(
                        liveRegion: true,
                        child: Text(
                          reviewMessage,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: NpColors.danger,
                            fontWeight: FontWeight.w600,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ),
                  const Divider(height: 1, thickness: 1, color: NpColors.line),
                  Padding(
                    padding: const EdgeInsets.only(top: 12, bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Expanded(
                          child: Text(
                            'Total',
                            style: theme.textTheme.bodyLarge?.copyWith(
                              fontWeight: FontWeight.w500,
                              color: NpColors.ink,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Text(
                          _price(subtotal),
                          textAlign: TextAlign.end,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                            color: NpColors.ink,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1, thickness: 1, color: NpColors.line),
                  _ActionTextButton(
                    icon: NpIcons.edit_outlined,
                    label: 'Edit cart quantities',
                    centered: true,
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _StaggeredEntrance(
            index: 1,
            child: _SectionCard(
              icon: NpIcons.local_pharmacy_outlined,
              title: 'Pharmacy pickup',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    items.isEmpty
                        ? 'Pharmacy pickup'
                        : 'Pickup at ${items.first.drugstoreName}',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: NpColors.ink,
                      height: 1.35,
                    ),
                  ),
                  if (address != null && address.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(top: 2),
                          child: NpIcon(
                            NpIcons.location_on_outlined,
                            size: 18,
                            color: NpColors.muted,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            address,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: NpColors.muted,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _StaggeredEntrance(
            index: 2,
            child: _SectionCard(
              icon: NpIcons.calendar_today_outlined,
              title: 'Pickup date & time',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PickupPicker(
                    date: _pickupDate,
                    window: _pickupWindow,
                    operatingHours: _operatingHours,
                    onChanged: (date, window) => setState(() {
                      _pickupDate = date;
                      _pickupWindow = window;
                    }),
                  ),
                  const SizedBox(height: 14),
                  const Divider(height: 1, thickness: 1, color: NpColors.line),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _StaggeredEntrance(
            index: 3,
            child: _SectionCard(
              icon: NpIcons.person_outline_rounded,
              title: 'Pickup contact',
              child: _buildContact(),
            ),
          ),
          const SizedBox(height: 16),
          _StaggeredEntrance(
            index: 4,
            child: _SectionCard(
              icon: NpIcons.payments_outlined,
              title: 'Payment method',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: _testCheckout
                          ? NpColors.surface
                          : NpColors.surfaceSubtle,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: _testCheckout
                            ? NpColors.primary
                            : NpColors.controlBorder,
                        width: _testCheckout ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        NpIcon(
                          NpIcons.account_balance_wallet_outlined,
                          size: 22,
                          color: _testCheckout
                              ? NpColors.primaryDark
                              : NpColors.muted,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'GCash',
                            style: theme.textTheme.bodyLarge?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: NpColors.ink,
                            ),
                          ),
                        ),
                        NpIcon(
                          _testCheckout
                              ? NpIcons.radio_button_checked_rounded
                              : NpIcons.radio_button_unchecked_rounded,
                          size: 20,
                          color: _testCheckout
                              ? NpColors.primary
                              : NpColors.muted,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (!_testCheckout)
                    Text(
                      paymentNotice,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: NpColors.muted,
                        height: 1.4,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: _PlaceOrderBar(
          canPlaceOrder: _testCheckout && reviewed && items.isNotEmpty,
          testCheckout: _testCheckout,
          isLoading: _isCheckingProfile || _isPlacingOrder,
          onPlaceOrder: () => _placeOrder(attempt),
          retry: attempt != null,
          totalPrice: _price(subtotal),
          estimated: !reviewed,
        ),
      ),
    );
  }

  Widget _buildContact() {
    final theme = Theme.of(context);
    return FutureBuilder<UserModel>(
      future: _profile ??= _loadProfile(),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Text(
            'Loading contact details…',
            style: theme.textTheme.bodyMedium?.copyWith(color: NpColors.muted),
          );
        }
        final user = snapshot.data;
        if (user == null) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Could not load your contact details.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: NpColors.danger,
                ),
              ),
              const SizedBox(height: 4),
              _ActionTextButton(
                icon: NpIcons.refresh_rounded,
                label: 'Try again',
                onPressed: () => setState(() => _profile = null),
              ),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _ContactInfoRow(
              icon: NpIcons.person_outline_rounded,
              text: user.fullName,
              emphasize: true,
            ),
            const SizedBox(height: 8),
            _ContactInfoRow(
              icon: NpIcons.phone_outlined,
              text: user.phone?.isNotEmpty == true
                  ? user.phone!
                  : 'No mobile number saved',
            ),
            const SizedBox(height: 4),
            _ActionTextButton(
              icon: NpIcons.edit_outlined,
              label: 'Edit contact details',
              onPressed: () async {
                final saved = await showContactDetailsSheet(
                  context,
                  phone: user.phone,
                );
                if (mounted && saved != null) setState(() => _profile = null);
              },
            ),
          ],
        );
      },
    );
  }

  String _price(int centavos) =>
      '₱${centavos ~/ 100}.${(centavos % 100).toString().padLeft(2, '0')}';
}

class _ContactInfoRow extends StatelessWidget {
  const _ContactInfoRow({
    required this.icon,
    required this.text,
    this.emphasize = false,
  });

  final NpIconData icon;
  final String text;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: NpIcon(icon, size: 18, color: NpColors.muted),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              color: NpColors.ink,
              fontWeight: emphasize ? FontWeight.w700 : FontWeight.w500,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }
}

class _ActionTextButton extends StatelessWidget {
  const _ActionTextButton({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.centered = false,
  });

  final NpIconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    final button = TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        minimumSize: const Size(48, 48),
        padding: centered
            ? const EdgeInsets.symmetric(horizontal: 12, vertical: 10)
            : const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
        alignment: centered ? Alignment.center : Alignment.centerLeft,
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          NpIcon(icon, size: 18),
          const SizedBox(width: 8),
          Flexible(child: Text(label)),
        ],
      ),
    );
    return centered
        ? Center(child: button)
        : Align(alignment: Alignment.centerLeft, child: button);
  }
}

class _StaggeredEntrance extends StatefulWidget {
  const _StaggeredEntrance({required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<_StaggeredEntrance> createState() => _StaggeredEntranceState();
}

class _StaggeredEntranceState extends State<_StaggeredEntrance>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;
  late final Animation<Offset> _offset;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 200),
    );
    final curved = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    );
    _opacity = curved;
    _offset = Tween<Offset>(
      begin: const Offset(0, 0.03),
      end: Offset.zero,
    ).animate(curved);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (MediaQuery.disableAnimationsOf(context)) {
      _controller.value = 1;
    } else {
      Future<void>.delayed(Duration(milliseconds: widget.index * 30), () {
        if (mounted) _controller.forward();
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) {
      return widget.child;
    }
    return FadeTransition(
      opacity: _opacity,
      child: SlideTransition(position: _offset, child: widget.child),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    this.icon,
    required this.title,
    required this.child,
  });

  final NpIconData? icon;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: NpColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE3EAE7)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F0F172A),
            blurRadius: 24,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                NpIcon(icon, size: 22, color: NpColors.muted),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: NpColors.ink,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

/// Sticky bottom bar showing the running total and a single "Place
/// Order" action, with an inline loading state so the button gives
/// immediate feedback instead of the shopper wondering if the tap
/// registered.
class _PlaceOrderBar extends StatelessWidget {
  const _PlaceOrderBar({
    required this.canPlaceOrder,
    required this.testCheckout,
    required this.isLoading,
    required this.onPlaceOrder,
    required this.retry,
    required this.totalPrice,
    required this.estimated,
  });

  final bool canPlaceOrder;
  final bool testCheckout;
  final bool isLoading;
  final VoidCallback onPlaceOrder;
  final bool retry;
  final String totalPrice;
  final bool estimated;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: const BoxDecoration(
        color: NpColors.surface,
        border: Border(top: BorderSide(color: NpColors.line)),
        boxShadow: [
          BoxShadow(
            color: NpColors.barShadow,
            blurRadius: 16,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: OverflowBar(
        alignment: MainAxisAlignment.spaceBetween,
        spacing: 12,
        overflowSpacing: 10,
        children: [
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                estimated ? 'Estimated total' : 'Order total',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: NpColors.muted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                totalPrice,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: NpColors.ink,
                  letterSpacing: -0.3,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
              if (!testCheckout) ...[
                const SizedBox(height: 2),
                const Text(
                  'GCash unavailable',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: NpColors.warning,
                  ),
                ),
              ],
            ],
          ),
          FilledButton(
            onPressed: isLoading || !canPlaceOrder ? null : onPlaceOrder,
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 56),
              padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
              shape: const StadiumBorder(),
            ),
            child: isLoading
                ? Semantics(liveRegion: true, child: const Text('Please wait…'))
                : Text(
                    retry
                        ? 'Retry order reservation'
                        : testCheckout
                        ? 'Place test order'
                        : 'Place order',
                  ),
          ),
        ],
      ),
    );
  }
}
