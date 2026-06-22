import 'package:flutter/widgets.dart';

/// Beegii palette — mirrors the CSS custom properties in `Beegii App.html`.
///
/// Neutrals are warm-tinted; the brand accent is "honey" amber by default but
/// can be swapped (see [AccentSwatch] / [BeegiiAccents]).
class BeegiiColors {
  BeegiiColors._();

  // Surfaces / neutrals --------------------------------------------------
  static const Color bg = Color(0xFFFAF9F6); // app background
  static const Color surface = Color(0xFFFFFFFF); // cards / sheets
  static const Color ink = Color(0xFF1B1E22); // primary text
  static const Color ink2 = Color(0xFF5A6068); // secondary text
  static const Color ink3 = Color(0xFF8E949C); // tertiary text
  static const Color ink4 = Color(0xFFBFC3C9); // disabled / faint
  static const Color line = Color(0xFFECECEB); // hairline borders
  static const Color hair = Color(0x0F1B1E22); // rgba(27,30,34,.06)

  // Default accent (honey) ----------------------------------------------
  static const Color accent = Color(0xFFE89A2C);
  static const Color accentDeep = Color(0xFFB6730C);
  static const Color accentSoft = Color(0xFFFBE7BE);
  static const Color accentInk = Color(0xFF6E4710);

  // Dark dock / phone chrome --------------------------------------------
  static const Color dock = Color(0xFF262528);
  static const Color dockEdge = Color(0xFF0B0C0E);

  // Semantic-ish ---------------------------------------------------------
  static const Color star = Color(0xFFE89A2C);
  static const Color success = Color(0xFF2E8F58);
  static const Color good = Color(0xFF1F9D57); // booked / done states
  static const Color goodSoft = Color(0xFFE5F4EB);
  static const Color danger = Color(0xFFD26F4F);
  static const Color fun = Color(0xFFD2622F); // logout / notifications

  // Honey-tinted shadow base used by elevation tokens.
  static const Color shadowBase = Color(0xFF2A1F12); // rgba(42,31,18, …)
}

/// A full accent triple (base / deep / soft) the brand can switch between.
/// Matches the `ACCENTS` map in `Beegii App.html`.
@immutable
class AccentSwatch {
  const AccentSwatch({
    required this.name,
    required this.base,
    required this.deep,
    required this.soft,
  });

  final String name;
  final Color base;
  final Color deep;
  final Color soft;

  /// Readable ink to lay over [base] (the honey/green accents want dark ink,
  /// they are bright; deeper ones want white). Kept simple per design.
  Color get onBase => const Color(0xFF3A2400);
}

class BeegiiAccents {
  BeegiiAccents._();

  static const honey = AccentSwatch(
    name: 'Honey',
    base: Color(0xFFE89A2C),
    deep: Color(0xFFB6730C),
    soft: Color(0xFFFBE7BE),
  );
  static const clay = AccentSwatch(
    name: 'Clay',
    base: Color(0xFFD26F4F),
    deep: Color(0xFF9E4A2E),
    soft: Color(0xFFF6E0D5),
  );
  static const azure = AccentSwatch(
    name: 'Azure',
    base: Color(0xFF3667B0),
    deep: Color(0xFF244B86),
    soft: Color(0xFFE2EAF4),
  );
  static const fern = AccentSwatch(
    name: 'Fern',
    base: Color(0xFF2E8F58),
    deep: Color(0xFF1F6B40),
    soft: Color(0xFFE5F4EB),
  );

  static const List<AccentSwatch> all = [honey, clay, azure, fern];
}
