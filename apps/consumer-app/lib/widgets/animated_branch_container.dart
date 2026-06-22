import 'package:flutter/material.dart';

import '../theme/tokens.dart';

/// Container for the StatefulShellRoute branches that slides the active branch
/// in from the left/right when the tab changes — direction follows whether the
/// new tab sits to the right (slide left) or left (slide right) of the old one.
///
/// All branches stay mounted (state preserved); only the outgoing + incoming
/// branches paint during the transition.
class AnimatedBranchContainer extends StatefulWidget {
  const AnimatedBranchContainer({
    super.key,
    required this.currentIndex,
    required this.children,
  });

  final int currentIndex;
  final List<Widget> children;

  @override
  State<AnimatedBranchContainer> createState() =>
      _AnimatedBranchContainerState();
}

class _AnimatedBranchContainerState extends State<AnimatedBranchContainer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
    value: 1,
  );
  late int _previousIndex = widget.currentIndex;
  bool _goingRight = true;

  @override
  void didUpdateWidget(AnimatedBranchContainer old) {
    super.didUpdateWidget(old);
    if (old.currentIndex != widget.currentIndex) {
      _previousIndex = old.currentIndex;
      _goingRight = widget.currentIndex > _previousIndex;
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: List.generate(widget.children.length, (i) {
        final isCurrent = i == widget.currentIndex;
        final isPrevious =
            i == _previousIndex && _previousIndex != widget.currentIndex;

        // Inactive (and not the outgoing) branch: kept alive but parked off-stage.
        if (!isCurrent && !isPrevious) {
          return Offstage(
            child: TickerMode(enabled: false, child: widget.children[i]),
          );
        }

        return AnimatedBuilder(
          animation: _controller,
          child: widget.children[i],
          builder: (context, child) {
            final t = Motion.ease.transform(_controller.value);
            final dir = _goingRight ? 1.0 : -1.0;
            // incoming slides from ±1 → 0; outgoing slides 0 → ∓1.
            final dx = isCurrent ? (1 - t) * dir : t * -dir;
            return Offstage(
              offstage: _controller.isCompleted && !isCurrent,
              child: FractionalTranslation(
                translation: Offset(dx, 0),
                child: child,
              ),
            );
          },
        );
      }),
    );
  }
}
