import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../features/auth/presentation/auth_view_model.dart';
import '../features/cart/presentation/cart_view_model.dart';
import '../utils/formatters.dart';
import 'home.dart';
import 'policies_screen.dart';
import 'forgot_password_screen.dart';

const _green = Color(0xFF2E7D32);
const _deepGreen = Color(0xFF1F6B45);
const _ink = Color(0xFF17332A);
const _muted = Color(0xFF61726B);

class AuthPortalScreen extends StatefulWidget {
  const AuthPortalScreen({super.key});

  @override
  State<AuthPortalScreen> createState() => _AuthPortalScreenState();
}

class _AuthPortalScreenState extends State<AuthPortalScreen> {
  final _loginFormKey = GlobalKey<FormState>();
  final _registerFormKey = GlobalKey<FormState>();
  final _errorKey = GlobalKey();
  final _loginEmail = TextEditingController();
  final _loginPassword = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  final _otpFocus = FocusNode();

  bool _isLogin = true;
  int _step = 0;
  bool _showLoginPassword = false;
  bool _showRegisterPassword = false;
  bool _loading = false;
  bool _testInbox = false;
  bool _agreed = false;
  bool _agreedError = false;
  DateTime _formStart = DateTime.now();
  String? _error;
  Timer? _resendTimer;
  int _resendLeft = 0;

  @override
  void initState() {
    super.initState();
    _password.addListener(_passwordChanged);
    _otp.addListener(_passwordChanged);
    _otpFocus.addListener(_passwordChanged);
  }

