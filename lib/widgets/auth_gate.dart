import 'package:flutter/material.dart';

import '../screens/onboarding_screen.dart';
import '../screens/home.dart';
import '../features/auth/presentation/auth_view_model.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({
    super.key,
    required this.authService,
    required this.navigatorKey,
  });

  final AuthViewModel authService;
  final GlobalKey<NavigatorState> navigatorKey;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _isCheckingSession = true;
  bool _isAuthenticated = false;

  @override
  void initState() {
    super.initState();
    _checkSession();
  }

  Future<void> _checkSession() async {
    try {
      final loggedIn = await widget.authService.isLoggedIn();
      if (!mounted) {
        return;
      }
      setState(() {
        _isCheckingSession = false;
        _isAuthenticated = loggedIn;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isCheckingSession = false;
        _isAuthenticated = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isCheckingSession) {
      return Scaffold(
        body: Container(
          color: Colors.white,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Image.asset(
            'assets/images/nearpill_logo.png',
            width: 140,
            height: 140,
            semanticLabel: 'Loading NearPill',
          ),
        ),
      );
    }

    if (_isAuthenticated) {
      return HomeScreen(
        onLogout: () {
          setState(() => _isAuthenticated = false);
        },
      );
    }

    return const OnboardingScreen();
  }
}
