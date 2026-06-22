import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/tokens.dart';
import '../../theme/typography.dart';
import '../../widgets/beegii_media.dart';
import '../../widgets/book_sheet.dart';
import '../../widgets/primitives.dart';
import '../../widgets/toast.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.guideId, required this.isMe});
  final String guideId;
  final bool isMe;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  int _tab = 0; // 0 media, 1 countries, 2 shop
  bool _bioExpanded = false;
  bool _settingsOpen = false;

  @override
  Widget build(BuildContext context) {
    final g = MockData.guideById(widget.guideId);
    return Scaffold(
      backgroundColor: BeegiiColors.bg,
      body: Stack(
        children: [
          SafeArea(
            bottom: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _topBar(context, g),
                Expanded(
                  child: CustomScrollView(
                    slivers: [
                      SliverToBoxAdapter(child: _headerAndAbout(context, g)),
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: _TabBarDelegate(
                          tab: _tab,
                          onTap: (i) => setState(() => _tab = i),
                        ),
                      ),
                      _grid(context, g),
                      SliverToBoxAdapter(
                        child: SizedBox(
                          height: widget.isMe
                              ? Layout.dockReserve + 16
                              : 96 + MediaQuery.of(context).padding.bottom,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (!widget.isMe) _bookFooter(context, g),
          if (widget.isMe) _settingsOverlay(context),
        ],
      ),
    );
  }

  Widget _topBar(BuildContext context, Guide g) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 11),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: BeegiiColors.line)),
      ),
      child: Row(
        children: [
          if (!widget.isMe)
            Pressable(
              onTap: () =>
                  context.canPop() ? context.pop() : context.go('/explore'),
              child: const SizedBox(
                width: 34,
                height: 34,
                child: Icon(
                  Icons.chevron_left_rounded,
                  size: 24,
                  color: BeegiiColors.ink,
                ),
              ),
            ),
          if (!widget.isMe) const SizedBox(width: 6),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    g.displayHandle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: BeegiiType.sans(size: 15.5, weight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 6),
                const VerifiedBadge(size: 17),
              ],
            ),
          ),
          if (widget.isMe)
            Pressable(
              onTap: () => setState(() => _settingsOpen = true),
              child: const SizedBox(
                width: 34,
                height: 34,
                child: Icon(
                  Icons.settings_outlined,
                  size: 22,
                  color: BeegiiColors.ink,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _headerAndAbout(BuildContext context, Guide g) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 22, 18, 0),
          child: Row(
            children: [
              Container(
                width: 92,
                height: 92,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: BeegiiColors.hair),
                  boxShadow: Shadows.sh2,
                ),
                clipBehavior: Clip.antiAlias,
                child: BeegiiMedia(
                  gradient: BeegiiGradients.byClass(g.clips.first.grad),
                  glyph: MediaGlyph.none,
                ),
              ),
              const SizedBox(width: 18),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      g.name,
                      style: BeegiiType.serif(
                        size: 21,
                        weight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 13),
                    Row(
                      children: [
                        _stat(
                          context,
                          '${g.clips.length}',
                          'Posts',
                          '${g.clips.length} posts',
                        ),
                        const SizedBox(width: 20),
                        _stat(
                          context,
                          g.followers,
                          'Followers',
                          '${g.followers} followers',
                        ),
                        const SizedBox(width: 20),
                        _stat(
                          context,
                          g.following,
                          'Following',
                          'Following ${g.following}',
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      g.role,
                      style: BeegiiType.sans(
                        size: 13.5,
                        weight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: BeegiiColors.accentSoft,
                      borderRadius: BorderRadius.circular(5),
                    ),
                    child: Text(
                      g.badge.toUpperCase(),
                      style: BeegiiType.sans(
                        size: 9,
                        weight: FontWeight.w700,
                        color: BeegiiColors.accentInk,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 5),
              Text(
                g.bio,
                maxLines: _bioExpanded ? null : 2,
                overflow: _bioExpanded ? null : TextOverflow.ellipsis,
                style: BeegiiType.sans(
                  size: 13.5,
                  color: BeegiiColors.ink2,
                  height: 1.55,
                ),
              ),
              GestureDetector(
                onTap: () => setState(() => _bioExpanded = !_bioExpanded),
                child: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    _bioExpanded ? 'less' : 'more',
                    style: BeegiiType.sans(
                      size: 12.5,
                      weight: FontWeight.w700,
                      color: BeegiiColors.accentDeep,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
      ],
    );
  }

  Widget _stat(BuildContext context, String value, String label, String toast) {
    return GestureDetector(
      onTap: () => showBeegiiToast(context, toast),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: BeegiiType.serif(
              size: 16,
              weight: FontWeight.w700,
              height: 1.05,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: BeegiiType.sans(
              size: 10.5,
              weight: FontWeight.w600,
              color: BeegiiColors.ink3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _grid(BuildContext context, Guide g) {
    final tiles = <Widget>[];
    if (_tab == 0) {
      for (final c in g.clips) {
        tiles.add(
          _ProfileTile(
            grad: c.grad,
            chip: c.dur,
            chipMono: true,
            play: true,
            onTap: () => showBeegiiToast(
              context,
              'Playing · ${c.scene}',
              avatarColor: g.color,
              avatarInit: g.init,
            ),
          ),
        );
      }
    } else if (_tab == 1) {
      for (final v in g.visits) {
        tiles.add(
          _ProfileTile(
            grad: v.grad,
            chip: v.flag,
            chipIsEmoji: true,
            title: v.name,
            sub: v.sublabel,
            onTap: () => showBeegiiToast(
              context,
              v.name,
              avatarColor: g.color,
              avatarInit: g.init,
            ),
          ),
        );
      }
    } else {
      for (final s in g.shop) {
        tiles.add(
          _ProfileTile(
            grad: s.grad,
            chip: s.price,
            title: s.title,
            sub: s.desc,
            onTap: () => showBeegiiToast(
              context,
              'Added · ${s.title}',
              avatarColor: g.color,
              avatarInit: g.init,
            ),
          ),
        );
      }
    }
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 3,
          mainAxisSpacing: 3,
          childAspectRatio: 9 / 14,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, i) => tiles[i],
          childCount: tiles.length,
        ),
      ),
    );
  }

  Widget _bookFooter(BuildContext context, Guide g) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: Container(
        decoration: const BoxDecoration(
          color: BeegiiColors.surface,
          border: Border(top: BorderSide(color: BeegiiColors.line)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 13, 18, 13),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            g.price,
                            style: BeegiiType.serif(
                              size: 20,
                              weight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            g.unit,
                            style: BeegiiType.sans(
                              size: 12,
                              weight: FontWeight.w600,
                              color: BeegiiColors.ink3,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 1),
                      Text(
                        g.from,
                        style: BeegiiType.sans(
                          size: 10.5,
                          weight: FontWeight.w500,
                          color: BeegiiColors.ink3,
                        ),
                      ),
                    ],
                  ),
                ),
                DarkButton(
                  'Request to book',
                  onTap: () => showBookSheet(context, g),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _settingsOverlay(BuildContext context) {
    return AnimatedSlide(
      offset: _settingsOpen ? Offset.zero : const Offset(1, 0),
      duration: const Duration(milliseconds: 340),
      curve: Motion.ease,
      child: Visibility(
        visible: _settingsOpen,
        maintainState: true,
        maintainAnimation: true,
        child: _SettingsScreen(
          onClose: () => setState(() => _settingsOpen = false),
        ),
      ),
    );
  }
}

class _ProfileTile extends StatelessWidget {
  const _ProfileTile({
    required this.grad,
    required this.chip,
    required this.onTap,
    this.chipMono = false,
    this.chipIsEmoji = false,
    this.play = false,
    this.title,
    this.sub,
  });
  final String grad;
  final String chip;
  final bool chipMono;
  final bool chipIsEmoji;
  final bool play;
  final String? title;
  final String? sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(13),
        child: BeegiiMedia(
          gradient: BeegiiGradients.byClass(grad),
          glyph: MediaGlyph.none,
          overlay: Stack(
            children: [
              if (play)
                Center(
                  child: Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.24),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.4),
                      ),
                    ),
                    child: const Icon(
                      Icons.play_arrow_rounded,
                      size: 18,
                      color: Colors.white,
                    ),
                  ),
                ),
              Positioned(
                top: 7,
                right: 7,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 5,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0x80080604),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text(
                    chip,
                    style: chipIsEmoji
                        ? BeegiiType.emoji(size: 11)
                        : chipMono
                        ? BeegiiType.mono(
                            size: 8,
                            weight: FontWeight.w500,
                            color: Colors.white,
                          )
                        : BeegiiType.sans(
                            size: 9,
                            weight: FontWeight.w700,
                            color: Colors.white,
                          ),
                  ),
                ),
              ),
              if (title != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(8, 20, 8, 8),
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.bottomCenter,
                        end: Alignment.topCenter,
                        colors: [Color(0xD1080604), Colors.transparent],
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: BeegiiType.sans(
                            size: 9.5,
                            weight: FontWeight.w700,
                            color: Colors.white,
                            height: 1.25,
                          ),
                        ),
                        if (sub != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            sub!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: BeegiiType.sans(
                              size: 8.5,
                              weight: FontWeight.w500,
                              color: Colors.white.withValues(alpha: 0.85),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  _TabBarDelegate({required this.tab, required this.onTap});
  final int tab;
  final ValueChanged<int> onTap;

  static const _icons = [
    Icons.grid_view_rounded,
    Icons.public_rounded,
    Icons.shopping_bag_outlined,
  ];

  @override
  double get minExtent => 48;
  @override
  double get maxExtent => 48;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(
      color: BeegiiColors.bg,
      child: Row(
        children: List.generate(3, (i) {
          final on = tab == i;
          return Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => onTap(i),
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: BeegiiColors.line, width: 1),
                  ),
                ),
                child: SizedBox.expand(
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Icon(
                        _icons[i],
                        size: 21,
                        color: on ? BeegiiColors.ink : BeegiiColors.ink3,
                      ),
                      if (on)
                        Positioned(
                          bottom: 0,
                          child: Container(
                            width: 34,
                            height: 2.5,
                            decoration: BoxDecoration(
                              color: BeegiiColors.accent,
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  @override
  bool shouldRebuild(_TabBarDelegate old) => old.tab != tab;
}

// ---------------------------------------------------------------------------
// Settings sub-screen (Me mode)
// ---------------------------------------------------------------------------

class _SettingsScreen extends StatelessWidget {
  const _SettingsScreen({required this.onClose});
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: BeegiiColors.bg,
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
              child: Row(
                children: [
                  CircleIconButton(
                    icon: Icons.chevron_left_rounded,
                    size: 38,
                    iconSize: 20,
                    onTap: onClose,
                  ),
                  const SizedBox(width: 10),
                  SerifTitle('Settings', size: 20),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 2, 16, 26),
                children: [
                  _sectionLabel('Account'),
                  _listCard(context, MockData.settingsAccount),
                  _sectionLabel('Preferences'),
                  _listCard(context, MockData.settingsPrefs),
                  const SizedBox(height: 14),
                  Pressable(
                    onTap: () => showBeegiiToast(context, 'Logged out'),
                    child: Container(
                      height: 50,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: BeegiiColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFDDDEDC)),
                      ),
                      child: Text(
                        'Log out',
                        style: BeegiiType.sans(
                          size: 13.5,
                          weight: FontWeight.w700,
                          color: BeegiiColors.fun,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Center(
                    child: Text(
                      MockData.version,
                      style: BeegiiType.mono(
                        size: 10.5,
                        weight: FontWeight.w500,
                        color: BeegiiColors.ink4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionLabel(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 14, 4, 10),
      child: Row(
        children: [
          Text(
            text.toUpperCase(),
            style: BeegiiType.sans(
              size: 10.5,
              weight: FontWeight.w700,
              color: BeegiiColors.ink3,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(width: 8),
          const Expanded(child: Divider(height: 1, color: BeegiiColors.line)),
        ],
      ),
    );
  }

  Widget _listCard(BuildContext context, List<SettingsRow> rows) {
    return Container(
      decoration: BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: BeegiiColors.hair),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D2A1F12),
            blurRadius: 2,
            offset: Offset(0, 1),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) _row(context, rows[i], i != 0),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, SettingsRow r, bool divider) {
    return Pressable(
      onTap: () => showBeegiiToast(context, r.title),
      child: Container(
        decoration: BoxDecoration(
          border: divider
              ? const Border(top: BorderSide(color: BeegiiColors.line))
              : null,
        ),
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: r.iconBg,
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(r.icon, size: 19, color: r.iconFg),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    r.title,
                    style: BeegiiType.sans(size: 14, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    r.subtitle,
                    style: BeegiiType.sans(
                      size: 11,
                      weight: FontWeight.w500,
                      color: BeegiiColors.ink3,
                    ),
                  ),
                ],
              ),
            ),
            if (r.count != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: BeegiiColors.accentSoft,
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(
                  r.count!,
                  style: BeegiiType.mono(
                    size: 11,
                    weight: FontWeight.w500,
                    color: BeegiiColors.accentDeep,
                  ),
                ),
              ),
              const SizedBox(width: 8),
            ],
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: BeegiiColors.ink4,
            ),
          ],
        ),
      ),
    );
  }
}
