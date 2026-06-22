import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// The three bottom-tab glyphs, hand-built to match the SVG paths in
/// `Beegii App.html` (viewBox 0 0 24 24, stroke-width 1.8, round caps).
class NavGlyph extends StatelessWidget {
  const NavGlyph({
    super.key,
    required this.kind,
    required this.color,
    this.size = 19,
  });
  final NavGlyphKind kind;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size.square(size),
    painter: _NavGlyphPainter(kind, color),
  );
}

enum NavGlyphKind { compass, plane, person }

class _NavGlyphPainter extends CustomPainter {
  _NavGlyphPainter(this.kind, this.color);
  final NavGlyphKind kind;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24.0;
    canvas.scale(s);
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = color;
    final fill = Paint()
      ..style = PaintingStyle.fill
      ..color = color;

    switch (kind) {
      case NavGlyphKind.compass:
        canvas.drawCircle(const Offset(12, 12), 9, stroke);
        final needle = Path()
          ..moveTo(16, 8)
          ..lineTo(13.2, 13.2)
          ..lineTo(8, 16)
          ..lineTo(10.8, 10.8)
          ..close();
        canvas.drawPath(needle, fill);
        break;
      case NavGlyphKind.plane:
        canvas.save();
        canvas.translate(12, 12);
        canvas.rotate(45 * math.pi / 180);
        canvas.translate(-12, -12);
        final plane = Path()
          ..moveTo(10.5, 3.5)
          ..cubicTo(10.5, 2.7, 11.2, 2, 12, 2)
          ..cubicTo(12.8, 2, 13.5, 2.7, 13.5, 3.5)
          ..lineTo(13.5, 9)
          ..lineTo(21, 13.5)
          ..lineTo(21, 15.5)
          ..lineTo(13.5, 13.2)
          ..lineTo(13.5, 18)
          ..lineTo(16, 19.8)
          ..lineTo(16, 21.5)
          ..lineTo(12, 20.4)
          ..lineTo(8, 21.5)
          ..lineTo(8, 19.8)
          ..lineTo(10.5, 18)
          ..lineTo(10.5, 13.2)
          ..lineTo(3, 15.5)
          ..lineTo(3, 13.5)
          ..lineTo(10.5, 9)
          ..close();
        canvas.drawPath(plane, fill);
        canvas.restore();
        break;
      case NavGlyphKind.person:
        canvas.drawCircle(const Offset(12, 8), 3.6, stroke);
        final body = Path()
          ..moveTo(5, 20)
          ..cubicTo(5, 16, 8, 14.5, 12, 14.5)
          ..cubicTo(16, 14.5, 19, 16, 19, 20);
        canvas.drawPath(body, stroke);
        break;
    }
  }

  @override
  bool shouldRepaint(_NavGlyphPainter old) =>
      old.kind != kind || old.color != color;
}
