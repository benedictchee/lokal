import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../state/shell_controller.dart';
import '../theme/colors.dart';
import '../theme/tokens.dart';
import '../theme/typography.dart';
import 'nav_icons.dart';

/// Branch indices used by the router's StatefulShellRoute.
class Branch {
  static const explore = 0;
  static const search = 1;
  static const plan = 2;
  static const account = 3;
}

/// The floating bottom dock: a 206×50 dark tab bar (Explore / Plan / Me) with a
/// sliding active pill, plus the context FABs (Search on Explore/Search, Chat on
/// the planner).
class BeegiiDock extends StatelessWidget {
  const BeegiiDock({
    super.key,
    required this.currentIndex,
    required this.onTapBranch,
    required this.onSearchTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTapBranch;
  final VoidCallback onSearchTap;

  static const double _barWidth = 206;
  static const double _barHeight = 50;

  @override
  Widget build(BuildContext context) {
    final shell = context.watch<ShellController>();
    final accent = context.watch<AppState>().accent;

    final showSearchFab =
        currentIndex == Branch.explore || currentIndex == Branch.search;
    final showChatFab =
        currentIndex == Branch.plan && shell.plannerActive && !shell.chatOpen;

    final dock = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildBar(context),
        _ContextFab(
          expanded: showChatFab,
          icon: Icons.chat_bubble_outline_rounded,
          label: 'Chat',
          badge: shell.chatUnread,
          badgeColor: accent.base,
          badgeFg: accent.onBase,
          onTap: shell.toggleChat,
        ),
        _ContextFab(
          expanded: showSearchFab,
          icon: Icons.search_rounded,
          onTap: onSearchTap,
        ),
      ],
    );

    return IgnorePointer(
      ignoring: shell.dockHidden,
      child: AnimatedSlide(
        offset: shell.dockHidden ? const Offset(0, 1.6) : Offset.zero,
        duration: Motion.med,
        curve: Motion.slide,
        child: AnimatedOpacity(
          opacity: shell.dockHidden ? 0 : 1,
          duration: const Duration(milliseconds: 260),
          child: dock,
        ),
      ),
    );
  }

  Widget _buildBar(BuildContext context) {
    // Visible tabs in order → branch index.
    const visible = [Branch.explore, Branch.plan, Branch.account];
    const labels = ['Explore', 'Plan', 'Me'];
    const glyphs = [
      NavGlyphKind.compass,
      NavGlyphKind.plane,
      NavGlyphKind.person,
    ];

    final activeVisible = visible.indexOf(currentIndex); // -1 when on Search
    // Fractional alignment keeps the pill exactly over its 1/3-width tab cell,
    // independent of the bar's border inset / exact pixel widths.
    final pillX = activeVisible <= 0 ? -1.0 : (activeVisible - 1).toDouble();

    return Container(
      width: _barWidth,
      height: _barHeight,
      decoration: BoxDecoration(
        color: BeegiiColors.dock,
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: Colors.white.withValues(alpha: 0.07)),
        boxShadow: Shadows.dock,
      ),
      child: Stack(
        children: [
          // Sliding active pill — a 1/3-width slot aligned to the active tab.
          AnimatedAlign(
            duration: Motion.slow,
            curve: Motion.slide,
            alignment: Alignment(pillX, 0),
            child: FractionallySizedBox(
              widthFactor: 1 / visible.length,
              heightFactor: 1,
              child: AnimatedOpacity(
                duration: Motion.fast,
                opacity: activeVisible < 0 ? 0 : 1,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.13),
                      borderRadius: BorderRadius.circular(21),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Row(
            children: List.generate(visible.length, (i) {
              final on = currentIndex == visible[i];
              return Expanded(
                child: _TabButton(
                  label: labels[i],
                  glyph: glyphs[i],
                  active: on,
                  onTap: () => onTapBranch(visible[i]),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

class _TabButton extends StatefulWidget {
  const _TabButton({
    required this.label,
    required this.glyph,
    required this.active,
    required this.onTap,
  });
  final String label;
  final NavGlyphKind glyph;
  final bool active;
  final VoidCallback onTap;

  @override
  State<_TabButton> createState() => _TabButtonState();
}

class _TabButtonState extends State<_TabButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.active
        ? Colors.white
        : Colors.white.withValues(alpha: 0.58);
    final scale = _down ? 0.86 : (widget.active ? 1.04 : 1.0);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onTap,
      onTapDown: (_) => setState(() => _down = true),
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 21,
            height: 21,
            child: Center(
              child: AnimatedScale(
                scale: scale,
                duration: const Duration(milliseconds: 200),
                curve: Motion.ease,
                child: NavGlyph(kind: widget.glyph, color: color, size: 19),
              ),
            ),
          ),
          const SizedBox(height: 3),
          Text(
            widget.label,
            style: BeegiiType.sans(
              size: 8.5,
              weight: widget.active ? FontWeight.w700 : FontWeight.w600,
              color: color,
              letterSpacing: -0.05,
            ),
          ),
        ],
      ),
    );
  }
}

class _ContextFab extends StatefulWidget {
  const _ContextFab({
    required this.expanded,
    required this.icon,
    required this.onTap,
    this.label,
    this.badge = 0,
    this.badgeColor,
    this.badgeFg,
  });
  final bool expanded;
  final IconData icon;
  final VoidCallback onTap;
  final String? label;
  final int badge;
  final Color? badgeColor;
  final Color? badgeFg;

  @override
  State<_ContextFab> createState() => _ContextFabState();
}

class _ContextFabState extends State<_ContextFab> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: Motion.slow,
      curve: Motion.slide,
      width: widget.expanded ? 50 : 0,
      height: 50,
      margin: EdgeInsets.only(left: widget.expanded ? 9 : 0),
      child: AnimatedScale(
        scale: widget.expanded ? (_down ? 0.9 : 1.0) : 0.3,
        duration: Motion.med,
        curve: Motion.pop,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 300),
          opacity: widget.expanded ? 1 : 0,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: widget.expanded ? widget.onTap : null,
            onTapDown: (_) => setState(() => _down = true),
            onTapUp: (_) => setState(() => _down = false),
            onTapCancel: () => setState(() => _down = false),
            child: Container(
              width: 50,
              height: 50,
              decoration: BoxDecoration(
                color: BeegiiColors.dock,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withValues(alpha: 0.07)),
                boxShadow: Shadows.dock,
              ),
              child: Stack(
                alignment: Alignment.center,
                clipBehavior: Clip.none,
                children: [
                  Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        widget.icon,
                        size: 19,
                        color: Colors.white.withValues(alpha: 0.9),
                      ),
                      if (widget.label != null) ...[
                        const SizedBox(height: 3),
                        Text(
                          widget.label!,
                          style: BeegiiType.sans(
                            size: 8.5,
                            weight: FontWeight.w600,
                            color: Colors.white.withValues(alpha: 0.9),
                            letterSpacing: -0.05,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (widget.badge > 0)
                    Positioned(
                      top: 6,
                      right: 8,
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 15),
                        height: 15,
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: widget.badgeColor,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${widget.badge}',
                          style: BeegiiType.sans(
                            size: 9.5,
                            weight: FontWeight.w700,
                            color: widget.badgeFg ?? Colors.white,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
