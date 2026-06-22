import 'package:flutter/widgets.dart';

/// Spacing scale (px == logical px). Loosely 4-based, matching the mockups.
class Insets {
  Insets._();
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double huge = 32;

  /// Standard horizontal screen gutter used across screens.
  static const double gutter = 18;
}

/// Corner radii.
class Radii {
  Radii._();
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double pill = 999;

  static BorderRadius all(double r) => BorderRadius.circular(r);
}

/// Elevation tokens — translated from the CSS `--sh-2` / `--sh-3` variables.
class Shadows {
  Shadows._();

  /// Soft card shadow (`--sh-2`).
  static const List<BoxShadow> sh2 = [
    BoxShadow(
      color: Color(0x0F2A1F12), // rgba(42,31,18,.06)
      offset: Offset(0, 1),
      blurRadius: 2,
    ),
    BoxShadow(
      color: Color(0x1F2A1F12), // rgba(42,31,18,.12)
      offset: Offset(0, 6),
      blurRadius: 16,
      spreadRadius: -8,
    ),
  ];

  /// Lifted sheet / floating shadow (`--sh-3`).
  static const List<BoxShadow> sh3 = [
    BoxShadow(
      color: Color(0x1A2A1F12), // rgba(42,31,18,.10)
      offset: Offset(0, 4),
      blurRadius: 10,
      spreadRadius: -4,
    ),
    BoxShadow(
      color: Color(0x382A1F12), // rgba(42,31,18,.22)
      offset: Offset(0, 24),
      blurRadius: 48,
      spreadRadius: -20,
    ),
  ];

  /// Dark dock shadow.
  static const List<BoxShadow> dock = [
    BoxShadow(
      color: Color(0x8C000000),
      offset: Offset(0, 8),
      blurRadius: 22,
      spreadRadius: -10,
    ),
    BoxShadow(
      color: Color(0x66000000),
      offset: Offset(0, 2),
      blurRadius: 6,
      spreadRadius: -2,
    ),
  ];
}

/// Motion tokens.
class Motion {
  Motion._();
  // Primary brand easing — cubic-bezier(.2,.8,.2,1)
  static const Curve ease = Cubic(0.2, 0.8, 0.2, 1);
  // Dock / pill spring-ish slide — cubic-bezier(.32,.72,0,1)
  static const Curve slide = Cubic(0.32, 0.72, 0, 1);
  // FAB pop with overshoot — cubic-bezier(.34,1.4,.5,1)
  static const Curve pop = Cubic(0.34, 1.4, 0.5, 1);

  static const Duration fast = Duration(milliseconds: 200);
  static const Duration med = Duration(milliseconds: 340);
  static const Duration slow = Duration(milliseconds: 420);
}

/// Layout constants drawn from the phone shell.
class Layout {
  Layout._();
  static const double dockBottom = 24; // dock distance from bottom
  static const double dockHeight = 50;
  static const double tabbarWidth = 206;

  /// Bottom padding scroll views reserve so the floating dock never covers
  /// content (≈ dock height + offset).
  static const double dockReserve = 96;
}
