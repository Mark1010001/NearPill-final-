import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';

/// NearPill design tokens. Every screen reads from these so headers, cards,
/// chips, tabs and the bottom navigation stay visually consistent.
abstract final class NpColors {
  static const primary = Color(0xFF2E7D32); // original NearPill green
  static const primaryDark = Color(0xFF1B5E20);
  static const primarySoft = Color(0xFFE8F5E9); // icon tiles, pills
  static const primaryBorder = Color(0xFFC8E6C9);
  static const background = Color(0xFFF8FAF9);
  static const surface = Colors.white;
  static const surfaceSubtle = Color(0xFFF1F5F3);
  static const ink = Color(0xFF0F172A); // slate-900
  static const muted = Color(0xFF526071); // >= 4.5:1 on surface & background
  static const faint = Color(0xFF94A3B8); // slate-400
  static const line = Color(0xFFDCE5E2);
  static const controlBorder = Color(0xFF7D8C86); // >= 3:1 component border
  static const disabledSurface = Color(0xFFE9EEF2);
  static const disabledBorder = Color(0xFF758292); // >= 3:1 on disabledSurface
  static const disabledInk = Color(0xFF475569); // >= 4.5:1 on disabledSurface
  static const cardShadow = Color(0x0A0F172A);
  static const barShadow = Color(0x120F172A);
  static const warning = Color(0xFFB45309);
  static const warningSoft = Color(0xFFFFF8E1);
  static const danger = Color(0xFFDC2626);
  static const dangerSoft = Color(0xFFFEE9E9);
}

const _primaryGreen = NpColors.primary;

final appThemeData = ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: _primaryGreen,
    primary: _primaryGreen,
    onSurface: NpColors.ink,
    onSurfaceVariant: NpColors.muted,
    surface: NpColors.background,
    error: NpColors.danger,
  ),
  scaffoldBackgroundColor: NpColors.background,
  textTheme: const TextTheme(
    headlineSmall: TextStyle(
      fontSize: 28,
      fontWeight: FontWeight.w800,
      color: NpColors.ink,
      letterSpacing: -0.5,
    ),
    titleLarge: TextStyle(
      fontSize: 22,
      fontWeight: FontWeight.w800,
      color: NpColors.ink,
    ),
    titleMedium: TextStyle(
      fontSize: 18,
      fontWeight: FontWeight.w700,
      color: NpColors.ink,
    ),
    titleSmall: TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w700,
      color: NpColors.ink,
    ),
    bodyLarge: TextStyle(color: NpColors.ink),
    bodyMedium: TextStyle(color: NpColors.muted),
    labelLarge: TextStyle(fontWeight: FontWeight.w700),
  ),
  actionIconTheme: ActionIconThemeData(
    backButtonIconBuilder: (context) => const NpIcon(NpIcons.arrow_back),
    closeButtonIconBuilder: (context) => const NpIcon(NpIcons.close),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: NpColors.background,
    surfaceTintColor: Colors.transparent,
    elevation: 0,
    scrolledUnderElevation: 0,
    centerTitle: false,
    toolbarHeight: 64,
    titleSpacing: 20,
    foregroundColor: NpColors.ink,
    titleTextStyle: TextStyle(
      fontSize: 28,
      fontWeight: FontWeight.w800,
      color: NpColors.ink,
      letterSpacing: -0.5,
    ),
    iconTheme: IconThemeData(color: NpColors.ink),
    actionsIconTheme: IconThemeData(color: NpColors.ink),
  ),
  cardTheme: CardThemeData(
    color: NpColors.surface,
    surfaceTintColor: Colors.transparent,
    margin: EdgeInsets.zero,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(20),
      side: const BorderSide(color: NpColors.line),
    ),
    elevation: 0,
    shadowColor: NpColors.cardShadow,
  ),
  dividerTheme: const DividerThemeData(color: NpColors.line, space: 1),
  tabBarTheme: const TabBarThemeData(
    labelColor: NpColors.primaryDark,
    unselectedLabelColor: NpColors.muted,
    indicatorColor: NpColors.primaryDark,
    indicatorSize: TabBarIndicatorSize.tab,
    dividerColor: NpColors.line,
    labelStyle: TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
    unselectedLabelStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
  ),
  navigationBarTheme: NavigationBarThemeData(
    height: 68,
    backgroundColor: Colors.white,
    surfaceTintColor: Colors.transparent,
    indicatorColor: NpColors.primarySoft,
    indicatorShape: const StadiumBorder(),
    elevation: 0,
    labelTextStyle: WidgetStateProperty.resolveWith(
      (states) => TextStyle(
        fontSize: 11,
        fontWeight: states.contains(WidgetState.selected)
            ? FontWeight.w800
            : FontWeight.w500,
        color: states.contains(WidgetState.selected)
            ? NpColors.primaryDark
            : NpColors.muted,
      ),
    ),
    iconTheme: WidgetStateProperty.resolveWith(
      (states) => IconThemeData(
        size: 24,
        color: states.contains(WidgetState.selected)
            ? NpColors.primaryDark
            : NpColors.muted,
      ),
    ),
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: _primaryGreen,
      foregroundColor: Colors.white,
      disabledBackgroundColor: NpColors.disabledSurface,
      disabledForegroundColor: NpColors.disabledInk,
      minimumSize: const Size(0, 52),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
      textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: _primaryGreen,
      foregroundColor: Colors.white,
      disabledBackgroundColor: NpColors.disabledSurface,
      disabledForegroundColor: NpColors.disabledInk,
      minimumSize: const Size(0, 52),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
      textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: NpColors.ink,
      side: const BorderSide(color: NpColors.line, width: 1.5),
      minimumSize: const Size(48, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
      textStyle: const TextStyle(fontWeight: FontWeight.w700),
    ),
  ),
  textButtonTheme: TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: NpColors.primary,
      minimumSize: const Size(48, 48),
      textStyle: const TextStyle(fontWeight: FontWeight.w700),
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: Colors.white,
    contentPadding: const EdgeInsets.symmetric(vertical: 16, horizontal: 18),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: NpColors.line),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: NpColors.line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: _primaryGreen, width: 1.5),
    ),
    hintStyle: const TextStyle(color: NpColors.faint),
  ),
  chipTheme: ChipThemeData(
    backgroundColor: Colors.white,
    selectedColor: NpColors.primary,
    disabledColor: NpColors.disabledSurface,
    surfaceTintColor: Colors.transparent,
    side: const BorderSide(color: NpColors.controlBorder),
    shape: const StadiumBorder(),
    labelStyle: const TextStyle(
      color: NpColors.ink,
      fontWeight: FontWeight.w700,
    ),
    secondaryLabelStyle: const TextStyle(
      color: Colors.white,
      fontWeight: FontWeight.w700,
    ),
    checkmarkColor: Colors.white,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
  ),
  snackBarTheme: SnackBarThemeData(
    behavior: SnackBarBehavior.floating,
    backgroundColor: NpColors.ink,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
  ),
  iconTheme: const IconThemeData(color: _primaryGreen),
);