  void _startResendCountdown() {
    _resendTimer?.cancel();
    setState(() => _resendLeft = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted || _resendLeft <= 1) {
        timer.cancel();
        if (mounted) setState(() => _resendLeft = 0);
        return;
      }
      setState(() => _resendLeft--);
    });
  }

  void _passwordChanged() {
    setState(() {});
    if (!_isLogin &&
        _step == 2 &&
        !_loading &&
        RegExp(r'^\d{6}$').hasMatch(_otp.text)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_loading && _step == 2) _verifyAndRegister();
      });
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    setState(() => _error = message);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_errorKey.currentContext case final banner?) {
        Scrollable.ensureVisible(banner);
      }
    });
  }

  @override
  void dispose() {
    for (final controller in [
      _loginEmail,
      _loginPassword,
      _name,
      _email,
      _password,
      _otp,
    ]) {
      controller.dispose();
    }
    _resendTimer?.cancel();
    _otpFocus.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (_loading || !(_loginFormKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await context.read<AuthViewModel>().login(
        email: _loginEmail.text.trim(),
        password: _loginPassword.text,
      );
      if (mounted) await _goHome();
    } on AuthException catch (error) {
      _showError(error.message);
    } catch (_) {
      _showError('Could not log in. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _register() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final authService = context.read<AuthViewModel>();
    try {
      await authService.register(
        fullName: _name.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
        acceptedTerms: _agreed,
        company: '',
        formMs: DateTime.now().difference(_formStart).inMilliseconds,
      );
      if (!mounted) return;
      _loginEmail.text = _email.text;
      _loginPassword.text = _password.text;
      await authService.login(
        email: _email.text.trim(),
        password: _password.text,
      );
      if (mounted) await _goHome();
    } on AuthException catch (error) {
      _showError(error.message);
    } catch (_) {
      _showError('Could not create your account. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _goHome() async {
    try {
      await context.read<CartViewModel?>()?.loadCart();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Signed in. Your saved cart could not be loaded.'),
          ),
        );
      }
    }
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (homeContext) => HomeScreen(
          onLogout: () => Navigator.of(
            homeContext,
          ).pushNamedAndRemoveUntil('/login', (_) => false),
        ),
      ),
    );
  }

  Future<void> _continueSignup() async {
    if (_loading || !(_registerFormKey.currentState?.validate() ?? false)) {
      return;
    }
    FocusScope.of(context).unfocus();
    if (_step == 1) {
      if (!_agreed) {
        setState(() => _agreedError = true);
        return;
      }
      await _sendOtp();
      return;
    }
    setState(() => _step++);
  }

  Future<void> _sendOtp() async {
    final authService = context.read<AuthViewModel>();
    setState(() {
      _loading = true;
      _error = null;
      _otp.clear();
    });
    try {
      final delivery = await authService.sendOtp(email: _email.text.trim());
      if (!mounted) return;
      setState(() {
        _step = 2;
        _testInbox = delivery.testInbox;
      });
      _startResendCountdown();

      final devCode = delivery.devCode;
      if (devCode != null && devCode.length == 6) {
        _otp.text = devCode;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Local development: verification code filled in automatically.',
            ),
            backgroundColor: _deepGreen,
            duration: const Duration(seconds: 6),
          ),
        );
      } else {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _isLogin == false && _step == 2) {
            _otpFocus.requestFocus();
          }
        });
      }
    } on AuthException catch (error) {
      if (error.statusCode == 400 && _step == 1) {
        setState(() => _step = 0);
        _showError(emailErrorText);
      } else {
        _showError(error.message);
      }
    } catch (_) {
      _showError('Unable to send the verification code. Try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyAndRegister() async {
    if (_loading) return;
    final code = _otp.text;
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      _showError('Enter the 6-digit verification code.');
      return;
    }
    FocusScope.of(context).unfocus();
    final authService = context.read<AuthViewModel>();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await authService.verifyOtp(email: _email.text.trim(), code: code);
      if (!mounted) return;
      await _register();
    } on AuthException catch (error) {
      _otp.clear();
      _showError(error.message);
    } catch (_) {
      _showError('Unable to verify the code. Try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resendOtp() async {
    if (_loading) return;
    final authService = context.read<AuthViewModel>();
    setState(() {
      _loading = true;
      _error = null;
      _otp.clear();
    });
    try {
      final delivery = await authService.resendOtp(email: _email.text.trim());
      if (mounted) {
        setState(() => _testInbox = delivery.testInbox);
        _startResendCountdown();
        final devCode = delivery.devCode;
        if (devCode != null && devCode.length == 6) {
          _otp.text = devCode;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'Local development: new code filled in automatically.',
              ),
              backgroundColor: _deepGreen,
              duration: const Duration(seconds: 6),
            ),
          );
        } else {
          _otpFocus.requestFocus();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('A new code has been sent.')),
          );
        }
      }
    } on AuthException catch (error) {
      _showError(error.message);
    } catch (_) {
      _showError('Unable to resend the verification code. Try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pasteCode() async {
    final code = (await Clipboard.getData(Clipboard.kTextPlain))?.text?.trim();
    if (!mounted || _loading || _isLogin || _step != 2) return;
    if (code == null || !RegExp(r'^[0-9]{6}$').hasMatch(code)) {
      _showError('Copy a 6-digit code, then tap Paste code.');
      return;
    }
    _otp.text = code;
    _otpFocus.unfocus();
    setState(() => _error = null);
  }

  InputDecoration _decoration(String label, NpIconData icon, {Widget? suffix}) =>
      InputDecoration(
        labelText: label,
        prefixIcon: NpIcon(icon),
        suffixIcon: suffix,
        constraints: const BoxConstraints(minHeight: 56),
        errorMaxLines: 3,
      );

  Widget _header({required String title, required String subtitle}) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(
          fontSize: 30,
          height: 1.15,
          fontWeight: FontWeight.w800,
          color: _ink,
        ),
      ),
      if (subtitle.isNotEmpty) ...[
        const SizedBox(height: 8),
        Text(
          subtitle,
          style: const TextStyle(fontSize: 15, height: 1.45, color: _muted),
        ),
      ],
    ],
  );

  Widget _loginView() => Form(
    key: _loginFormKey,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(header: true, label: 'Log in', child: const SizedBox(height: 12)),
        TextFormField(
          controller: _loginEmail,
          readOnly: _loading,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          autofillHints: const [AutofillHints.email],
          decoration: _decoration('Email address', NpIcons.email_outlined),
          validator: validateEmailAddress,
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: _loginPassword,
          readOnly: _loading,
          obscureText: !_showLoginPassword,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.password],
          onFieldSubmitted: (_) => _login(),
          decoration: _decoration(
            'Password',
            NpIcons.lock_outline,
            suffix: IconButton(
              tooltip: _showLoginPassword ? 'Hide password' : 'Show password',
              icon: NpIcon(
                _showLoginPassword
                    ? NpIcons.visibility_off_outlined
                    : NpIcons.visibility_outlined,
              ),
              onPressed: () =>
                  setState(() => _showLoginPassword = !_showLoginPassword),
            ),
          ),
          validator: (value) =>
              value == null || value.isEmpty ? 'Enter your password' : null,
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: _loading
                ? null
                : () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          ForgotPasswordScreen(email: _loginEmail.text.trim()),
                    ),
                  ),
            child: const Text(
              'Forgot Password?',
              style: TextStyle(color: _deepGreen, fontWeight: FontWeight.w700),
            ),
          ),
        ),
        const SizedBox(height: 24),
        _primaryButton('Log In', _loading ? null : _login),
      ],
    ),
  );

  Widget _signupView() {
    final titles = [
      ('Create your account', ''),
      ('Tell us about you', 'A few details help us serve you better.'),
      (
        _testInbox ? 'Enter test code' : 'Verify your email',
        _testInbox
            ? 'Development test: enter the code sent to the configured test inbox. This does not verify ${_email.text}.'
            : 'Enter the 6-digit code sent to ${_email.text}.',
      ),
    ];
    return Form(
      key: _registerFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                tooltip: 'Back',
                onPressed: _loading
                    ? null
                    : () {
                        if (_step == 0) {
                          FocusScope.of(context).unfocus();
                          setState(() {
                            _isLogin = true;
                            _agreed = false;
                            _agreedError = false;
                            _formStart = DateTime.now();
                            _error = null;
                          });
                          return;
                        }
                        setState(() {
                          _step--;
                          _error = null;
                        });
                      },
                icon: const NpIcon(NpIcons.arrow_back),
              ),
              Expanded(
                child: Text(
                  'Step ${_step + 1} of 3',
                  textAlign: TextAlign.end,
                  style: const TextStyle(
                    color: _deepGreen,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          _StepBar(step: _step),
          const SizedBox(height: 12),
          _header(title: titles[_step].$1, subtitle: titles[_step].$2),
          const SizedBox(height: 28),
          if (_step == 0) ...[
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.email],
              decoration: _decoration('Email address', NpIcons.email_outlined),
              validator: validateEmailAddress,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _password,
              obscureText: !_showRegisterPassword,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.newPassword],
              onFieldSubmitted: (_) => _continueSignup(),
              decoration: _decoration(
                'Create password',
                NpIcons.lock_outline,
                suffix: IconButton(
                  tooltip: _showRegisterPassword
                      ? 'Hide password'
                      : 'Show password',
                  icon: NpIcon(
                    _showRegisterPassword
                        ? NpIcons.visibility_off_outlined
                        : NpIcons.visibility_outlined,
                  ),
                  onPressed: () => setState(
                    () => _showRegisterPassword = !_showRegisterPassword,
                  ),
                ),
              ),
              validator: (value) =>
                  validateNewPassword(value, _email.text, _name.text),
            ),
            _StrengthMeter(password: _password.text),
          ],
          if (_step == 1) ...[
            TextFormField(
              controller: _name,
              readOnly: _loading,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.done,
              autofillHints: const [AutofillHints.name],
              onFieldSubmitted: (_) => _continueSignup(),
              decoration: _decoration('Full name', NpIcons.person_outline),
              validator: (value) {
                final name = value?.trim() ?? '';
                if (name.isEmpty) return 'Enter your full name';
                return name.length <= 100 ? null : 'Use at most 100 characters';
              },
            ),
            const SizedBox(height: 12),
            CheckboxListTile(
              key: const Key('signup-terms'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _agreed,
              onChanged: _loading
                  ? null
                  : (value) => setState(() {
                      _agreed = value ?? false;
                      if (_agreed) _agreedError = false;
                    }),
              title: const Text(
                'I agree to the Privacy and service information',
                style: TextStyle(fontSize: 14),
              ),
              subtitle: _agreedError
                  ? const Text(
                      'Agree to the Privacy and service information to continue.',
                      style: TextStyle(color: Color(0xFFD32F2F), fontSize: 12),
                    )
                  : null,
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const PoliciesScreen(),
                  ),
                ),
                child: const Text('Read the Privacy and service information'),
              ),
            ),
          ],
          if (_step == 2) ...[
            _OtpBoxes(
              controller: _otp,
              focusNode: _otpFocus,
              readOnly: _loading,
              hasError: _error != null,
              onSubmitted: _verifyAndRegister,
            ),
            Center(
              child: TextButton.icon(
                onPressed: _loading ? null : _pasteCode,
                icon: const NpIcon(NpIcons.content_paste_outlined),
                label: const Text('Paste code'),
              ),
            ),
            Center(
              child: TextButton(
                onPressed: _loading
                    ? null
                    : () => setState(() {
                        _step = 0;
                        _error = null;
                        _otp.clear();
                        _resendTimer?.cancel();
                        _resendLeft = 0;
                      }),
                child: const Text('Use a different email'),
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: _resendLeft > 0
                  ? Text(
                      'Resend code in 0:${_resendLeft.toString().padLeft(2, '0')}',
                      style: const TextStyle(
                        color: _muted,
                        fontWeight: FontWeight.w700,
                      ),
                    )
                  : TextButton(
                      onPressed: _loading ? null : _resendOtp,
                      child: const Text(
                        'Resend Code',
                        style: TextStyle(
                          color: _deepGreen,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
            ),
          ],
          const SizedBox(height: 24),
          _primaryButton(
            _step == 2 ? 'Verify & Create Account' : 'Continue',
            _loading
                ? null
                : (_step == 2 ? _verifyAndRegister : () => _continueSignup()),
          ),
        ],
      ),
    );
  }

  Widget _primaryButton(String text, VoidCallback? onPressed) => SizedBox(
    width: double.infinity,
    child: FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(56),
        backgroundColor: _green,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      child: Semantics(
        liveRegion: _loading,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_loading) ...[
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 10),
            ],
            Flexible(
              child: Text(
                _loading ? 'Please wait…' : text,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      body: Stack(
        children: [
          SafeArea(
            child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Image.asset(
                      'assets/images/nearpill_logo.png',
                      width: 96,
                      height: 96,
                      semanticLabel: 'NearPill',
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_error case final message?) ...[
                    Container(
                      key: _errorKey,
                      padding: const EdgeInsets.all(12),
                      color: colors.errorContainer,
                      child: Semantics(
                        liveRegion: true,
                        child: Text(
                          message,
                          style: TextStyle(color: colors.onErrorContainer),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  AutofillGroup(child: _isLogin ? _loginView() : _signupView()),
                  const SizedBox(height: 16),
                  Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        _isLogin
                            ? 'New to NearPill?'
                            : 'Already have an account?',
                        style: const TextStyle(color: _muted),
                      ),
                      TextButton(
                        onPressed: _loading
                            ? null
                            : () {
                                FocusScope.of(context).unfocus();
                                setState(() {
                                  _isLogin = !_isLogin;
                                  _step = 0;
                                  _agreed = false;
                                  _agreedError = false;
                                  _formStart = DateTime.now();
                                  _error = null;
                                });
                              },
                        child: Text(
                          _isLogin ? 'Create account' : 'Log in',
                          style: const TextStyle(
                            color: _deepGreen,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                  TextButton(
                    onPressed: _loading
                        ? null
                        : () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => const PoliciesScreen(),
                            ),
                          ),
                    child: const Text(
                      'Privacy, cancellations and terms',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _muted,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          ),
          ),
        ],
      ),
    );
  }
}

class _StepBar extends StatelessWidget {
  const _StepBar({required this.step});
  final int step;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Row(
      children: [
        for (var i = 0; i < 3; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              height: 5,
              decoration: BoxDecoration(
                color: i <= step ? _green : const Color(0xFFDDE5E1),
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
        ],
      ],
    ),
  );
}

class _StrengthMeter extends StatelessWidget {
  const _StrengthMeter({required this.password});
  final String password;
  @override
  Widget build(BuildContext context) {
    final rules = [
      ('10+ characters', password.length >= 10),
      ('A letter', password.contains(RegExp(r'[A-Za-z]'))),
      ('A number', password.contains(RegExp(r'\d'))),
      (
        'Symbol or 14+ characters',
        password.contains(RegExp(r'[^A-Za-z0-9]')) || password.length >= 14,
      ),
    ];
    final score = rules.where((rule) => rule.$2).length;
    final label = score < 2
        ? 'Weak'
        : score < 4
        ? 'Okay'
        : 'Strong';
    final color = score < 2
        ? const Color(0xFFD32F2F)
        : score < 4
        ? const Color(0xFFF59E0B)
        : _green;
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            password.isEmpty ? 'Use at least 10 characters with a letter and a number.' : label,
            style: TextStyle(
              color: password.isEmpty ? _muted : color,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Semantics(
            label: 'Password strength',
            value: password.isEmpty ? 'Not set' : label,
            child: ExcludeSemantics(
              child: Row(
                children: [
                  for (var i = 0; i < 4; i++) ...[
                    if (i > 0) const SizedBox(width: 4),
                    Expanded(
                      child: Container(
                        height: 6,
                        decoration: BoxDecoration(
                          color: i < score ? color : Colors.grey.shade200,
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 12,
            runSpacing: 2,
            children: [
              for (final rule in rules)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    NpIcon(
                      rule.$2 ? NpIcons.check_circle : NpIcons.circle_outlined,
                      size: 14,
                      color: rule.$2 ? _green : _muted,
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        rule.$1,
                        style: TextStyle(
                          fontSize: 12,
                          color: rule.$2 ? _green : _muted,
                        ),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Six visible digit boxes over one real [TextField], so paste, autofill and
/// the one-time-code hint keep working exactly as before.
class _OtpBoxes extends StatelessWidget {
  const _OtpBoxes({
    required this.controller,
    required this.focusNode,
    required this.readOnly,
    required this.hasError,
    required this.onSubmitted,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool readOnly;
  final bool hasError;
  final VoidCallback onSubmitted;

  @override
  Widget build(BuildContext context) {
    final code = controller.text;
    final active = focusNode.hasFocus ? math.min(code.length, 5) : -1;
    return Semantics(
      container: true,
      label: 'Verification code',
      child: SizedBox(
        height: 56,
        child: Stack(
          children: [
            Positioned.fill(
              child: ExcludeSemantics(
                child: Row(
                  children: [
                    for (var i = 0; i < 6; i++) ...[
                      if (i > 0) const SizedBox(width: 8),
                      Expanded(
                        child: Container(
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: hasError
                                  ? const Color(0xFFD32F2F)
                                  : i == active
                                  ? _green
                                  : const Color(0xFFD5DEDA),
                              width: i == active ? 2 : 1,
                            ),
                          ),
                          child: Text(
                            i < code.length ? code[i] : '',
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                              color: _ink,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            Positioned.fill(
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                readOnly: readOnly,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                maxLength: 6,
                showCursor: false,
                enableInteractiveSelection: false,
                style: const TextStyle(color: Colors.transparent),
                cursorColor: Colors.transparent,
                decoration: const InputDecoration(
                  counterText: '',
                  filled: false,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
                onSubmitted: (_) => onSubmitted(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
