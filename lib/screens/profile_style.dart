import 'package:flutter/material.dart';

import '../app_theme.dart';

/// Look shared by Profile, Edit Account Details and Settings.
// Same page background as every other tab (Home, Search, Map, Orders).
const profileMint = NpColors.background;
const profileInk = Color(0xFF17332A);
const profileMuted = Color(0xFF55655F);
const profileGreen = Color(0xFF2E7D32);
const profileDeepGreen = Color(0xFF1F6B45);
const profileSoftGreen = Color(0xFFA7F0C8);
const profileDanger = Color(0xFFB3261E);

BoxDecoration profileCardDecoration() => BoxDecoration(
  color: Colors.white,
  borderRadius: BorderRadius.circular(24),
  boxShadow: const [
    BoxShadow(color: Color(0x0F000000), blurRadius: 8, offset: Offset(0, 2)),
  ],
);

AppBar profileAppBar(
  String title, {
  List<Widget> actions = const [],
  Widget? leading,
  bool bigTitle = false,
}) => AppBar(
  backgroundColor: profileMint,
  surfaceTintColor: Colors.transparent,
  elevation: 0,
  scrolledUnderElevation: 0,
  centerTitle: false,
  leading: leading,
  titleSpacing: leading == null && !bigTitle ? null : (bigTitle ? 20 : null),
  title: Text(
    title,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    style: TextStyle(
      color: profileInk,
      fontWeight: FontWeight.w800,
      fontSize: bigTitle ? 26 : 20,
    ),
  ),
  actions: actions,
);
