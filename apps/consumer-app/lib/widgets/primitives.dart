import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme/colors.dart';
import '../theme/tokens.dart';
import '../theme/typography.dart';

/// Mono, uppercase, letter-spaced eyebrow label (e.g. "NEW TRIP").
class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key, this.color, this.leading});
  final String text;
  final Color? color;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final label = Text(
      text.toUpperCase(),
      style: BeegiiType.mono(
        size: 10.5,
        weight: FontWeight.w500,
        color: color ?? BeegiiColors.ink3,
        letterSpacing: 1.4,
      ),
    );
    if (leading == null) return label;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [leading!, const SizedBox(width: 5), label],
    );
  }
}

/// Editorial serif section / screen title.
class SerifTitle extends StatelessWidget {
  const SerifTitle(
    this.text, {
    super.key,
    this.size = 22,
    this.weight = FontWeight.w700,
    this.color,
  });
  final String text;
  final double size;
  final FontWeight weight;
  final Color? color;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: BeegiiType.serif(
      size: size,
      weight: weight,
      color: color ?? BeegiiColors.ink,
      height: 1.08,
    ),
  );
}

/// A soft, white, rounded card with the standard sh-2 shadow.
class SoftCard extends StatelessWidget {
  const SoftCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Insets.lg),
    this.radius = Radii.lg,
    this.onTap,
    this.color = BeegiiColors.surface,
    this.border,
    this.shadow = true,
  });
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final VoidCallback? onTap;
  final Color color;
  final BoxBorder? border;
  final bool shadow;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        boxShadow: shadow ? Shadows.sh2 : null,
        border: border,
      ),
      child: Padding(padding: padding, child: child),
    );
    if (onTap == null) return card;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: card,
      ),
    );
  }
}

/// A small pill chip (e.g. a vibe tag, "PENANG LOCAL").
class TagChip extends StatelessWidget {
  const TagChip(
    this.label, {
    super.key,
    this.bg,
    this.fg,
    this.mono = false,
    this.icon,
    this.dense = false,
  });
  final String label;
  final Color? bg;
  final Color? fg;
  final bool mono;
  final IconData? icon;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final accent = context.watch<AppState>().accent;
    final fgc = fg ?? accent.deep;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 8 : 10,
        vertical: dense ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: bg ?? accent.soft,
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: fgc),
            const SizedBox(width: 4),
          ],
          Text(
            mono ? label.toUpperCase() : label,
            style: mono
                ? BeegiiType.mono(
                    size: 9.5,
                    weight: FontWeight.w500,
                    color: fgc,
                    letterSpacing: 0.8,
                  )
                : BeegiiType.sans(
                    size: 12,
                    weight: FontWeight.w600,
                    color: fgc,
                  ),
          ),
        ],
      ),
    );
  }
}

/// A dark translucent overlay pill, e.g. "48 reels" on a media tile.
class OverlayPill extends StatelessWidget {
  const OverlayPill(this.text, {super.key, this.icon});
  final String text;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: Colors.black.withValues(alpha: 0.42),
      borderRadius: BorderRadius.circular(Radii.pill),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 11, color: Colors.white),
          const SizedBox(width: 3),
        ],
        Text(
          text,
          style: BeegiiType.sans(
            size: 10.5,
            weight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
      ],
    ),
  );
}

/// Primary filled (accent) button.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton(
    this.label, {
    super.key,
    this.onTap,
    this.trailingIcon,
    this.leadingIcon,
    this.expand = true,
    this.enabled = true,
  });
  final String label;
  final VoidCallback? onTap;
  final IconData? trailingIcon;
  final IconData? leadingIcon;
  final bool expand;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final accent = context.watch<AppState>().accent;
    final disabled = !enabled || onTap == null;
    final child = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (leadingIcon != null) ...[
          Icon(
            leadingIcon,
            size: 18,
            color: disabled ? BeegiiColors.ink3 : accent.onBase,
          ),
          const SizedBox(width: 8),
        ],
        Text(
          label,
          style: BeegiiType.sans(
            size: 15.5,
            weight: FontWeight.w700,
            color: disabled ? BeegiiColors.ink3 : accent.onBase,
          ),
        ),
        if (trailingIcon != null) ...[
          const SizedBox(width: 8),
          Icon(
            trailingIcon,
            size: 18,
            color: disabled ? BeegiiColors.ink3 : accent.onBase,
          ),
        ],
      ],
    );
    return _Pressable(
      onTap: disabled ? null : onTap,
      child: Container(
        height: 54,
        padding: const EdgeInsets.symmetric(horizontal: 22),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: disabled ? BeegiiColors.line : accent.base,
          borderRadius: BorderRadius.circular(Radii.pill),
          boxShadow: disabled
              ? null
              : [
                  BoxShadow(
                    color: accent.base.withValues(alpha: 0.32),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
        ),
        child: child,
      ),
    );
  }
}

/// Dark filled button (Follow, Request to book).
class DarkButton extends StatelessWidget {
  const DarkButton(
    this.label, {
    super.key,
    this.onTap,
    this.trailingIcon,
    this.expand = false,
  });
  final String label;
  final VoidCallback? onTap;
  final IconData? trailingIcon;
  final bool expand;

  @override
  Widget build(BuildContext context) => _Pressable(
    onTap: onTap,
    child: Container(
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 22),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: BeegiiColors.ink,
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Row(
        mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: BeegiiType.sans(
              size: 14.5,
              weight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          if (trailingIcon != null) ...[
            const SizedBox(width: 8),
            Icon(trailingIcon, size: 17, color: Colors.white),
          ],
        ],
      ),
    ),
  );
}

