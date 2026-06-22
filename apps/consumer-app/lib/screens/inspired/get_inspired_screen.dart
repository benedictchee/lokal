import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/tokens.dart';
import '../../theme/typography.dart';
import '../../widgets/beegii_media.dart';
import '../../widgets/bee.dart';
import '../../widgets/primitives.dart';

class GetInspiredScreen extends StatefulWidget {
  const GetInspiredScreen({super.key});

  @override
  State<GetInspiredScreen> createState() => _GetInspiredScreenState();
}

class _GetInspiredScreenState extends State<GetInspiredScreen> {
  String _filter = 'all';

  List<Destination> get _seasonal => MockData.destinations
      .where((d) => d.months.contains(MockData.thisMonth))
      .take(6)
      .toList();

  List<Destination> get _grid => _filter == 'all'
      ? MockData.destinations
      : MockData.destinations.where((d) => d.tags.contains(_filter)).toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BeegiiColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _appBar(context),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: 28),
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(18, 2, 18, 6),
                    child: const SearchField(readOnly: true),
                  ),
                  _filterRow(),
                  _seasonalSection(context),
                  _sectionHeader(
                    'Trending now',
                    metaIcon: Icons.auto_awesome,
                    meta: 'Loved by travellers',
                  ),
                  _trendingGrid(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _appBar(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 4, 18, 8),
      child: Row(
        children: [
          Pressable(
            onTap: () => context.pop(),
            child: Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: BeegiiColors.surface,
                shape: BoxShape.circle,
                border: Border.all(color: BeegiiColors.hair),
                boxShadow: Shadows.sh2,
              ),
              child: const Icon(
                Icons.chevron_left_rounded,
                size: 22,
                color: BeegiiColors.ink,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'NEW TRIP',
                  style: BeegiiType.mono(
                    size: 10,
                    weight: FontWeight.w500,
                    color: BeegiiColors.ink3,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 1),
                SerifTitle('Where to?', size: 19),
              ],
            ),
          ),
          CircleIconButton(
            icon: Icons.auto_awesome_outlined,
            onTap: () {},
            size: 38,
            iconSize: 19,
          ),
        ],
      ),
    );
  }

  Widget _filterRow() {
    return SizedBox(
      height: 56,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 4),
        itemCount: MockData.filters.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final (id, label, emoji) = MockData.filters[i];
          final on = _filter == id;
          return Pressable(
            onTap: () => setState(() => _filter = id),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: on ? BeegiiColors.ink : BeegiiColors.surface,
                borderRadius: BorderRadius.circular(Radii.pill),
                border: Border.all(
                  color: on ? BeegiiColors.ink : const Color(0xFFDDDEDC),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (emoji.isNotEmpty) ...[
                    Text(emoji, style: BeegiiType.emoji(size: 13)),
                    const SizedBox(width: 6),
                  ],
                  Text(
                    label,
                    style: BeegiiType.sans(
                      size: 12.5,
                      weight: FontWeight.w600,
                      color: on ? Colors.white : BeegiiColors.ink2,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _sectionHeader(String title, {IconData? metaIcon, String? meta}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SerifTitle(title, size: 18),
          const Spacer(),
          if (meta != null) ...[
            if (metaIcon != null) ...[
              Icon(metaIcon, size: 13, color: BeegiiColors.accentDeep),
              const SizedBox(width: 4),
            ],
            Text(
              meta,
              style: BeegiiType.sans(
                size: 11,
                weight: FontWeight.w500,
                color: BeegiiColors.ink3,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _seasonalSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionHeader(
          'Great in June',
          metaIcon: Icons.wb_sunny_outlined,
          meta: 'In season right now',
        ),
        SizedBox(
          height: 184,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 4),
            itemCount: _seasonal.length,
            separatorBuilder: (_, _) => const SizedBox(width: 11),
            itemBuilder: (context, i) => _SeasonalCard(dest: _seasonal[i]),
          ),
        ),
      ],
    );
  }

  Widget _trendingGrid(BuildContext context) {
    final list = _grid;
    if (list.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 30),
        child: Center(
          child: Text(
            'No destinations match that filter yet — more coming soon.',
            style: BeegiiType.sans(size: 12.5, color: BeegiiColors.ink3),
          ),
        ),
      );
    }
    final rows = <Widget>[];
    for (var i = 0; i < list.length; i += 2) {
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 13),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _DestCard(dest: list[i])),
              const SizedBox(width: 13),
              Expanded(
                child: i + 1 < list.length
                    ? _DestCard(dest: list[i + 1])
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
      child: Column(children: rows),
    );
  }
}

