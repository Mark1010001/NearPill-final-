import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/order_model.dart';
import '../models/user_model.dart';
import '../features/auth/presentation/auth_view_model.dart';
import 'policies_screen.dart';
import '../features/cart/presentation/cart_view_model.dart';
import '../features/orders/presentation/order_view_model.dart';
import '../features/orders/presentation/order_updates_view_model.dart';
import '../app_theme.dart';
import 'notifications_screen.dart';
import 'profile_style.dart';
import 'settings_screen.dart';
import '../widgets/contact_details_sheet.dart';
import 'package:shimmer/shimmer.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    this.onLogout,
    this.onOpenAssistant,
    this.onOpenOrders,
  });

  final VoidCallback? onLogout;
  final VoidCallback? onOpenAssistant;

  /// Switches to the Orders tab ("View all" and tapping an order).
  final VoidCallback? onOpenOrders;

  static const routeName = '/profile';

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  // Personal Info State
  String _fullName = '';
  String _phone = '';
  String _birthdate = '';
  String _email = '';
  bool _isLoadingUser = true;
  bool _profileLoadFailed = false;

  @override
  void initState() {
    super.initState();
    _fetchUserData();
  }

  Future<void> _fetchUserData() async {
    if (!_isLoadingUser && _email.isEmpty) {
      setState(() => _isLoadingUser = true);
    }
    try {
      final authService = context.read<AuthViewModel>();
      final UserModel user = await authService.getMe();

      if (!mounted) return;
      context.read<OrderViewModel>().fetchOrders();

      setState(() {
        _fullName = user.fullName;
        _email = user.email;
        _phone = user.phone ?? '';
        _birthdate = user.birthDate ?? '';
        _isLoadingUser = false;
        _profileLoadFailed = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _isLoadingUser = false;
          _profileLoadFailed = true;
        });
      }
    }
  }

  Future<void> _editContactDetails() async {
    final saved = await showContactDetailsSheet(
      context,
      phone: _phone,
      birthDate: _birthdate,
      fullName: _fullName,
    );
    if (!mounted || saved == null) return;
    setState(() {
      _phone = saved.phone;
      _birthdate = saved.birthDate;
    });
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Contact details saved.')));
  }

  Widget _updatesButton(BuildContext context) {
    final int unread;
    try {
      unread = context.watch<OrderUpdatesViewModel>().unreadCount;
    } on ProviderNotFoundException {
      return const SizedBox.shrink();
    }
    return IconButton(
      tooltip: unread > 0 ? 'Order updates, $unread new' : 'Order updates',
      icon: Badge(
        isLabelVisible: unread > 0,
        smallSize: 9,
        backgroundColor: NpColors.primary,
        child: Icon(
          unread > 0
              ? Icons.notifications_rounded
              : Icons.notifications_outlined,
        ),
      ),
      onPressed: () =>
          Navigator.of(context).pushNamed(NotificationsScreen.routeName),
    );
  }

  /// Ends the local session and clears everything tied to this customer.
  Future<void> _endSession({required bool tellServer}) async {
    final authService = context.read<AuthViewModel>();
    final cartService = context.read<CartViewModel>();
    final orderService = context.read<OrderViewModel>();
    OrderUpdatesViewModel? updatesService;
    try {
      updatesService = context.read<OrderUpdatesViewModel>();
    } on ProviderNotFoundException {
      // Not provided in some tests.
    }

    // Clear the authenticated user's cart before the session key is removed.
    if (tellServer) {
      try {
        await cartService.clearCart();
      } catch (_) {}
    }
    await authService.logout();
    orderService.clearOrders();
    updatesService?.clear();
  }

  void _leaveToLogin(BuildContext navContext) {
    if (widget.onLogout != null) {
      widget.onLogout!();
    } else {
      Navigator.of(navContext).pushNamedAndRemoveUntil('/login', (r) => false);
    }
  }

  Future<void> _logout() async {
    await _endSession(tellServer: true);
    if (!mounted) return;
    _leaveToLogin(context);
  }

  /// Called by Settings once the server has deleted the account.
  Future<void> _afterAccountDeleted() async {
    final messenger = ScaffoldMessenger.of(context);
    await _endSession(tellServer: false);
    if (!mounted) return;
    _leaveToLogin(context);
    messenger.showSnackBar(
      const SnackBar(content: Text('Your account has been deleted.')),
    );
  }

  /// Called by Settings once the server has ended every session.
  Future<void> _afterSignOutAll() async {
    await _endSession(tellServer: false);
    if (!mounted) return;
    _leaveToLogin(context);
  }

  void _openSettings() => Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => SettingsScreen(
        email: _email,
        onAccountDeleted: _afterAccountDeleted,
        onSignedOutEverywhere: _afterSignOutAll,
        onSignOut: _afterSignOutFromSettings,
      ),
    ),
  );

  /// "Sign out" in Settings: close Settings, then end the session.
  Future<void> _afterSignOutFromSettings() async {
    Navigator.of(context).pop();
    await _logout();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: profileMint,
      appBar: profileAppBar(
        'My Profile',
        bigTitle: true,
        actions: [
          _updatesButton(context),
          if (widget.onOpenAssistant != null)
            IconButton(
              tooltip: 'Ask NearPill',
              icon: const Icon(Icons.chat_bubble_outline),
              onPressed: widget.onOpenAssistant,
            ),
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: _openSettings,
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: _isLoadingUser
          ? _buildSkeletonLoader()
          : RefreshIndicator(
              color: profileGreen,
              onRefresh: () async {
                await _fetchUserData();
              },
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_profileLoadFailed) ...[
                      Semantics(
                        liveRegion: true,
                        child: const Text(
                          'Unable to load your account details.',
                        ),
                      ),
                      TextButton(
                        onPressed: _fetchUserData,
                        child: const Text('Try again'),
                      ),
                      const SizedBox(height: 16),
                    ],
                    if (!_profileLoadFailed || _email.isNotEmpty) ...[
                      _buildProfileHeader(),
                      const SizedBox(height: 16),
                      _buildIdentityCard(),
                      const SizedBox(height: 24),
                      _buildLogisticsCard(),
                      const SizedBox(height: 8),
                    ],
                    TextButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => const PoliciesScreen(),
                        ),
                      ),
                      child: const Text('Privacy, cancellations and terms'),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildSkeletonLoader() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Shimmer.fromColors(
        baseColor: Colors.grey[300]!,
        highlightColor: Colors.grey[100]!,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header Skeleton
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: [
                    Container(
                      width: 72,
                      height: 72,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            height: 20,
                            width: 150,
                            color: Colors.white,
                          ),
                          const SizedBox(height: 8),
                          Container(
                            height: 14,
                            width: 100,
                            color: Colors.white,
                          ),
                          const SizedBox(height: 12),
                          Container(
                            height: 24,
                            width: 120,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Section Title Skeleton
            Row(
              children: [
                Container(height: 24, width: 24, color: Colors.white),
                const SizedBox(width: 12),
                Container(height: 20, width: 180, color: Colors.white),
              ],
            ),
            const SizedBox(height: 16),

            // Card 1 Skeleton
            Container(
              height: 140,
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
            ),
            const SizedBox(height: 24),

            // Card 2 Skeleton
            Container(
              height: 200,
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
            ),
            const SizedBox(height: 24),

            // Card 3 Skeleton
            Container(
              height: 140,
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProfileHeader() {
    return Container(
      decoration: profileCardDecoration(),
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          CircleAvatar(
            radius: 32,
            backgroundColor: profileSoftGreen,
            child: Text(
              _fullName.isNotEmpty ? _fullName[0].toUpperCase() : 'U',
              style: const TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: profileDeepGreen,
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _fullName,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: profileInk,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _email,
                  style: const TextStyle(fontSize: 14, color: profileMuted),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _editContactDetails,
            icon: const Icon(Icons.edit_outlined, color: profileInk),
            tooltip: 'Edit contact details',
          ),
        ],
      ),
    );
  }

  Widget _buildIdentityCard() {
    return Container(
      decoration: profileCardDecoration(),
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Account details',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: profileInk,
            ),
          ),
          const SizedBox(height: 10),
          const Divider(height: 1, color: Color(0xFFD6F0E1)),
          _buildIdentityTile(label: 'Full Name', value: _fullName),
          const Divider(height: 1, color: Color(0xFFD6F0E1)),
          _buildIdentityTile(
            label: 'Phone Number',
            value: _phone,
            editable: true,
          ),
          const Divider(height: 1, color: Color(0xFFD6F0E1)),
          _buildIdentityTile(
            label: 'Birthdate',
            value: _birthdate,
            editable: true,
          ),
        ],
      ),
    );
  }

  Widget _buildIdentityTile({
    required String label,
    required String value,
    bool editable = false,
  }) {
    final empty = value.isEmpty;
    final row = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 52),
      child: Row(
        children: [
          Expanded(
            flex: 4,
            child: Text(
              label,
              style: const TextStyle(color: profileMuted, fontSize: 15),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 5,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Flexible(
                  child: Text(
                    empty ? 'Not provided' : value,
                    textAlign: TextAlign.end,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: empty ? profileGreen : profileInk,
                    ),
                  ),
                ),
                if (editable)
                  const Icon(
                    Icons.chevron_right,
                    size: 20,
                    color: profileGreen,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
    if (!editable) return row;
    return InkWell(onTap: _editContactDetails, child: row);
  }

  void _openOrderHistory() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _OrderHistoryPage(
          tileBuilder: (order) => _buildOrderTile(
            order,
            onTap: () {
              Navigator.of(context).pop();
              widget.onOpenOrders?.call();
            },
          ),
          onRefresh: () => context.read<OrderViewModel>().fetchOrders(),
        ),
      ),
    );
  }

  Widget _buildLogisticsCard() {
    final orderService = context.watch<OrderViewModel>();
    final allOrders = orderService.orders;
    final ordersFailed = orderService.error != null;
    final recent = allOrders.take(3).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Order History',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: profileInk,
                ),
              ),
            ),
            if (allOrders.isNotEmpty)
              TextButton(
                onPressed: _openOrderHistory,
                style: TextButton.styleFrom(
                  minimumSize: const Size(48, 48),
                  foregroundColor: profileDeepGreen,
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'View all',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Icon(Icons.chevron_right, size: 20),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          decoration: profileCardDecoration(),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: recent.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Column(
                      children: [
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            orderService.isLoading
                                ? 'Loading orders…'
                                : ordersFailed
                                ? 'Unable to load orders.'
                                : 'No recent orders.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                        if (ordersFailed)
                          TextButton(
                            onPressed: orderService.fetchOrders,
                            child: const Text('Try again'),
                          ),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    for (var i = 0; i < recent.length; i++) ...[
                      if (i > 0)
                        const Divider(height: 1, color: Color(0xFFD6F0E1)),
                      _buildOrderTile(recent[i]),
                    ],
                  ],
                ),
        ),
      ],
    );
  }

  ({String label, Color background, Color foreground}) _statusChip(
    OrderModel order,
  ) {
    switch (order.stage.toLowerCase()) {
      case 'ready':
      case 'ready_for_pickup':
        return (
          label: 'Ready for pickup',
          background: const Color(0xFFBDF0D0),
          foreground: profileDeepGreen,
        );
      case 'completed':
        return (
          label: 'Completed',
          background: const Color(0xFFCFE6DA),
          foreground: const Color(0xFF25523C),
        );
      case 'cancelled':
        return (
          label: 'Cancelled',
          background: const Color(0xFFFFD9D6),
          foreground: profileDanger,
        );
      case 'expired':
        return (
          label: 'Expired',
          background: const Color(0xFFFFD9D6),
          foreground: profileDanger,
        );
      case 'preparing':
      case 'confirmed':
        return (
          label: 'Preparing',
          background: const Color(0xFFFFF0C2),
          foreground: const Color(0xFF6B4700),
        );
      default:
        return (
          label: 'Reserved',
          background: const Color(0xFFFFF0C2),
          foreground: const Color(0xFF6B4700),
        );
    }
  }

  Widget _buildOrderTile(OrderModel order, {VoidCallback? onTap}) {
    final count = order.items.length;
    final chip = _statusChip(order);
    final cancelled = order.parsedStage == OrderStage.cancelled ||
        order.stage.toLowerCase() == 'expired';
    final details = [
      if (order.placedOn.isNotEmpty) order.placedOn,
      if (count > 0) '$count ${count == 1 ? 'item' : 'items'}',
    ].join(' • ');
    return InkWell(
      onTap: onTap ?? widget.onOpenOrders,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.storeName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: profileInk,
                    ),
                  ),
                  if (details.isNotEmpty)
                    Text(
                      details,
                      style: const TextStyle(color: profileMuted, fontSize: 13),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  order.total,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: cancelled ? profileMuted : profileInk,
                    decoration: cancelled ? TextDecoration.lineThrough : null,
                  ),
                ),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: chip.background,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    chip.label,
                    style: TextStyle(
                      color: chip.foreground,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}


/// "View all": every order on the account, newest first.
class _OrderHistoryPage extends StatelessWidget {
  const _OrderHistoryPage({required this.tileBuilder, required this.onRefresh});

  final Widget Function(OrderModel order) tileBuilder;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final orders = context.watch<OrderViewModel>().orders;
    return Scaffold(
      backgroundColor: profileMint,
      appBar: profileAppBar(
        'Order History',
        leading: IconButton(
          tooltip: 'Back',
          icon: const Icon(Icons.arrow_back, color: profileInk),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: RefreshIndicator(
        color: profileGreen,
        onRefresh: onRefresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Container(
              decoration: profileCardDecoration(),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: orders.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(child: Text('No orders yet.')),
                    )
                  : Column(
                      children: [
                        for (var i = 0; i < orders.length; i++) ...[
                          if (i > 0)
                            const Divider(height: 1, color: Color(0xFFD6F0E1)),
                          tileBuilder(orders[i]),
                        ],
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
