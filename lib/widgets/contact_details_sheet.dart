import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../features/auth/presentation/auth_view_model.dart';
import '../screens/profile_style.dart';
import '../utils/formatters.dart';

/// Opens the full-screen "Edit Account Details" page. Returns the saved phone
/// and birthdate, or null when the person leaves without saving.
Future<({String phone, String birthDate})?> showContactDetailsSheet(
  BuildContext context, {
  required String? phone,
  required String? birthDate,
  String? fullName,
}) => Navigator.of(context).push<({String phone, String birthDate})>(
  MaterialPageRoute(
    builder: (_) => _ContactDetailsPage(
      phone: phone,
      birthDate: birthDate,
      fullName: fullName,
    ),
  ),
);

class _ContactDetailsPage extends StatefulWidget {
  const _ContactDetailsPage({
    required this.phone,
    required this.birthDate,
    required this.fullName,
  });

  final String? phone;
  final String? birthDate;
  final String? fullName;

  @override
  State<_ContactDetailsPage> createState() => _ContactDetailsPageState();
}

class _ContactDetailsPageState extends State<_ContactDetailsPage> {
  final _form = GlobalKey<FormState>();
  late final _phone = TextEditingController(text: widget.phone);
  late final _birthDate = TextEditingController(text: widget.birthDate);
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _birthDate.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !(_form.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final details = (
      phone: _phone.text.trim(),
      birthDate: _birthDate.text.trim(),
    );
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await context.read<AuthViewModel>().updateProfile(
        phone: details.phone,
        birthDate: details.birthDate,
      );
      if (mounted) Navigator.of(context).pop(details);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not save your contact details. Try again.';
      });
    }
  }

  InputDecoration _decoration(
    NpIconData icon, {
    String? hint,
    String? floatingLabel,
  }) => InputDecoration(
    hintText: hint,
    labelText: floatingLabel,
    floatingLabelBehavior: floatingLabel == null
        ? null
        : FloatingLabelBehavior.always,
    floatingLabelStyle: const TextStyle(
      color: profileMuted,
      fontWeight: FontWeight.w700,
    ),
    errorMaxLines: 4,
    filled: true,
    fillColor: Colors.white,
    prefixIcon: NpIcon(icon, color: profileMuted),
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: BorderSide.none,
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: BorderSide.none,
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: const BorderSide(color: profileGreen, width: 2),
    ),
  );

  Widget _label(String text, String? tag) => Padding(
    padding: const EdgeInsets.only(bottom: 8, top: 4),
    child: Row(
      children: [
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              color: profileInk,
              fontWeight: FontWeight.w700,
              fontSize: 15,
            ),
          ),
        ),
        if (tag != null)
          Text(tag, style: const TextStyle(color: profileMuted, fontSize: 12)),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final name = (widget.fullName ?? '').trim();
    return PopScope(
      canPop: !_saving,
      child: Scaffold(
        backgroundColor: profileMint,
        appBar: profileAppBar(
          'Edit Account Details',
          leading: IconButton(
            tooltip: 'Back',
            icon: const NpIcon(NpIcons.arrow_back, color: profileInk),
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
          ),
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(
              16,
              8,
              16,
              24 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (name.isNotEmpty) ...[
                    _label('Full Name', null),
                    Semantics(
                      label: 'Full name, $name. Shown here for reference.',
                      excludeSemantics: true,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 16,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Row(
                          children: [
                            const NpIcon(
                              NpIcons.person_outline,
                              color: profileDeepGreen,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                name,
                                style: const TextStyle(
                                  color: profileInk,
                                  fontSize: 16,
                                ),
                              ),
                            ),
                            Container(
                              width: 28,
                              height: 28,
                              decoration: const BoxDecoration(
                                color: profileSoftGreen,
                                shape: BoxShape.circle,
                              ),
                              child: const NpIcon(
                                NpIcons.check,
                                size: 18,
                                color: profileDeepGreen,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  _label('Phone Number', null),
                  Semantics(
                    label: 'Phone number',
                    child: TextFormField(
                      controller: _phone,
                      readOnly: _saving,
                      keyboardType: TextInputType.phone,
                      textInputAction: TextInputAction.next,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(11),
                      ],
                      decoration: _decoration(
                        NpIcons.smartphone_outlined,
                        hint: '09171234567',
                      ),
                      validator: (value) =>
                          RegExp(r'^09\d{9}$').hasMatch(value ?? '')
                          ? null
                          : 'Enter an 11-digit mobile number starting with 09.',
                    ),
                  ),
                  const SizedBox(height: 16),
                  _label('Birthdate', null),
                  Semantics(
                    label: 'Birthdate, month, day, year',
                    child: TextFormField(
                      controller: _birthDate,
                      readOnly: _saving,
                      keyboardType: TextInputType.datetime,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _save(),
                      inputFormatters: [DateTextFormatter()],
                      decoration: _decoration(
                        NpIcons.calendar_today_outlined,
                        floatingLabel: 'MM/DD/YYYY',
                      ),
                      validator: validateBirthdate,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_error case final message?) ...[
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        message,
                        style: const TextStyle(color: profileDanger),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  SizedBox(
                    height: 56,
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: profileGreen,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(18),
                        ),
                      ),
                      onPressed: _saving ? null : _save,
                      icon: const NpIcon(NpIcons.save_outlined),
                      label: Semantics(
                        liveRegion: _saving,
                        child: Text(
                          _saving ? 'Saving…' : 'Save Changes',
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 56,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: profileInk,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(18),
                        ),
                      ),
                      onPressed: _saving
                          ? null
                          : () => Navigator.of(context).pop(),
                      child: const Text(
                        'Cancel',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
