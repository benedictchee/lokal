import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../router.dart';
import '../../state/shell_controller.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/tokens.dart';
import '../../theme/typography.dart';
import '../../widgets/beegii_media.dart';
import '../../widgets/book_sheet.dart';
import '../../widgets/toast.dart';

class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key});

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  final _controller = PageController();
  int _page = 0;
  bool _scrolledOnce = false;
  int _topTab = 1; // 0 Following, 1 Nearby

  late final List<Guide> _guides = MockData.feedGuides;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: ColoredBox(
        color: Colors.black,
        child: Stack(
          children: [
            NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (n is ScrollUpdateNotification && !_scrolledOnce) {
                  setState(() => _scrolledOnce = true);
                }
                return false;
              },
              child: PageView.builder(
                controller: _controller,
                scrollDirection: Axis.vertical,
                onPageChanged: (i) => setState(() => _page = i),
                itemCount: _guides.length,
                itemBuilder: (context, i) => _ReelPage(
                  guide: _guides[i],
                  isActive: _page == i,
                  isFirst: i == 0,
                  showUpHint: i == 0 && !_scrolledOnce,
                ),
              ),
            ),
            _buildTopTabs(context),
          ],
        ),
      ),
    );
  }

  Widget _buildTopTabs(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _topTabButton('Following', 0),
            const SizedBox(width: 18),
            _topTabButton('Nearby', 1),
          ],
        ),
      ),
    );
  }

  Widget _topTabButton(String label, int index) {
    final on = _topTab == index;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => _topTab = index),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: BeegiiType.sans(
              size: 14.5,
              weight: FontWeight.w600,
              color: Colors.white.withValues(alpha: on ? 1 : 0.55),
            ),
          ),
          const SizedBox(height: 5),
          AnimatedContainer(
            duration: Motion.fast,
            width: on ? 18 : 0,
            height: 2.5,
            decoration: BoxDecoration(
              color: BeegiiColors.accent,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReelPage extends StatefulWidget {
  const _ReelPage({
    required this.guide,
    required this.isActive,
    required this.isFirst,
    required this.showUpHint,
  });
  final Guide guide;
  final bool isActive;
  final bool isFirst;
  final bool showUpHint;

  @override
  State<_ReelPage> createState() => _ReelPageState();
}

class _ReelPageState extends State<_ReelPage> with TickerProviderStateMixin {
  late final AnimationController _progress = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 15),
  );
  late final AnimationController _bob = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  )..repeat(reverse: true);
  late final AnimationController _heart = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );

  bool _liked = false;
  bool _capOpen = false;

  static const _scrim = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      Color(0xDB080604),
      Color(0x5C080604),
      Colors.transparent,
      Colors.transparent,
      Color(0x73080604),
    ],
    stops: [0, 0.26, 0.46, 0.64, 1],
  );

  @override
  void initState() {
    super.initState();
    if (widget.isActive) _progress.forward();
  }

  @override
  void didUpdateWidget(_ReelPage old) {
    super.didUpdateWidget(old);
    if (widget.isActive && !old.isActive) {
      _progress
        ..reset()
        ..forward();
    } else if (!widget.isActive && old.isActive) {
      _progress.stop();
    }
  }

  @override
  void dispose() {
    _progress.dispose();
    _bob.dispose();
    _heart.dispose();
    super.dispose();
  }

  void _doubleTapLike() {
    setState(() => _liked = true);
    _heart.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.guide;
    final mq = MediaQuery.of(context);
    final bottomSafe = mq.padding.bottom;
    final clip = g.clips.first;

    return GestureDetector(
      onDoubleTap: _doubleTapLike,
      child: Stack(
        fit: StackFit.expand,
        children: [
          BeegiiMedia(
            gradient: BeegiiGradients.byClass(clip.grad),
            glyph: MediaGlyph.none,
            dark: true,
          ),
          const DecoratedBox(decoration: BoxDecoration(gradient: _scrim)),
          // centred glass play hint
          Align(
            alignment: const Alignment(0, -0.10),
            child: Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.16),
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.35),
                  width: 1.5,
                ),
              ),
              child: const Icon(
                Icons.play_arrow_rounded,
                color: Colors.white,
                size: 30,
              ),
            ),
          ),
          // double-tap heart
          Center(
            child: AnimatedBuilder(
              animation: _heart,
              builder: (context, _) {
                final t = _heart.value;
                final scale = t == 0
                    ? 0.4
                    : (0.4 + 0.9 * Curves.easeOut.transform(t.clamp(0, 1)));
                final opacity = t == 0
                    ? 0.0
                    : (t < 0.7 ? 0.95 : 0.95 * (1 - (t - 0.7) / 0.3));
                return Opacity(
                  opacity: opacity.clamp(0, 1),
                  child: Transform.scale(
                    scale: scale,
                    child: const Icon(
                      Icons.favorite,
                      color: Colors.white,
                      size: 110,
                      shadows: [
                        Shadow(
                          color: Color(0x66000000),
                          blurRadius: 20,
                          offset: Offset(0, 8),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          if (widget.showUpHint) _buildUpHint(bottomSafe),
          _buildRail(context, g, bottomSafe),
          _buildCaption(context, g, bottomSafe),
          _buildProgress(bottomSafe),
        ],
      ),
    );
  }

  Widget _buildUpHint(double bottomSafe) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: bottomSafe + 300,
      child: AnimatedBuilder(
        animation: _bob,
        builder: (context, child) => Transform.translate(
          offset: Offset(0, -7 * _bob.value),
          child: child,
        ),
        child: Column(
          children: [
            const Icon(
              Icons.keyboard_arrow_up_rounded,
              color: Colors.white,
              size: 22,
            ),
            Text(
              'Swipe up for the next local',
              style: BeegiiType.sans(
                size: 10.5,
                weight: FontWeight.w600,
                color: Colors.white.withValues(alpha: 0.85),
                shadow: true,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRail(BuildContext context, Guide g, double bottomSafe) {
    return Positioned(
      right: 16,
      bottom: bottomSafe + 112,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _RailAction(
            icon: _liked ? Icons.favorite : Icons.favorite_border,
            label: g.likes,
            color: _liked ? const Color(0xFFE0524A) : Colors.white,
            onTap: () => setState(() => _liked = !_liked),
          ),
          const SizedBox(height: 13),
          _RailAction(
            icon: Icons.mode_comment_outlined,
            label: '128',
            onTap: () => showBeegiiToast(context, 'Comments coming soon'),
          ),
          const SizedBox(height: 13),
          _RailAction(
            icon: Icons.ios_share_rounded,
            label: 'Share',
            onTap: () => showBeegiiToast(
              context,
              'Shared ${g.firstName}’s reel',
              avatarColor: g.color,
              avatarInit: g.init,
            ),
          ),
          const SizedBox(height: 13),
          _RailAction(
            icon: Icons.shopping_bag_outlined,
            label: 'Shop',
            onTap: () => context.openShop(g.id, 0),
          ),
          const SizedBox(height: 13),
          _RailAction(
            icon: Icons.calendar_today_outlined,
            label: 'Book',
            onTap: () async {
              final shell = context.read<ShellController>();
              shell.dockHidden = true;
              await showBookSheet(context, g);
              shell.dockHidden = false;
            },
          ),
        ],
      ),
    );
  }

  Widget _buildCaption(BuildContext context, Guide g, double bottomSafe) {
    return Positioned(
      left: 16,
      right: 70,
      bottom: bottomSafe + 108,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => context.openGuide(g.id),
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    g.displayHandle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: BeegiiType.sans(
                      size: 16,
                      weight: FontWeight.w600,
                      color: Colors.white,
                      shadow: true,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  width: 17,
                  height: 17,
                  decoration: const BoxDecoration(
                    color: BeegiiColors.accent,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    size: 11,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    g.badge.toUpperCase(),
                    style: BeegiiType.sans(
                      size: 9,
                      weight: FontWeight.w600,
                      color: Colors.white,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 7),
          Text(
            '${g.role} · ${g.dist}',
            style: BeegiiType.sans(
              size: 12.5,
              weight: FontWeight.w500,
              color: Colors.white.withValues(alpha: 0.9),
              shadow: true,
            ),
          ),
          const SizedBox(height: 10),
          GestureDetector(
            onTap: () => setState(() => _capOpen = !_capOpen),
            child: AnimatedSize(
              duration: Motion.med,
              curve: Motion.ease,
              alignment: Alignment.topLeft,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    g.quote,
                    maxLines: _capOpen ? 6 : 1,
                    overflow: TextOverflow.ellipsis,
                    style: BeegiiType.sans(
                      size: 13.5,
                      weight: FontWeight.w400,
                      color: Colors.white.withValues(alpha: 0.96),
                      height: 1.45,
                      shadow: true,
                    ),
                  ),
                  if (_capOpen) ...[
                    const SizedBox(height: 11),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final t in g.tags)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 9,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.2),
                              ),
                            ),
                            child: Text(
                              t,
                              style: BeegiiType.sans(
                                size: 10.5,
                                weight: FontWeight.w500,
                                color: Colors.white,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProgress(double bottomSafe) {
    return Positioned(
      left: 16,
      right: 16,
      bottom: bottomSafe + 90,
      child: SizedBox(
        height: 3,
        child: Stack(
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                height: 1.5,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            AnimatedBuilder(
              animation: _progress,
              builder: (context, _) => FractionallySizedBox(
                widthFactor: _progress.value,
                alignment: Alignment.centerLeft,
                child: Container(
                  height: 2,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RailAction extends StatefulWidget {
  const _RailAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = Colors.white,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;

  @override
  State<_RailAction> createState() => _RailActionState();
}

class _RailActionState extends State<_RailAction> {
  double _scale = 1;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onTap,
      onTapDown: (_) => setState(() => _scale = 0.86),
      onTapUp: (_) => setState(() => _scale = 1),
      onTapCancel: () => setState(() => _scale = 1),
      child: AnimatedScale(
        scale: _scale,
        duration: const Duration(milliseconds: 160),
        curve: Motion.ease,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              widget.icon,
              size: 27,
              color: widget.color,
              shadows: const [
                Shadow(
                  color: Color(0x66000000),
                  blurRadius: 4,
                  offset: Offset(0, 1),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              widget.label,
              style: BeegiiType.sans(
                size: 10,
                weight: FontWeight.w500,
                color: Colors.white,
                shadow: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
