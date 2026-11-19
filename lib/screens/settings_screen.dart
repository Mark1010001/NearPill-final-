import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';

import '../features/auth/presentation/auth_view_model.dart';
import 'forgot_password_screen.dart';
import 'policies_screen.dart';
import 'profile_style.dart';

const _ink = Color(0xFF17332A);
const _muted = Color(0xFF61726B);
const _danger = Color(0xFFB3261E);

/// Account settings: account and security, privacy information, delete
/// account and sign out.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.email,
    required this.onAccountDeleted,
    this.onSignedOutEverywhere,
    this.onSignOut,
  });

  final String email;
  final Future<void> Function() onAccountDeleted;
  final Future<void> Function()? onSignedOutEverywhere;
  final Future<void> Function()? onSignOut;

  Future<void> _signOutEverywhere(BuildContext context) async {
    final model = context.read<AuthViewModel>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await model.logoutAll();
      await onSignedOutEverywhere?.call();
      messenger.showSnackBar(
        const SnackBar(content: Text('You have been signed out of all devices.')),
      );
    } on AuthException catch (error) {
      messenger.showSnackBar(SnackBar(content: Text(error.message)));
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not sign you out of all devices.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: profileMint,
    appBar: profileAppBar('Settings'),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        const _SectionLabel('Account & security'),
        Container(
          decoration: profileCardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              _SettingsRow(
                icon: NpIcons.mail_outline,
                title: 'Email',
                subtitle: email.isEmpty ? 'Not available' : email,
              ),
              const _RowDivider(),
              _SettingsRow(
                key: const Key('change-password'),
                icon: NpIcons.key_outlined,
                title: 'Change password',
                subtitle: 'We email you a link to set a new one.',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ForgotPasswordScreen(email: email),
                  ),
                ),
              ),
              const _RowDivider(),
              _SettingsRow(
                key: const Key('sign-out-all'),
                icon: NpIcons.devices_outlined,
                title: 'Sign out of all devices',
                subtitle: 'Ends every session on every device.',
                onTap: () => _signOutEverywhere(context),
              ),
              const _RowDivider(),
              _SettingsRow(
                icon: NpIcons.delete_outline,
                iconColor: profileDanger,
                iconBackground: const Color(0xFFFFE4E1),
                title: 'Delete account',
                titleColor: profileDanger,
                subtitle: 'Permanently remove your NearPill account.',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => DeleteAccountScreen(
                      onAccountDeleted: onAccountDeleted,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const _SectionLabel('Help'),
        Container(
          decoration: profileCardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: _SettingsRow(
            icon: NpIcons.privacy_tip_outlined,
            title: 'Privacy and service information',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const PoliciesScreen()),
            ),
          ),
        ),
        if (onSignOut != null) ...[
          const SizedBox(height: 20),
          SizedBox(
            height: 56,
            child: FilledButton.icon(
              key: const Key('sign-out'),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: profileDeepGreen,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
              ),
              onPressed: () => onSignOut!(),
              icon: const NpIcon(NpIcons.logout),
              label: const Text(
                'Sign out',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

class _SettingsRow extends StatelessWidget {
  const _SettingsRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
    this.iconColor = profileDeepGreen,
    this.iconBackground = const Color(0xFFD6F5E3),
    this.titleColor = profileInk,
  });

  final NpIconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
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
            if (onTap != null)
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

class _RowDivider extends StatelessWidget {
  const _RowDivider();
  @override
  Widget build(BuildContext context) => const Divider(
    height: 1,
    indent: 70,
    endIndent: 16,
    color: Color(0xFFE3EFE8),
  );
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8, left: 4),
    child: Text(
      text.toUpperCase(),
      style: const TextStyle(
        color: _muted,
        fontSize: 12,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.8,
      ),
    ),
  );
}

class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key, required this.onAccountDeleted});

  final Future<void> Function() onAccountDeleted;

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  final _password = TextEditingController();
  bool _show = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<bool> _confirm() async =>
      await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Delete your account?'),
          content: const Text(
            'This cannot be undone. You will be signed out everywhere.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Keep account'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: TextButton.styleFrom(foregroundColor: _danger),
              child: const Text('Delete account'),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _delete() async {
    if (_busy) return;
    if (_password.text.isEmpty) {
      setState(() => _error = 'Enter your password to confirm.');
      return;
    }
    FocusScope.of(context).unfocus();
    final model = context.read<AuthViewModel>();
    if (!await _confirm() || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await model.deleteAccount(password: _password.text);
      await widget.onAccountDeleted();
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not delete your account. Try again.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: profileMint,
    appBar: profileAppBar('Delete account'),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'Delete your NearPill account',
          style: TextStyle(
            color: _ink,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'Your name, email, phone number and any uploaded '
          'prescription photos are removed and you are signed out on every '
          'device. Past order records stay with the pharmacies without your '
          'personal details.',
          style: TextStyle(color: _muted, height: 1.4),
        ),
        const SizedBox(height: 8),
        const Text(
          'You cannot delete the account while an order is still active. '
          'Cancel it or finish pickup first.',
          style: TextStyle(color: _muted, height: 1.4),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _password,
          obscureText: !_show,
          enabled: !_busy,
          autofillHints: const [AutofillHints.password],
          decoration: InputDecoration(
            labelText: 'Password',
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
            suffixIcon: IconButton(
              tooltip: _show ? 'Hide password' : 'Show password',
              icon: NpIcon(_show ? NpIcons.visibility_off : NpIcons.visibility),
              onPressed: () => setState(() => _show = !_show),
            ),
          ),
          onSubmitted: (_) => _delete(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Semantics(
            liveRegion: true,
            child: Text(_error!, style: const TextStyle(color: _danger)),
          ),
        ],
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : () => _delete(),
          style: FilledButton.styleFrom(
            backgroundColor: _danger,
            minimumSize: const Size.fromHeight(52),
          ),
          child: _busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Delete my account'),
        ),
      ],
    ),
  );
}
