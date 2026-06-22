import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// Builds a [LinearGradient] from two stops + a CSS gradient angle (deg).
///
/// CSS angle convention: 0° points to top, 90° to right, 180° to bottom.
LinearGradient cssGradient(double angleDeg, List<Color> colors) {
  final r = angleDeg * math.pi / 180;
  final end = Alignment(math.sin(r), -math.cos(r));
  return LinearGradient(begin: -end, end: end, colors: colors);
}

/// All named gradients used across the Beegii mockups.
class BeegiiGradients {
  BeegiiGradients._();

  // Reel / tile gradient classes g1..g6 (165°) ---------------------------
  static final g1 = cssGradient(165, const [
    Color(0xFFD2C193),
    Color(0xFF6E4F2C),
  ]);
  static final g2 = cssGradient(165, const [
    Color(0xFFF4BFA4),
    Color(0xFFB84A2C),
  ]);
  static final g3 = cssGradient(165, const [
    Color(0xFFF7CE7C),
    Color(0xFFD2683F),
  ]);
  static final g4 = cssGradient(165, const [
    Color(0xFF4A4038),
    Color(0xFF15171A),
  ]);
  static final g5 = cssGradient(165, const [
    Color(0xFF7FA7CE),
    Color(0xFF36608F),
  ]);
  static final g6 = cssGradient(165, const [
    Color(0xFF9A90D6),
    Color(0xFF4F4690),
  ]);

  static final Map<String, LinearGradient> _byClass = {
    'g1': g1,
    'g2': g2,
    'g3': g3,
    'g4': g4,
    'g5': g5,
    'g6': g6,
  };

  static LinearGradient byClass(String name) => _byClass[name] ?? g1;

  // Destination gradients (135°) — get-inspired + trip cards -------------
  static final Map<String, LinearGradient> destination = {
    'bali': cssGradient(135, const [Color(0xFF3E8E5A), Color(0xFF1F6B40)]),
    'bangkok': cssGradient(135, const [Color(0xFFD26F4F), Color(0xFF9E4A2E)]),
    'penang': cssGradient(135, const [Color(0xFFE8B45A), Color(0xFF9C5F08)]),
    'tokyo': cssGradient(135, const [Color(0xFF7268B8), Color(0xFF3A3463)]),
    'hcmc': cssGradient(135, const [Color(0xFF3667B0), Color(0xFF1F3F70)]),
    'seoul': cssGradient(135, const [Color(0xFFC75D3C), Color(0xFF7E371E)]),
    'lombok': cssGradient(135, const [Color(0xFF2F8F8C), Color(0xFF176361)]),
    'chiangmai': cssGradient(135, const [Color(0xFF6E8B3D), Color(0xFF3F5520)]),
    'danang': cssGradient(135, const [Color(0xFFC99A2E), Color(0xFF8A6311)]),
  };

  // Category gradients (135°) — planner stories hero/thumbs -------------
  static final Map<String, LinearGradient> category = {
    'cat-food': cssGradient(135, const [Color(0xFFF4BFA4), Color(0xFFD26F4F)]),
    'cat-luxury': cssGradient(135, const [
      Color(0xFF4A4038),
      Color(0xFF1B1E22),
    ]),
    'cat-trail': cssGradient(135, const [Color(0xFFD2C193), Color(0xFF8A7654)]),
    'cat-adventure': cssGradient(135, const [
      Color(0xFF86C096),
      Color(0xFF3E8E5A),
    ]),
    'cat-sunset': cssGradient(135, const [
      Color(0xFFF7CE7C),
      Color(0xFFE0734F),
    ]),
    'cat-stay': cssGradient(135, const [Color(0xFF7FA7CE), Color(0xFF3667B0)]),
  };

  static LinearGradient cat(String name) =>
      category[name] ?? category['cat-trail']!;

  /// Neutral dark gradient (middle reel tile in the destination sheet strip).
  static final cssDark = cssGradient(135, const [
    Color(0xFF2A3038),
    Color(0xFF171B20),
  ]);
}