/// Outlined / ghost pill button.
class GhostButton extends StatelessWidget {
  const GhostButton(this.label, {super.key, this.onTap, this.icon});
  final String label;
  final VoidCallback? onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => _Pressable(
    onTap: onTap,
    child: Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 18),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: BeegiiColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: BeegiiColors.ink),
            const SizedBox(width: 7),
          ],
          Text(
            label,
            style: BeegiiType.sans(size: 13.5, weight: FontWeight.w600),
          ),
        ],
      ),
    ),
  );
}

/// Circular icon button (back, close, quote, etc).
class CircleIconButton extends StatelessWidget {
  const CircleIconButton({
    super.key,
    required this.icon,
    this.onTap,
    this.bg = BeegiiColors.surface,
    this.fg = BeegiiColors.ink,
    this.size = 40,
    this.iconSize = 20,
    this.shadow = true,
  });
  final IconData icon;
  final VoidCallback? onTap;
  final Color bg;
  final Color fg;
  final double size;
  final double iconSize;
  final bool shadow;

  @override
  Widget build(BuildContext context) => _Pressable(
    onTap: onTap,
    child: Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: bg,
        shape: BoxShape.circle,
        boxShadow: shadow ? Shadows.sh2 : null,
      ),
      child: Icon(icon, size: iconSize, color: fg),
    ),
  );
}

/// Verified accent check badge.
class VerifiedBadge extends StatelessWidget {
  const VerifiedBadge({super.key, this.size = 18});
  final double size;

  @override
  Widget build(BuildContext context) {
    final accent = context.watch<AppState>().accent;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: accent.base, shape: BoxShape.circle),
      child: Icon(Icons.check_rounded, size: size * 0.62, color: Colors.white),
    );
  }
}

/// -/+ stepper used by the "Travellers" row.
class CountStepper extends StatelessWidget {
  const CountStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 1,
    this.max = 12,
  });
  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData icon, VoidCallback? onTap) => _Pressable(
      onTap: onTap,
      child: Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: onTap == null ? BeegiiColors.bg : BeegiiColors.surface,
          shape: BoxShape.circle,
          border: Border.all(color: BeegiiColors.line),
        ),
        child: Icon(
          icon,
          size: 18,
          color: onTap == null ? BeegiiColors.ink4 : BeegiiColors.ink,
        ),
      ),
    );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        btn(
          Icons.remove_rounded,
          value > min ? () => onChanged(value - 1) : null,
        ),
        SizedBox(
          width: 34,
          child: Text(
            '$value',
            textAlign: TextAlign.center,
            style: BeegiiType.sans(size: 16, weight: FontWeight.w700),
          ),
        ),
        btn(Icons.add_rounded, value < max ? () => onChanged(value + 1) : null),
      ],
    );
  }
}

/// A rounded search field (display-only / lightweight).
class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    this.hint = 'Search a city, country or vibe',
    this.controller,
    this.focusNode,
    this.onTap,
    this.readOnly = false,
    this.onChanged,
    this.onSubmitted,
  });
  final String hint;
  final TextEditingController? controller;
  final FocusNode? focusNode;
  final VoidCallback? onTap;
  final bool readOnly;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: BeegiiColors.line),
        boxShadow: Shadows.sh2,
      ),
      child: Row(
        children: [
          const Icon(Icons.search_rounded, size: 20, color: BeegiiColors.ink3),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              focusNode: focusNode,
              readOnly: readOnly,
              onTap: onTap,
              onChanged: onChanged,
              onSubmitted: onSubmitted,
              textInputAction: TextInputAction.search,
              style: BeegiiType.sans(size: 14.5, weight: FontWeight.w500),
              cursorColor: BeegiiColors.ink,
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: hint,
                hintStyle: BeegiiType.sans(
                  size: 14.5,
                  weight: FontWeight.w500,
                  color: BeegiiColors.ink3,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Scale-on-press wrapper used by every tappable element.
class _Pressable extends StatefulWidget {
  const _Pressable({required this.child, this.onTap});
  final Widget child;
  final VoidCallback? onTap;

  @override
  State<_Pressable> createState() => _PressableState();
}

class _PressableState extends State<_Pressable> {
  double _scale = 1;

  void _set(double s) {
    if (widget.onTap == null) return;
    setState(() => _scale = s);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onTap,
      onTapDown: (_) => _set(0.96),
      onTapUp: (_) => _set(1),
      onTapCancel: () => _set(1),
      child: AnimatedScale(
        scale: _scale,
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOut,
        child: widget.child,
      ),
    );
  }
}

/// Renders "🇲🇾 Label" so the emoji uses the emoji font and the label keeps
/// its normal (DM Sans) style — works around emoji not falling back under a
/// Google-Fonts primary family.
class EmojiLabel extends StatelessWidget {
  const EmojiLabel(
    this.emoji,
    this.label, {
    super.key,
    required this.style,
    this.emojiSize,
    this.maxLines = 1,
  });
  final String emoji;
  final String label;
  final TextStyle style;
  final double? emojiSize;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '$emoji ',
            style: BeegiiType.emoji(size: emojiSize ?? style.fontSize ?? 13),
          ),
          TextSpan(text: label, style: style),
        ],
      ),
      maxLines: maxLines,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// Re-exported press wrapper for screens that need a bare pressable.
class Pressable extends StatelessWidget {
  const Pressable({super.key, required this.child, this.onTap});
  final Widget child;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => _Pressable(onTap: onTap, child: child);
}
