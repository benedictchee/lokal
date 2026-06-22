import 'package:flutter/material.dart';

import '../theme/colors.dart';
import '../theme/typography.dart';

/// What centered glyph (if any) a [BeegiiMedia] tile shows.
enum MediaGlyph { none, pin, play, image, camera }

/// A placeholder media tile.
///
/// The HTML mockups fill imagery either with `<image-slot>` (empty "drop an
/// image" boxes) or with deliberately-colored destination tiles (a brand color
/// + dotted texture + a centered pin). Since the app ships without real photos,
/// every image becomes a [BeegiiMedia]: a deterministic brand-tinted gradient
/// with a faint dotted texture, an optional centered glyph and an optional
/// caption — visually rich, never an empty grey box.
class BeegiiMedia extends StatelessWidget {
  const BeegiiMedia({
    super.key,
    this.seed = '',
    this.color,
    this.gradient,
    this.caption,
    this.glyph = MediaGlyph.pin,
    this.radius = 0,
    this.aspectRatio,
    this.overlay,
    this.dark = false,
    this.scrim = false,
  });

  /// Determines the tile color when [color] and [gradient] are null.
  final String seed;
  final Color? color;

  /// An explicit gradient (e.g. one of [BeegiiGradients]) — wins over [color].
  final Gradient? gradient;

  /// Faint descriptive label rendered under the glyph (the original slot text).
  final String? caption;
  final MediaGlyph glyph;
  final double radius;
  final double? aspectRatio;

  /// Stacked above the tile (chips, gradients, labels).
  final Widget? overlay;

  /// Use a darker, photographic-feeling tile (for video reels).
  final bool dark;

  /// Add a bottom-up dark scrim (for text legibility over the tile).
  final bool scrim;

  static const List<Color> _palette = [
    Color(0xFF2E8F58), // fern green (Bali)
    Color(0xFFC2603C), // terracotta (Bangkok)
    Color(0xFFD79A2B), // amber (Penang)
    Color(0xFF6C5CB8), // violet (Tokyo)
    Color(0xFF356BA8), // blue (Ho Chi Minh)
    Color(0xFFB1492E), // rust (Seoul)
    Color(0xFF1F8A8A), // teal
    Color(0xFFB23A6A), // magenta
    Color(0xFF4E7A39), // olive
    Color(0xFF9A6A2E), // bronze
    Color(0xFF3C5A8C), // indigo
    Color(0xFFCa6b46), // clay
  ];

  Color get _baseColor {
    if (color != null) return color!;
    if (seed.isEmpty) return _palette[3];
    var h = 0;
    for (final c in seed.codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    return _palette[h % _palette.length];
  }

  @override
  Widget build(BuildContext context) {
    Gradient grad;
    if (gradient != null) {
      grad = gradient!;
    } else {
      final base = _baseColor;
      final hsl = HSLColor.fromColor(base);
      final top = hsl
          .withLightness(
            (hsl.lightness + (dark ? -0.04 : 0.06)).clamp(0.0, 1.0),
          )
          .toColor();
      final bottom = hsl
          .withLightness((hsl.lightness - (dark ? 0.20 : 0.12)).clamp(0.0, 1.0))
          .withSaturation((hsl.saturation + 0.04).clamp(0.0, 1.0))
          .toColor();
      grad = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [top, bottom],
      );
    }

    Widget tile = DecoratedBox(
      decoration: BoxDecoration(gradient: grad),
      child: CustomPaint(
        painter: _DotTexturePainter(
          color: Colors.white.withValues(alpha: dark ? 0.05 : 0.09),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (glyph != MediaGlyph.none || caption != null)
              _GlyphCaption(glyph: glyph, caption: caption),
            if (scrim)
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Color(0x73000000)],
                    stops: [0.45, 1],
                  ),
                ),
              ),
            ?overlay,
          ],
        ),
      ),
    );

    if (radius > 0) {
      tile = ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: tile,
      );
    }
    if (aspectRatio != null) {
      tile = AspectRatio(aspectRatio: aspectRatio!, child: tile);
    }
    return tile;
  }
}

class _GlyphCaption extends StatelessWidget {
  const _GlyphCaption({required this.glyph, this.caption});
  final MediaGlyph glyph;
  final String? caption;

  IconData? get _icon => switch (glyph) {
    MediaGlyph.pin => Icons.place_outlined,
    MediaGlyph.play => Icons.play_arrow_rounded,
    MediaGlyph.image => Icons.image_outlined,
    MediaGlyph.camera => Icons.photo_camera_outlined,
    MediaGlyph.none => null,
  };

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    if (glyph == MediaGlyph.pin || glyph == MediaGlyph.play) {
      // Pin/play render inside a frosted white circle (matches the mockups).
      children.add(
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.92),
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Icon(_icon, size: 20, color: BeegiiColors.ink),
        ),
      );
    } else if (_icon != null) {
      children.add(
        Icon(_icon, size: 30, color: Colors.white.withValues(alpha: 0.7)),
      );
    }
    if (caption != null) {
      if (children.isNotEmpty) children.add(const SizedBox(height: 8));
      children.add(
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            caption!,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: BeegiiType.sans(
              size: 11.5,
              weight: FontWeight.w600,
              color: Colors.white.withValues(alpha: 0.82),
              height: 1.25,
            ),
          ),
        ),
      );
    }
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: children),
    );
  }
}

/// Subtle dotted texture used by destination/media tiles in the mockups.
class _DotTexturePainter extends CustomPainter {
  _DotTexturePainter({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    const gap = 13.0;
    const r = 1.4;
    for (double y = gap / 2; y < size.height; y += gap) {
      for (double x = gap / 2; x < size.width; x += gap) {
        canvas.drawCircle(Offset(x, y), r, paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DotTexturePainter old) => old.color != color;
}
