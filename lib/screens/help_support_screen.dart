import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:nearpill/widgets/np_icon.dart';

import 'profile_style.dart';

const supportEmail = 'nearpillemail.business@gmail.com';

/// Where to get help: the support email, with a one-tap copy.
class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: profileMint,
    appBar: profileAppBar('Help & Support'),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Container(
          decoration: profileCardDecoration(),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Contact support',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: profileInk,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Email us about an order, your account or anything in the app. '
                'Include your claim code if your question is about an order.',
                style: TextStyle(color: profileMuted, height: 1.4),
              ),
              const SizedBox(height: 16),
              SelectableText(
                supportEmail,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: profileInk,
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: OutlinedButton.icon(
                  key: const Key('copy-support-email'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: profileDeepGreen,
                    side: const BorderSide(color: profileGreen, width: 1.5),
                  ),
                  icon: const NpIcon(NpIcons.content_paste_outlined),
                  label: const Text('Copy email address'),
                  onPressed: () async {
                    final messenger = ScaffoldMessenger.of(context);
                    await Clipboard.setData(
                      const ClipboardData(text: supportEmail),
                    );
                    messenger.showSnackBar(
                      const SnackBar(content: Text('Email address copied.')),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
