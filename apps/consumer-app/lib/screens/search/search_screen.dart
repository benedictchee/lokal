import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../router.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/tokens.dart';
import '../../theme/typography.dart';
import '../../widgets/beegii_media.dart';
import '../../widgets/primitives.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  String _query = '';

  List<SearchReel> get _results {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return MockData.searchReels;
    return MockData.searchReels
        .where((r) => '${r.title} ${r.sub} ${r.kw}'.toLowerCase().contains(q))
        .toList();
  }

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocus);
  }

  void _onFocus() => setState(() {});

  @override
  void dispose() {
    _focus.removeListener(_onFocus);
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final results = _results;
    final hasQuery = _query.trim().isNotEmpty;
    return Scaffold(
      backgroundColor: BeegiiColors.bg,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _topBar(context),
          Expanded(
            child: results.isEmpty
                ? _empty()
                : CustomScrollView(
                    slivers: [
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
                        sliver: SliverToBoxAdapter(
                          child: _sectionTitle(hasQuery, results.length),
                        ),
                      ),
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(
                          14,
                          0,
                          14,
                          Layout.dockReserve + 20,
                        ),
                        sliver: SliverGrid(
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 3,
                                crossAxisSpacing: 3,
                                mainAxisSpacing: 3,
                                childAspectRatio: 9 / 14,
                              ),
                          delegate: SliverChildBuilderDelegate(
                            (context, i) => _ReelCard(reel: results[i]),
                            childCount: results.length,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _topBar(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
        decoration: const BoxDecoration(
          color: BeegiiColors.bg,
          border: Border(bottom: BorderSide(color: BeegiiColors.line)),
        ),
        child: Row(
          children: [
            Pressable(
              onTap: () => context.go('/explore'),
              child: const SizedBox(
                width: 36,
                height: 36,
                child: Icon(
                  Icons.chevron_left_rounded,
                  size: 26,
                  color: BeegiiColors.ink,
                ),
              ),
            ),
            Expanded(
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                curve: Motion.ease,
                height: 42,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: BeegiiColors.surface,
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(
                    color: _focus.hasFocus
                        ? BeegiiColors.accent
                        : const Color(0xFFDDDEDC),
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x0D2A1F12),
                      blurRadius: 2,
                      offset: Offset(0, 1),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.search_rounded,
                      size: 19,
                      color: BeegiiColors.ink3,
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        focusNode: _focus,
                        onChanged: (v) => setState(() => _query = v),
                        textInputAction: TextInputAction.search,
                        style: BeegiiType.sans(
                          size: 14.5,
                          weight: FontWeight.w500,
                        ),
                        cursorColor: BeegiiColors.ink,
                        decoration: InputDecoration(
                          isCollapsed: true,
                          border: InputBorder.none,
                          hintText: 'Search reels, locals, places',
                          hintStyle: BeegiiType.sans(
                            size: 14.5,
                            weight: FontWeight.w500,
                            color: BeegiiColors.ink3,
                          ),
                        ),
                      ),
                    ),
                    if (_query.isNotEmpty)
                      GestureDetector(
                        onTap: () {
                          _controller.clear();
                          setState(() => _query = '');
                          _focus.requestFocus();
                        },
                        child: Container(
                          width: 20,
                          height: 20,
                          alignment: Alignment.center,
                          decoration: const BoxDecoration(
                            color: BeegiiColors.line,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.close_rounded,
                            size: 13,
                            color: BeegiiColors.ink2,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(bool hasQuery, int count) {
    return RichText(
      text: TextSpan(
        text: '${hasQuery ? 'RESULTS' : 'POPULAR REELS'} ',
        style: BeegiiType.sans(
          size: 11,
          weight: FontWeight.w700,
          color: BeegiiColors.ink3,
          letterSpacing: 1.2,
        ),
        children: [
          if (count > 0)
            TextSpan(
              text: '· $count',
              style: BeegiiType.sans(
                size: 11,
                weight: FontWeight.w700,
                color: BeegiiColors.accentDeep,
                letterSpacing: 1.2,
              ),
            ),
        ],
      ),
    );
  }

  Widget _empty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: Text(
          'No reels match that yet. Try a place, a local, or a vibe.',
          textAlign: TextAlign.center,
          style: BeegiiType.sans(
            size: 13.5,
            color: BeegiiColors.ink3,
            height: 1.5,
          ),
        ),
      ),
    );
  }
}

class _ReelCard extends StatelessWidget {
  const _ReelCard({required this.reel});
  final SearchReel reel;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: () => context.openGuide(reel.gid),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(13),
        child: BeegiiMedia(
          gradient: BeegiiGradients.byClass(reel.grad),
          glyph: MediaGlyph.none,
          overlay: Stack(
            children: [
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
                    reel.dur,
                    style: BeegiiType.mono(
                      size: 8,
                      weight: FontWeight.w500,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
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
                        reel.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: BeegiiType.sans(
                          size: 9.5,
                          weight: FontWeight.w700,
                          color: Colors.white,
                          height: 1.25,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        reel.sub,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: BeegiiType.sans(
                          size: 8.5,
                          weight: FontWeight.w500,
                          color: Colors.white.withValues(alpha: 0.85),
                        ),
                      ),
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
