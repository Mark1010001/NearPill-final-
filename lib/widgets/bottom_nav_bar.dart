import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';

import '../app_theme.dart';

/// The single bottom navigation used by every main tab. Styling comes from
/// `navigationBarTheme` in app_theme.dart. Every tab uses the same stroke icon;
/// the selected tab turns green and sits on a soft green pill. The website's
/// bottom bar (.shop-nav) is built to the same measurements.
class BttmNaviBar extends StatelessWidget {
  const BttmNaviBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.ordersBadge = false,
    this.profileBadge = false,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  /// Shows a small dot on Orders when the cart has items.
  final bool ordersBadge;

  /// Shows a small dot on Profile when there are new order updates.
  final bool profileBadge;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: NpColors.line)),
        boxShadow: [
          BoxShadow(color: Color(0x0F0F172A), blurRadius: 16, offset: Offset(0, -4)),
        ],
      ),
      child: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: onTap,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          const NavigationDestination(icon: NpIcon(NpIcons.home), label: 'Home'),
          const NavigationDestination(icon: NpIcon(NpIcons.search), label: 'Search'),
          const NavigationDestination(icon: NpIcon(NpIcons.map), label: 'Map'),
          NavigationDestination(
            icon: _badge(const NpIcon(NpIcons.receipt_long)),
            label: 'Orders',
          ),
          NavigationDestination(
            icon: _dot(const NpIcon(NpIcons.person), profileBadge),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  Widget _badge(Widget icon) => _dot(icon, ordersBadge);

  Widget _dot(Widget icon, bool show) => show
      ? Badge(
          smallSize: 9,
          backgroundColor: NpColors.primary,
          child: icon,
        )
      : icon;
}
