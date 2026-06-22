import 'package:flutter/widgets.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';

/// Typography system mirroring `Beegii App.html`:
///  - DM Sans       → UI / body  (400,500,600,700)
///  - Spectral      → display / editorial serif (500,600,700,800 + italic 500)
///  - JetBrains Mono→ mono / eyebrows / prices (500)
class BeegiiType {
  BeegiiType._();

  /// Emoji fonts to fall back to (DM Sans/Spectral/Mono carry no emoji glyphs,
  /// so flags and pictographs would render as tofu without this).
  static const List<String> emojiFallback = [
    'Apple Color Emoji',
    'Noto Color Emoji',
  ];

  /// Dedicated emoji style — the primary family must BE an emoji font, since
  /// fallback-only does not work once a runtime (Google Fonts) family is primary.
  static TextStyle emoji({double size = 14}) => TextStyle(
    fontFamily: 'Apple Color Emoji',
    fontFamilyFallback: const ['Noto Color Emoji'],
    fontSize: size,
    height: 1.1,
  );

  // ---- Font builders ---------------------------------------------------
  static TextStyle sans({
    double size = 14,
    FontWeight weight = FontWeight.w500,
    Color color = BeegiiColors.ink,
    double? height,
    double? letterSpacing,
    FontStyle? fontStyle,
    TextDecoration? decoration,
    bool shadow = false,
  }) => GoogleFonts.dmSans(
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
    letterSpacing: letterSpacing,
    fontStyle: fontStyle,
    decoration: decoration,
    decorationColor: color,
    shadows: shadow
        ? const [
            Shadow(
              color: Color(0x66000000),
              blurRadius: 4,
              offset: Offset(0, 1),
            ),
          ]
        : null,
  ).copyWith(fontFamilyFallback: emojiFallback);

  static TextStyle serif({
    double size = 22,
    FontWeight weight = FontWeight.w600,
    Color color = BeegiiColors.ink,
    double? height,
    double? letterSpacing,
    FontStyle? fontStyle,
  }) => GoogleFonts.spectral(
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
    letterSpacing: letterSpacing,
    fontStyle: fontStyle,
  ).copyWith(fontFamilyFallback: emojiFallback);

  static TextStyle mono({
    double size = 11,
    FontWeight weight = FontWeight.w500,
    Color color = BeegiiColors.ink2,
    double? height,
    double? letterSpacing = 0.4,
  }) => GoogleFonts.jetBrainsMono(
    fontSize: size,
    fontWeight: weight,
    color: color,
    height: height,
    letterSpacing: letterSpacing,
  ).copyWith(fontFamilyFallback: emojiFallback);

  // ---- Named roles -----------------------------------------------------
  /// Big editorial serif headline (screen titles, hero).
  static TextStyle get display =>
      serif(size: 30, weight: FontWeight.w700, height: 1.05);

  /// Section / card serif title.
  static TextStyle get title =>
      serif(size: 20, weight: FontWeight.w700, height: 1.12);

  static TextStyle get titleSm =>
      serif(size: 17, weight: FontWeight.w700, height: 1.15);

  /// All-caps mono eyebrow label.
  static TextStyle get eyebrow => mono(
    size: 10.5,
    weight: FontWeight.w500,
    color: BeegiiColors.ink3,
    letterSpacing: 1.2,
  );

  static TextStyle get body => sans(
    size: 14.5,
    weight: FontWeight.w500,
    color: BeegiiColors.ink2,
    height: 1.45,
  );

  static TextStyle get bodyStrong => sans(
    size: 14.5,
    weight: FontWeight.w600,
    color: BeegiiColors.ink,
    height: 1.4,
  );

  static TextStyle get label =>
      sans(size: 13, weight: FontWeight.w600, color: BeegiiColors.ink);

  static TextStyle get labelSm =>
      sans(size: 11.5, weight: FontWeight.w600, color: BeegiiColors.ink2);

  static TextStyle get caption => sans(
    size: 12,
    weight: FontWeight.w500,
    color: BeegiiColors.ink3,
    height: 1.4,
  );
}
