import 'package:flutter/material.dart';

import '../app_theme.dart';

/// The single bottom navigation used by every main tab. Styling comes from
/// `navigationBarTheme` in app_theme.dart; icons are outlined when idle and
/// filled when selected so all five tabs behave the same way.
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
          const NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded),
            label: 'Home',
          ),
          const NavigationDestination(
            icon: Icon(Icons.search_rounded),
            selectedIcon: Icon(Icons.search_rounded, weight: 700),
            label: 'Search',
          ),
          const NavigationDestination(
            icon: Icon(Icons.map_outlined),
            selectedIcon: Icon(Icons.map_rounded),
            label: 'Map',
          ),
          NavigationDestination(
            icon: _badge(const Icon(Icons.receipt_long_outlined)),
            selectedIcon: _badge(const Icon(Icons.receipt_long_rounded)),
            label: 'Orders',
          ),
          NavigationDestination(
            icon: _dot(const Icon(Icons.person_outline_rounded), profileBadge),
            selectedIcon: _dot(const Icon(Icons.person_rounded), profileBadge),
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
