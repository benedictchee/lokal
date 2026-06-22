import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';
import 'tokens.dart';

/// Builds the app [ThemeData] for a given [accent].
ThemeData buildBeegiiTheme(AccentSwatch accent) {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: BeegiiColors.bg,
    splashFactory: InkSparkle.splashFactory,
  );

  final scheme =
      ColorScheme.fromSeed(
        seedColor: accent.base,
        brightness: Brightness.light,
      ).copyWith(
        primary: accent.base,
        onPrimary: accent.onBase,
        surface: BeegiiColors.surface,
        onSurface: BeegiiColors.ink,
        surfaceContainerLowest: BeegiiColors.surface,
      );

  return base.copyWith(
    colorScheme: scheme,
    scaffoldBackgroundColor: BeegiiColors.bg,
    canvasColor: BeegiiColors.bg,
    textTheme: GoogleFonts.dmSansTextTheme(
      base.textTheme,
    ).apply(bodyColor: BeegiiColors.ink, displayColor: BeegiiColors.ink),
    dividerColor: BeegiiColors.line,
    iconTheme: const IconThemeData(color: BeegiiColors.ink, size: 22),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.android: _FadeThroughBuilder(),
      },
    ),
    splashColor: accent.soft.withValues(alpha: 0.4),
    highlightColor: BeegiiColors.hair,
  );
}

/// A lightweight fade+slide page transition for Android, close to the soft
/// motion used throughout the mockups.
class _FadeThroughBuilder extends PageTransitionsBuilder {
  const _FadeThroughBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final curved = CurvedAnimation(
      parent: animation,
      curve: Motion.ease,
      reverseCurve: Motion.ease,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.018),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}
