import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/colors.dart';
import '../theme/tokens.dart';
import '../theme/typography.dart';

/// Shows a floating white pill toast near the bottom of the screen — mirrors the
/// `.toast` component shared across the mockups.
void showBeegiiToast(
  BuildContext context,
  String message, {
  Color? avatarColor,
  String? avatarInit,
}) {
  final overlay = Overlay.of(context);
  late OverlayEntry entry;
  entry = OverlayEntry(
    builder: (ctx) => _ToastWidget(
      message: message,
      avatarColor: avatarColor,
      avatarInit: avatarInit,
      onDone: () => entry.remove(),
    ),
  );
  overlay.insert(entry);
}

class _ToastWidget extends StatefulWidget {
  const _ToastWidget({
    required this.message,
    required this.onDone,
    this.avatarColor,
    this.avatarInit,
  });
  final String message;
  final VoidCallback onDone;
  final Color? avatarColor;
  final String? avatarInit;

  @override
  State<_ToastWidget> createState() => _ToastWidgetState();
}

class _ToastWidgetState extends State<_ToastWidget> {
  bool _shown = false;
  Timer? _hideTimer;
  Timer? _removeTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _shown = true);
    });
    _hideTimer = Timer(const Duration(milliseconds: 2300), () {
      if (mounted) setState(() => _shown = false);
      _removeTimer = Timer(const Duration(milliseconds: 360), widget.onDone);
    });
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    _removeTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return Positioned(
      left: 0,
      right: 0,
      bottom: mq.padding.bottom + 96,
      child: IgnorePointer(
        child: Center(
          child: AnimatedSlide(
            offset: _shown ? Offset.zero : const Offset(0, 0.4),
            duration: const Duration(milliseconds: 320),
            curve: Motion.ease,
            child: AnimatedOpacity(
              opacity: _shown ? 1 : 0,
              duration: const Duration(milliseconds: 320),
              child: Container(
                constraints: BoxConstraints(maxWidth: mq.size.width * 0.84),
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 13,
                ),
                decoration: BoxDecoration(
                  color: BeegiiColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: Shadows.sh3,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (widget.avatarInit != null) ...[
                      Container(
                        width: 26,
                        height: 26,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: widget.avatarColor ?? BeegiiColors.accent,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          widget.avatarInit!,
                          style: BeegiiType.serif(
                            size: 12,
                            weight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(width: 9),
                    ],
                    Flexible(
                      child: Text(
                        widget.message,
                        style: BeegiiType.sans(
                          size: 12.5,
                          weight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
