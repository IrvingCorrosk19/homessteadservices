import "package:flutter/material.dart";

class HomesteadColors {
  static const navy = Color(0xFF0B1F33);
  static const cream = Color(0xFFF7F1E8);
  static const charcoal = Color(0xFF243040);
  static const mist = Color(0xFF7A8696);
  static const accent = Color(0xFFC45C26);
  static const accentDeep = Color(0xFF9A3F12);
  static const success = Color(0xFF1F6B4A);
  static const danger = Color(0xFF9B1C1C);
}

ThemeData buildHomesteadTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: ColorScheme.fromSeed(
      seedColor: HomesteadColors.navy,
      primary: HomesteadColors.navy,
      secondary: HomesteadColors.accent,
      surface: HomesteadColors.cream,
    ),
    scaffoldBackgroundColor: HomesteadColors.cream,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: HomesteadColors.navy,
      foregroundColor: HomesteadColors.cream,
      elevation: 0,
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: Colors.white,
      selectedItemColor: HomesteadColors.accentDeep,
      unselectedItemColor: HomesteadColors.mist,
      type: BottomNavigationBarType.fixed,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: HomesteadColors.navy,
        foregroundColor: HomesteadColors.cream,
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: HomesteadColors.navy,
        minimumSize: const Size.fromHeight(48),
        side: const BorderSide(color: Color(0x330B1F33)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0x140B1F33)),
      ),
    ),
  );
}
