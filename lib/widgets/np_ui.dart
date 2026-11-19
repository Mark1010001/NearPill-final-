import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';

import '../app_theme.dart';

/// Page title row used by tabs that have no AppBar (Home, Search) so their
/// header matches the AppBar-based tabs (Orders, Profile) exactly.
class PageHeader extends StatelessWidget {
  const PageHeader({super.key, required this.title, this.actions = const []});

  final String title;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final titleStyle = Theme.of(context).appBarTheme.titleTextStyle;
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 64),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            flex: 3,
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: titleStyle,
            ),
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(width: 8),
            Flexible(
              flex: 2,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [for (final a in actions) Flexible(child: a)],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Rounded soft-green square that holds a leading icon.
class IconTile extends StatelessWidget {
  const IconTile({super.key, required this.icon, this.size = 48});

  final NpIconData icon;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: NpColors.primarySoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: NpIcon(icon, color: NpColors.primary, size: size * 0.5),
    );
  }
}

/// Small rounded status pill ("OPEN", "Available", "Completed" ...).
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    this.color = NpColors.primary,
    this.background = NpColors.primarySoft,
    this.dot = false,
  });

  final String label;
  final Color color;
  final Color background;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (dot) ...[
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
            ],
            Flexible(
              child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.3,
              ),
            ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Soft-green pill button with a guaranteed 48dp tap target; its label
/// ellipsizes instead of overflowing at large text sizes.
class PillButton extends StatelessWidget {
  const PillButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
  });

  final String label;
  final NpIconData? icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: NpColors.primarySoft,
      shape: const StadiumBorder(side: BorderSide(color: NpColors.primaryBorder)),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onPressed,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  NpIcon(icon, size: 18, color: NpColors.primary),
                  const SizedBox(width: 8),
                ],
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: NpColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
