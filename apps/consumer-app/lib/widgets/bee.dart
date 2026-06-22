import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/colors.dart';

/// The Beegii bee mascot, drawn as a friendly chubby bee.
class BeeMascot extends StatelessWidget {
  const BeeMascot({super.key, this.size = 40});
  final double size;

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _BeePainter());
}

/// A rounded-square avatar holding the bee mascot on a soft honey background.
class BeeAvatar extends StatelessWidget {
  const BeeAvatar({super.key, this.size = 44, this.radius = 13});
  final double size;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFDEFCB), Color(0xFFFBE0A6)],
        ),
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Center(child: BeeMascot(size: size * 0.66)),
    );
  }
}

class _BeePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final cx = w / 2;
    final cy = h * 0.56;
    final bodyW = w * 0.62;
    final bodyH = h * 0.56;

    // Wings (behind the body).
    final wingPaint = Paint()..color = Colors.white.withValues(alpha: 0.85);
    final wingStroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.02
      ..color = const Color(0xFF7A5A14).withValues(alpha: 0.25);
    for (final dir in [-1.0, 1.0]) {
      final wing = Rect.fromCenter(
        center: Offset(cx + dir * bodyW * 0.42, cy - bodyH * 0.42),
        width: w * 0.34,
        height: h * 0.30,
      );
      canvas.save();
      canvas.translate(wing.center.dx, wing.center.dy);
      canvas.rotate(dir * 0.5);
      final r = Rect.fromCenter(
        center: Offset.zero,
        width: wing.width,
        height: wing.height,
      );
      canvas.drawOval(r, wingPaint);
      canvas.drawOval(r, wingStroke);
      canvas.restore();
    }

    // Body.
    final bodyRect = Rect.fromCenter(
      center: Offset(cx, cy),
      width: bodyW,
      height: bodyH,
    );
    final bodyRRect = RRect.fromRectAndRadius(
      bodyRect,
      Radius.circular(bodyH / 2),
    );
    canvas.drawRRect(
      bodyRRect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFF6B83A), Color(0xFFE89A2C)],
        ).createShader(bodyRect),
    );

    // Stripes (clipped to body).
    canvas.save();
    canvas.clipRRect(bodyRRect);
    final stripePaint = Paint()..color = const Color(0xFF2A2118);
    final stripeW = bodyW * 0.16;
    for (final fx in [0.30, 0.62]) {
      final x = bodyRect.left + bodyRect.width * fx;
      canvas.drawRect(
        Rect.fromLTWH(x, bodyRect.top, stripeW, bodyRect.height),
        stripePaint,
      );
    }
    canvas.restore();

    // Antennae.
    final antPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.03
      ..strokeCap = StrokeCap.round
      ..color = const Color(0xFF2A2118);
    final headTop = bodyRect.top;
    for (final dir in [-1.0, 1.0]) {
      final base = Offset(cx + dir * bodyW * 0.14, headTop + h * 0.02);
      final tip = Offset(cx + dir * bodyW * 0.30, headTop - h * 0.14);
      final path = Path()
        ..moveTo(base.dx, base.dy)
        ..quadraticBezierTo(
          cx + dir * bodyW * 0.34,
          headTop - h * 0.04,
          tip.dx,
          tip.dy,
        );
      canvas.drawPath(path, antPaint);
      canvas.drawCircle(
        tip,
        w * 0.035,
        Paint()..color = const Color(0xFF2A2118),
      );
    }

    // Eyes + smile.
    final eyePaint = Paint()..color = const Color(0xFF2A2118);
    final eyeY = cy - bodyH * 0.06;
    canvas.drawCircle(Offset(cx - bodyW * 0.16, eyeY), w * 0.035, eyePaint);
    canvas.drawCircle(Offset(cx + bodyW * 0.16, eyeY), w * 0.035, eyePaint);
    final smile = Path();
    final smileRect = Rect.fromCircle(
      center: Offset(cx, eyeY + bodyH * 0.02),
      radius: bodyW * 0.16,
    );
    smile.addArc(smileRect, 0.2 * math.pi, 0.6 * math.pi);
    canvas.drawPath(
      smile,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = w * 0.025
        ..strokeCap = StrokeCap.round
        ..color = const Color(0xFF2A2118),
    );
  }

  @override
  bool shouldRepaint(_BeePainter oldDelegate) => false;
}

/// Small "Beegii" wordmark with a honey dot.
class BeegiiWordmark extends StatelessWidget {
  const BeegiiWordmark({
    super.key,
    this.size = 20,
    this.color = BeegiiColors.ink,
  });
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        BeeMascot(size: size * 1.1),
        const SizedBox(width: 7),
        Text(
          'Beegii',
          style: TextStyle(
            fontFamily: 'Spectral',
            fontSize: size,
            fontWeight: FontWeight.w700,
            color: color,
            letterSpacing: -0.2,
          ),
        ),
      ],
    );
  }
}
