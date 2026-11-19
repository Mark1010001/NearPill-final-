import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';

import 'profile_style.dart';

/// One tappable row in a Profile / Settings card: icon tile, title, optional
/// subtitle, and a `>` chevron when it opens something. At least 64 px tall.
class AccountRow extends StatelessWidget {
  const AccountRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
    this.trailing,
    this.iconColor = profileDeepGreen,
    this.iconBackground = const Color(0xFFD6F5E3),
    this.titleColor = profileInk,
  });

  final NpIconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  /// Shown instead of the chevron (for example the Verified chip).
  final Widget? trailing;
  final Color iconColor;
  final Color iconBackground;
  final Color titleColor;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 64),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: iconBackground,
                borderRadius: BorderRadius.circular(12),
              ),
              child: NpIcon(icon, color: iconColor, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: titleColor,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      style: const TextStyle(color: profileMuted, fontSize: 13),
                    ),
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 8), trailing!]
            else if (onTap != null)
              NpIcon(
                NpIcons.chevron_right,
                color: titleColor == profileDanger
                    ? profileDanger
                    : profileMuted,
              ),
          ],
        ),
      ),
    ),
  );
}

class AccountRowDivider extends StatelessWidget {
  const AccountRowDivider({super.key});
  @override
  Widget build(BuildContext context) => const Divider(
    height: 1,
    indent: 70,
    endIndent: 16,
    color: Color(0xFFE3EFE8),
  );
}

/// Small green "Verified" pill for read-only values that were confirmed.
class VerifiedChip extends StatelessWidget {
  const VerifiedChip({super.key});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(
      color: const Color(0xFFBDF0D0),
      borderRadius: BorderRadius.circular(999),
    ),
    child: const Text(
      'Verified',
      style: TextStyle(
        color: profileDeepGreen,
        fontSize: 12,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

/// Asks before signing out. Returns true only when the person confirms.
Future<bool> confirmSignOut(BuildContext context) async =>
    await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will need to log in again to use NearPill.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: TextButton.styleFrom(foregroundColor: profileDeepGreen),
            child: const Text('Sign out'),
          ),
        ],
      ),
    ) ??
    false;

/// Full-width outlined sign-out button used at the bottom of Profile.
class SignOutOutlinedButton extends StatelessWidget {
  const SignOutOutlinedButton({super.key, required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 56,
    child: OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: profileDeepGreen,
        side: const BorderSide(color: profileGreen, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      onPressed: onPressed,
      icon: const NpIcon(NpIcons.logout),
      label: const Text(
        'Sign out',
        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
      ),
    ),
  );
}
