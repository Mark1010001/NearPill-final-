import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:provider/provider.dart';

import '../features/auth/presentation/auth_view_model.dart';
import 'account_widgets.dart';
import 'forgot_password_screen.dart';
import 'help_support_screen.dart';
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
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const _SectionLabel('Account & security'),
        Container(
          decoration: profileCardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              AccountRow(
                icon: NpIcons.mail_outline,
                title: 'Email',
                subtitle: email.isEmpty ? 'Not available' : email,
                // Sign-up confirms the address with a code, so it is verified.
                trailing: email.isEmpty ? null : const VerifiedChip(),
              ),
              const AccountRowDivider(),
              AccountRow(
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
              const AccountRowDivider(),
              AccountRow(
                key: const Key('sign-out-all'),
                icon: NpIcons.devices_outlined,
                title: 'Sign out of all devices',
                subtitle: 'Ends every session on every device.',
                onTap: () => _signOutEverywhere(context),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const _SectionLabel('Help & legal'),
        Container(
          decoration: profileCardDecoration(),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              AccountRow(
                key: const Key('help-support'),
                icon: NpIcons.chat_bubble_outline,
                title: 'Help & Support',
                subtitle: 'Contact us about an order or your account.',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const HelpSupportScreen()),
                ),
              ),
              const AccountRowDivider(),
              AccountRow(
                key: const Key('privacy-terms'),
                icon: NpIcons.privacy_tip_outlined,
                title: 'Privacy, cancellations and terms',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const PoliciesScreen()),
                ),
              ),
            ],
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
              onPressed: () async {
                if (await confirmSignOut(context)) await onSignOut!();
              },
              icon: const NpIcon(NpIcons.logout),
              label: const Text(
                'Sign out',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
              ),
            ),
          ),
        ],
        // Danger zone: far below the everyday actions so it is never tapped by accident.
        const SizedBox(height: 40),
        const _SectionLabel('Danger zone'),
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFFFFF4F2),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFF3C9C4)),
          ),
          clipBehavior: Clip.antiAlias,
          child: AccountRow(
            key: const Key('delete-account'),
            icon: NpIcons.delete_outline,
            iconColor: profileDanger,
            iconBackground: const Color(0xFFFFE4E1),
            title: 'Delete account',
            titleColor: profileDanger,
            subtitle: 'Permanently remove your NearPill account.',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) =>
                    DeleteAccountScreen(onAccountDeleted: onAccountDeleted),
              ),
            ),
          ),
        ),
      ],
    ),
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
        builder: (_) => const _TypeDeleteDialog(),
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

/// Final step of deleting an account: the red button stays off until the
/// person types DELETE.
class _TypeDeleteDialog extends StatefulWidget {
  const _TypeDeleteDialog();

  @override
  State<_TypeDeleteDialog> createState() => _TypeDeleteDialogState();
}

class _TypeDeleteDialogState extends State<_TypeDeleteDialog> {
  final _typed = TextEditingController();

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ready = _typed.text.trim() == 'DELETE';
    return AlertDialog(
      title: const Text('Delete your account?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('This cannot be undone. You will be signed out everywhere.'),
          const SizedBox(height: 16),
          TextField(
            key: const Key('type-delete'),
            controller: _typed,
            autofocus: true,
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            enableSuggestions: false,
            decoration: const InputDecoration(
              labelText: 'Type DELETE to confirm',
              border: OutlineInputBorder(),
            ),
            onChanged: (_) => setState(() {}),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Keep account'),
        ),
        TextButton(
          onPressed: ready ? () => Navigator.of(context).pop(true) : null,
          style: TextButton.styleFrom(foregroundColor: _danger),
          child: const Text('Delete account'),
        ),
      ],
    );
  }
}