class _SeasonalCard extends StatelessWidget {
  const _SeasonalCard({required this.dest});
  final Destination dest;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: () => showDestinationSheet(context, dest),
      child: SizedBox(
        width: 172,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            boxShadow: Shadows.sh2,
            border: Border.all(color: BeegiiColors.hair),
          ),
          clipBehavior: Clip.antiAlias,
          child: SizedBox(
            height: 128,
            child: BeegiiMedia(
              gradient: BeegiiGradients.destination[dest.gradKey],
              glyph: MediaGlyph.none,
              scrim: true,
              overlay: Stack(
                children: [
                  Positioned(
                    top: 10,
                    left: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.wb_sunny_outlined,
                            size: 11,
                            color: BeegiiColors.accentDeep,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            dest.best,
                            style: BeegiiType.sans(
                              size: 10,
                              weight: FontWeight.w700,
                              color: BeegiiColors.ink,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Positioned(
                    left: 14,
                    right: 14,
                    bottom: 13,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          dest.name,
                          style: BeegiiType.serif(
                            size: 17,
                            weight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 1),
                        EmojiLabel(
                          dest.flag,
                          dest.country,
                          style: BeegiiType.sans(
                            size: 11,
                            weight: FontWeight.w500,
                            color: Colors.white.withValues(alpha: 0.92),
                          ),
                        ),
                      ],
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

class _DestCard extends StatelessWidget {
  const _DestCard({required this.dest});
  final Destination dest;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: () => showDestinationSheet(context, dest),
      child: Container(
        decoration: BoxDecoration(
          color: BeegiiColors.surface,
          borderRadius: BorderRadius.circular(18),
          boxShadow: Shadows.sh2,
          border: Border.all(color: BeegiiColors.hair),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 116,
              child: BeegiiMedia(
                gradient: BeegiiGradients.destination[dest.gradKey],
                glyph: MediaGlyph.pin,
                overlay: Positioned(
                  top: 9,
                  right: 9,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: BeegiiColors.ink.withValues(alpha: 0.42),
                      borderRadius: BorderRadius.circular(7),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.play_arrow_rounded,
                          size: 11,
                          color: Colors.white,
                        ),
                        const SizedBox(width: 3),
                        Text(
                          '${dest.reels} reels',
                          style: BeegiiType.sans(
                            size: 10,
                            weight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(13, 11, 13, 13),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    dest.name,
                    style: BeegiiType.serif(
                      size: 16,
                      weight: FontWeight.w700,
                      height: 1.1,
                    ),
                  ),
                  const SizedBox(height: 3),
                  EmojiLabel(
                    dest.flag,
                    dest.country,
                    style: BeegiiType.sans(
                      size: 11.5,
                      weight: FontWeight.w500,
                      color: BeegiiColors.ink3,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    dest.vibe,
                    style: BeegiiType.sans(
                      size: 11,
                      weight: FontWeight.w600,
                      color: BeegiiColors.accentDeep,
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
}

// ---------------------------------------------------------------------------
// Destination configuration bottom sheet
// ---------------------------------------------------------------------------

void showDestinationSheet(BuildContext context, Destination dest) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: const Color(0x73140A0A),
    builder: (_) => _DestSheet(dest: dest),
  );
}

class _DestSheet extends StatefulWidget {
  const _DestSheet({required this.dest});
  final Destination dest;

  @override
  State<_DestSheet> createState() => _DestSheetState();
}

class _DestSheetState extends State<_DestSheet> {
  String _from = 'sin';
  int? _when;
  int _trav = 2;
  late TextEditingController _name;
  final _rng = math.Random();

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(
      text: '${widget.dest.name} ${widget.dest.suffix}',
    );
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _shuffle() {
    final pool = MockData.nameSuffixes;
    String next;
    do {
      next = '${widget.dest.name} ${pool[_rng.nextInt(pool.length)]}';
    } while (next == _name.text && pool.length > 1);
    setState(() => _name.text = next);
  }

  void _create() {
    final d = widget.dest;
    final preset = MockData.whenPresets[_when!];
    Navigator.of(context).pop();
    _showBuilding(
      context,
      d,
      MockData.origins.firstWhere((o) => o.id == _from).city,
      preset.days,
      _name.text.isEmpty ? '${d.name} trip' : _name.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.dest;
    return DraggableScrollableSheet(
      initialChildSize: 0.92,
      minChildSize: 0.5,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Container(
        decoration: const BoxDecoration(
          color: BeegiiColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: ListView(
          controller: scrollController,
          padding: EdgeInsets.fromLTRB(
            20,
            10,
            20,
            16 + MediaQuery.of(context).padding.bottom,
          ),
          children: [
            Center(
              child: Container(
                width: 38,
                height: 5,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: const Color(0xFFDDDEDC),
                  borderRadius: BorderRadius.circular(5),
                ),
              ),
            ),
            _hero(d),
            const SizedBox(height: 13),
            _facts(d),
            _group(
              'A taste, from travellers',
              trailing: 'See all ${d.reels}',
              child: _reelStrip(d),
            ),
            _group('Flying from', child: _fromChips()),
            _group('When', child: _whenPresets()),
            _group('Travellers', child: _travRow()),
            _group('Trip name', child: _nameField()),
            const SizedBox(height: 18),
            PrimaryButton(
              'Create trip',
              enabled: _when != null,
              trailingIcon: _when != null
                  ? Icons.auto_awesome
                  : Icons.arrow_forward_rounded,
              onTap: _when != null ? _create : null,
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero(Destination d) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: SizedBox(
        height: 128,
        child: BeegiiMedia(
          gradient: BeegiiGradients.destination[d.gradKey],
          glyph: MediaGlyph.none,
          scrim: true,
          overlay: Stack(
            children: [
              Positioned(
                top: 11,
                right: 11,
                child: CircleIconButton(
                  icon: Icons.close_rounded,
                  bg: Colors.white.withValues(alpha: 0.92),
                  fg: BeegiiColors.ink,
                  size: 32,
                  iconSize: 18,
                  shadow: false,
                  onTap: () => Navigator.of(context).pop(),
                ),
              ),
              Positioned(
                left: 14,
                right: 14,
                bottom: 14,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'DESTINATION',
                      style: BeegiiType.mono(
                        size: 9.5,
                        weight: FontWeight.w500,
                        color: Colors.white.withValues(alpha: 0.92),
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      d.name,
                      style: BeegiiType.serif(
                        size: 26,
                        weight: FontWeight.w700,
                        color: Colors.white,
                        height: 1.02,
                      ),
                    ),
                    const SizedBox(height: 3),
                    EmojiLabel(
                      d.flag,
                      '${d.country} · ${d.reels} traveller reels',
                      style: BeegiiType.sans(
                        size: 12,
                        weight: FontWeight.w500,
                        color: Colors.white.withValues(alpha: 0.94),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _facts(Destination d) {
    Widget fact(IconData icon, String label, String value) => Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFF2F1ED),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 12, color: BeegiiColors.accentDeep),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: BeegiiType.sans(
                    size: 10,
                    weight: FontWeight.w600,
                    color: BeegiiColors.ink3,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: BeegiiType.sans(size: 13.5, weight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
    return Row(
      children: [
        fact(Icons.wb_sunny_outlined, 'Best', d.best),
        const SizedBox(width: 8),
        fact(Icons.account_balance_wallet_outlined, 'Est.', d.budget),
        const SizedBox(width: 8),
        fact(Icons.flight_takeoff_rounded, 'Flight', d.flight),
      ],
    );
  }

  Widget _group(String label, {required Widget child, String? trailing}) {
    return Padding(
      padding: const EdgeInsets.only(top: 17),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                label.toUpperCase(),
                style: BeegiiType.sans(
                  size: 11,
                  weight: FontWeight.w700,
                  color: BeegiiColors.ink3,
                  letterSpacing: 0.7,
                ),
              ),
              const Spacer(),
              if (trailing != null)
                Text(
                  trailing,
                  style: BeegiiType.sans(
                    size: 11,
                    weight: FontWeight.w600,
                    color: BeegiiColors.accentDeep,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  Widget _reelStrip(Destination d) {
    const durs = ['0:48', '1:24', '0:32'];
    final grads = [
      BeegiiGradients.destination[d.gradKey]!,
      BeegiiGradients.cssDark,
      BeegiiGradients.destination[d.gradKey]!,
    ];
    return Row(
      children: List.generate(3, (i) {
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: i < 2 ? 8 : 0),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: SizedBox(
                height: 64,
                child: BeegiiMedia(
                  gradient: grads[i],
                  glyph: MediaGlyph.none,
                  overlay: Stack(
                    children: [
                      Center(
                        child: Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.9),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.play_arrow_rounded,
                            size: 16,
                            color: BeegiiColors.ink,
                          ),
                        ),
                      ),
                      Positioned(
                        right: 6,
                        bottom: 5,
                        child: Text(
                          durs[i],
                          style: BeegiiType.sans(
                            size: 9,
                            weight: FontWeight.w600,
                            color: Colors.white,
                            shadow: true,
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
      }),
    );
  }

  Widget _fromChips() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final o in MockData.origins)
          Pressable(
            onTap: () => setState(() => _from = o.id),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
              decoration: BoxDecoration(
                color: _from == o.id ? BeegiiColors.ink : BeegiiColors.surface,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: _from == o.id
                      ? BeegiiColors.ink
                      : const Color(0xFFDDDEDC),
                ),
              ),
              child: EmojiLabel(
                o.flag,
                o.city,
                style: BeegiiType.sans(
                  size: 13.5,
                  weight: FontWeight.w600,
                  color: _from == o.id ? Colors.white : BeegiiColors.ink,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _whenPresets() {
    return Column(
      children: [
        for (var i = 0; i < MockData.whenPresets.length; i++)
          _whenRow(i, MockData.whenPresets[i]),
      ],
    );
  }

  Widget _whenRow(int i, WhenPreset p) {
    final on = _when == i;
    return Pressable(
      onTap: () => setState(() => _when = i),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
        decoration: BoxDecoration(
          color: BeegiiColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: on ? BeegiiColors.ink : BeegiiColors.line,
            width: on ? 2 : 1,
          ),
          boxShadow: Shadows.sh2,
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: on ? BeegiiColors.accentSoft : const Color(0xFFF2F1ED),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Icon(
                p.sparkle ? Icons.auto_awesome : Icons.calendar_today_outlined,
                size: 19,
                color: on ? BeegiiColors.accentDeep : BeegiiColors.ink2,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    p.title,
                    style: BeegiiType.sans(size: 14, weight: FontWeight.w700),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    p.subtitle,
                    style: BeegiiType.sans(
                      size: 11.5,
                      weight: FontWeight.w500,
                      color: BeegiiColors.ink3,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: on ? BeegiiColors.ink : Colors.transparent,
                border: Border.all(
                  color: on ? BeegiiColors.ink : const Color(0xFFDDDEDC),
                  width: 2,
                ),
              ),
              child: on
                  ? const Center(
                      child: SizedBox(
                        width: 8,
                        height: 8,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: BeegiiColors.accent,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                    )
                  : null,
            ),
          ],
        ),
      ),
    );
  }

  Widget _travRow() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
      decoration: BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BeegiiColors.line),
        boxShadow: Shadows.sh2,
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFFF2F1ED),
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Icon(
              Icons.group_outlined,
              size: 19,
              color: BeegiiColors.ink2,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Who's going?",
                  style: BeegiiType.sans(size: 14, weight: FontWeight.w700),
                ),
                const SizedBox(height: 1),
                Text(
                  _trav == 1 ? '1 traveller' : '$_trav travellers',
                  style: BeegiiType.sans(
                    size: 11.5,
                    weight: FontWeight.w500,
                    color: BeegiiColors.ink3,
                  ),
                ),
              ],
            ),
          ),
          CountStepper(
            value: _trav,
            onChanged: (v) => setState(() => _trav = v),
            min: 1,
            max: 9,
          ),
        ],
      ),
    );
  }

  Widget _nameField() {
    return Container(
      padding: const EdgeInsets.fromLTRB(13, 6, 8, 6),
      decoration: BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BeegiiColors.line),
        boxShadow: Shadows.sh2,
      ),
      child: Row(
        children: [
          const Icon(
            Icons.edit_outlined,
            size: 18,
            color: BeegiiColors.accentDeep,
          ),
          const SizedBox(width: 11),
          Expanded(
            child: TextField(
              controller: _name,
              maxLength: 40,
              style: BeegiiType.sans(size: 15, weight: FontWeight.w700),
              cursorColor: BeegiiColors.ink,
              decoration: const InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                counterText: '',
              ),
            ),
          ),
          Pressable(
            onTap: _shuffle,
            child: Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: const Color(0xFFF2F1ED),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.shuffle_rounded,
                size: 17,
                color: BeegiiColors.ink2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Building overlay
// ---------------------------------------------------------------------------

void _showBuilding(
  BuildContext context,
  Destination d,
  String fromCity,
  int days,
  String title,
) {
  showGeneralDialog<void>(
    context: context,
    barrierDismissible: false,
    barrierColor: BeegiiColors.bg,
    transitionDuration: const Duration(milliseconds: 240),
    pageBuilder: (_, _, _) =>
        _BuildingOverlay(dest: d, fromCity: fromCity, days: days, title: title),
  );
}

class _BuildingOverlay extends StatefulWidget {
  const _BuildingOverlay({
    required this.dest,
    required this.fromCity,
    required this.days,
    required this.title,
  });
  final Destination dest;
  final String fromCity;
  final int days;
  final String title;

  @override
  State<_BuildingOverlay> createState() => _BuildingOverlayState();
}

class _BuildingOverlayState extends State<_BuildingOverlay>
    with TickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 1),
  )..repeat();
  late final AnimationController _orbit = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  )..repeat();
  late final AnimationController _bob = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat(reverse: true);
  int _step = 0;
  Timer? _stepTimer;
  Timer? _doneTimer;

  @override
  void initState() {
    super.initState();
    _stepTimer = Timer.periodic(const Duration(milliseconds: 620), (t) {
      if (_step < MockData.buildSteps.length - 1) {
        setState(() => _step++);
      } else {
        t.cancel();
      }
    });
    _doneTimer = Timer(const Duration(milliseconds: 2900), () {
      if (!mounted) return;
      Navigator.of(context).pop(); // close building dialog
      context.pushReplacement(
        '/planner?title=${Uri.encodeComponent(widget.title)}',
      );
    });
  }

  @override
  void dispose() {
    _spin.dispose();
    _orbit.dispose();
    _bob.dispose();
    _stepTimer?.cancel();
    _doneTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BeegiiColors.bg,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 150,
              height: 150,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  RotationTransition(
                    turns: _spin,
                    child: Container(
                      width: 150,
                      height: 150,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: BeegiiColors.accentSoft,
                          width: 3,
                        ),
                      ),
                      child: CustomPaint(
                        painter: _ArcPainter(BeegiiColors.accent),
                      ),
                    ),
                  ),
                  RotationTransition(
                    turns: _orbit,
                    child: Align(
                      alignment: Alignment.topCenter,
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: const BoxDecoration(
                          color: Color(0xFF3667B0),
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ),
                  AnimatedBuilder(
                    animation: _bob,
                    builder: (context, child) => Transform.translate(
                      offset: Offset(0, -7 * _bob.value),
                      child: child,
                    ),
                    child: const BeeMascot(size: 78),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            Text(
              'Building your trip',
              style: BeegiiType.serif(size: 21, weight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              '${widget.dest.name} · ${widget.days} days · from ${widget.fromCity}',
              style: BeegiiType.sans(
                size: 13,
                weight: FontWeight.w500,
                color: BeegiiColors.ink2,
              ),
            ),
            const SizedBox(height: 22),
            SizedBox(
              width: 230,
              child: Column(
                children: [
                  for (var i = 0; i < MockData.buildSteps.length; i++)
                    _buildStep(i, MockData.buildSteps[i]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStep(int i, String label) {
    final done = i < _step;
    final cur = i == _step;
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        children: [
          Container(
            width: 21,
            height: 21,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: done ? BeegiiColors.good : Colors.transparent,
              border: Border.all(
                color: done
                    ? BeegiiColors.good
                    : (cur ? BeegiiColors.accent : const Color(0xFFDDDEDC)),
                width: 2,
              ),
            ),
            child: done
                ? const Icon(Icons.check_rounded, size: 12, color: Colors.white)
                : null,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: BeegiiType.sans(
                size: 12.5,
                weight: FontWeight.w600,
                color: (done || cur) ? BeegiiColors.ink : BeegiiColors.ink3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ArcPainter extends CustomPainter {
  _ArcPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..color = color;
    canvas.drawArc(
      Rect.fromLTWH(1.5, 1.5, size.width - 3, size.height - 3),
      -math.pi / 2,
      math.pi / 2,
      false,
      paint,
    );
  }

  @override
  bool shouldRepaint(_ArcPainter old) => old.color != color;
}
