import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/tokens.dart';
import '../../theme/typography.dart';
import '../../widgets/primitives.dart';

IconData _stopIcon(StopIcon s) => switch (s) {
  StopIcon.plane => Icons.flight_rounded,
  StopIcon.car => Icons.local_taxi_outlined,
  StopIcon.hotel => Icons.hotel_outlined,
  StopIcon.walk => Icons.directions_walk_rounded,
  StopIcon.ticket => Icons.confirmation_number_outlined,
};

class PlannerScreen extends StatefulWidget {
  const PlannerScreen({super.key, this.title});
  final String? title;

  @override
  State<PlannerScreen> createState() => _PlannerScreenState();
}

class _PlannerScreenState extends State<PlannerScreen> {
  bool _hintShown = true;
  Timer? _hintTimer;

  @override
  void initState() {
    super.initState();
    _hintTimer = Timer(const Duration(milliseconds: 4200), () {
      if (mounted) setState(() => _hintShown = false);
    });
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final stops = MockData.plannerStops;
    final days = stops.map((s) => s.day).toSet().toList()..sort();

    final children = <Widget>[];
    for (final day in days) {
      children.add(_dayHeader(day));
      final dayStops = stops.where((s) => s.day == day).toList();
      for (var i = 0; i < dayStops.length; i++) {
        final globalIndex = stops.indexOf(dayStops[i]);
        children.add(
          _TimelineItem(
            stop: dayStops[i],
            isFirst: globalIndex == 0,
            isLast: globalIndex == stops.length - 1,
            onHintHide: () {
              if (_hintShown) setState(() => _hintShown = false);
            },
          ),
        );
      }
    }

    return Scaffold(
      backgroundColor: BeegiiColors.bg,
      body: Stack(
        children: [
          SafeArea(
            bottom: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _appBar(context),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 2, 16, 28),
                    children: children,
                  ),
                ),
              ],
            ),
          ),
          if (_hintShown) _hint(context),
        ],
      ),
    );
  }

  Widget _appBar(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 4, 18, 12),
      child: Row(
        children: [
          CircleIconButton(
            icon: Icons.chevron_left_rounded,
            size: 38,
            iconSize: 22,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: SerifTitle(widget.title ?? MockData.plannerTitle, size: 22),
          ),
        ],
      ),
    );
  }

  Widget _dayHeader(int day) {
    return Padding(
      padding: EdgeInsets.fromLTRB(4, day == 1 ? 6 : 16, 4, 8),
      child: Row(
        children: [
          Text(
            'DAY $day',
            style: BeegiiType.mono(
              size: 10.5,
              weight: FontWeight.w600,
              color: BeegiiColors.ink2,
              letterSpacing: 0.9,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            MockData.dayDates[day] ?? '',
            style: BeegiiType.sans(
              size: 11.5,
              weight: FontWeight.w500,
              color: BeegiiColors.ink3,
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(child: Divider(height: 1, color: BeegiiColors.line)),
        ],
      ),
    );
  }

  Widget _hint(BuildContext context) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: MediaQuery.of(context).padding.bottom + 18,
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 9),
          decoration: BoxDecoration(
            color: BeegiiColors.ink.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(12),
            boxShadow: Shadows.sh3,
          ),
          child: Text(
            'Tap Show more or Explore on any stop',
            style: BeegiiType.sans(
              size: 11.5,
              weight: FontWeight.w500,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}

class _TimelineItem extends StatelessWidget {
  const _TimelineItem({
    required this.stop,
    required this.isFirst,
    required this.isLast,
    required this.onHintHide,
  });
  final PlannerStop stop;
  final bool isFirst;
  final bool isLast;
  final VoidCallback onHintHide;

  @override
  Widget build(BuildContext context) {
    final dim = stop.rail == RailType.info;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _rail(),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 11),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    stop.time,
                    style: BeegiiType.mono(
                      size: 11.5,
                      weight: dim ? FontWeight.w500 : FontWeight.w700,
                      color: dim ? BeegiiColors.ink3 : BeegiiColors.ink2,
                      letterSpacing: 0.2,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    stop.title,
                    style: BeegiiType.sans(
                      size: 15,
                      weight: FontWeight.w600,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    stop.summary,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: BeegiiType.sans(
                      size: 12,
                      weight: FontWeight.w500,
                      color: BeegiiColors.ink2,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      _actButton(
                        'Show more',
                        Icons.keyboard_arrow_down_rounded,
                        bg: BeegiiColors.surface,
                        fg: BeegiiColors.ink2,
                        border: const Color(0xFFDDDEDC),
                        onTap: () {
                          onHintHide();
                          showPlanSheet(context, stop);
                        },
                      ),
                      const SizedBox(width: 8),
                      _actButton(
                        'Explore',
                        Icons.explore_outlined,
                        bg: BeegiiColors.accentSoft,
                        fg: BeegiiColors.accentDeep,
                        onTap: () {
                          onHintHide();
                          showStoriesSheet(context, stop);
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _rail() {
    return SizedBox(
      width: 30,
      child: Stack(
        children: [
          if (!isFirst)
            const Positioned(
              left: 14.25,
              top: 0,
              height: 26,
              child: SizedBox(
                width: 1.5,
                child: ColoredBox(color: BeegiiColors.line),
              ),
            ),
          if (!isLast)
            const Positioned(
              left: 14.25,
              top: 26,
              bottom: 0,
              child: SizedBox(
                width: 1.5,
                child: ColoredBox(color: BeegiiColors.line),
              ),
            ),
          Positioned(
            top: 11,
            left: 0,
            child: SizedBox(
              width: 30,
              height: 30,
              child: Icon(_stopIcon(stop.icon), size: 20, color: stop.tone),
            ),
          ),
          if (stop.rail == RailType.unbooked)
            Positioned(
              top: 8,
              left: 21,
              child: Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(
                  color: BeegiiColors.accent,
                  shape: BoxShape.circle,
                  border: Border.all(color: BeegiiColors.bg, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _actButton(
    String label,
    IconData icon, {
    required Color bg,
    required Color fg,
    Color? border,
    required VoidCallback onTap,
  }) {
    return Pressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(9),
          border: border != null ? Border.all(color: border) : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: 6),
            Text(
              label,
              style: BeegiiType.sans(
                size: 12,
                weight: FontWeight.w700,
                color: fg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Plan sheet
// ---------------------------------------------------------------------------

Future<void> showPlanSheet(BuildContext context, PlannerStop stop) {
  return _showSheet(context, _PlanSheet(stop: stop));
}

Future<void> showStoriesSheet(BuildContext context, PlannerStop stop) {
  return _showSheet(context, _StoriesSheet(stop: stop));
}

Future<void> _showSheet(BuildContext context, Widget child) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: const Color(0x801B1E22),
    builder: (_) => BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 3, sigmaY: 3),
      child: child,
    ),
  );
}

class _SheetScaffold extends StatelessWidget {
  const _SheetScaffold({
    required this.kicker,
    required this.title,
    this.subtitle,
    required this.body,
  });
  final String kicker;
  final String title;
  final Widget? subtitle;
  final Widget body;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.9,
      ),
      decoration: const BoxDecoration(
        color: BeegiiColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 10, bottom: 4),
            child: Container(
              width: 40,
              height: 5,
              decoration: BoxDecoration(
                color: const Color(0xFFDDDEDC),
                borderRadius: BorderRadius.circular(5),
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(20, 6, 18, 14),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: BeegiiColors.line)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        kicker.toUpperCase(),
                        style: BeegiiType.sans(
                          size: 10,
                          weight: FontWeight.w700,
                          color: BeegiiColors.ink3,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        title,
                        style: BeegiiType.serif(
                          size: 23,
                          weight: FontWeight.w700,
                        ),
                      ),
                      if (subtitle != null) ...[
                        const SizedBox(height: 7),
                        subtitle!,
                      ],
                    ],
                  ),
                ),
                CircleIconButton(
                  icon: Icons.close_rounded,
                  bg: BeegiiColors.bg,
                  fg: BeegiiColors.ink2,
                  size: 32,
                  iconSize: 18,
                  shadow: false,
                  onTap: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          Flexible(child: body),
        ],
      ),
    );
  }
}

class _PlanSheet extends StatefulWidget {
  const _PlanSheet({required this.stop});
  final PlannerStop stop;

  @override
  State<_PlanSheet> createState() => _PlanSheetState();
}

class _PlanSheetState extends State<_PlanSheet> {
  bool _booked = false;
  late final List<ChecklistStep> _steps = widget.stop.plan.steps
      .map((s) => ChecklistStep(s))
      .toList();
  late final TextEditingController _noteCtrl = TextEditingController(
    text: widget.stop.plan.note,
  );

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.stop.plan;
    final rows = <(String, String)>[
      ('Price', p.price),
      ('Status', p.status),
      if (p.refund != '—') ('Cancellation', p.refund),
    ];
    return _SheetScaffold(
      kicker: 'Plan this stop',
      title: widget.stop.title,
      subtitle: Row(
        children: [
          const Icon(
            Icons.schedule_rounded,
            size: 13,
            color: BeegiiColors.ink2,
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              p.window,
              style: BeegiiType.mono(
                size: 11.5,
                weight: FontWeight.w500,
                color: BeegiiColors.ink2,
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(
          20,
          16,
          20,
          26 + MediaQuery.of(context).padding.bottom,
        ),
        children: [
          _label('Booking'),
          for (var i = 0; i < rows.length; i++)
            _bookingRow(rows[i].$1, rows[i].$2, i == rows.length - 1),
          if (p.cta != null) ...[
            const SizedBox(height: 13),
            _ctaButton(p.cta!),
          ],
          const SizedBox(height: 20),
          _label('Notes'),
          const SizedBox(height: 9),
          _note(),
          const SizedBox(height: 20),
          _label('Checklist'),
          for (var i = 0; i < _steps.length; i++) _checklistRow(i),
        ],
      ),
    );
  }

  Widget _label(String t) => Text(
    t.toUpperCase(),
    style: BeegiiType.sans(
      size: 10,
      weight: FontWeight.w700,
      color: BeegiiColors.ink3,
      letterSpacing: 1,
    ),
  );

  Widget _bookingRow(String k, String v, bool last) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 7),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: BeegiiColors.line)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(k, style: BeegiiType.sans(size: 13, color: BeegiiColors.ink3)),
          const Spacer(),
          Flexible(
            child: Text(
              v,
              textAlign: TextAlign.right,
              style: BeegiiType.sans(size: 13, weight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _ctaButton(String label) {
    return Pressable(
      onTap: _booked ? null : () => setState(() => _booked = true),
      child: Container(
        height: 50,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: _booked ? BeegiiColors.goodSoft : BeegiiColors.ink,
          borderRadius: BorderRadius.circular(13),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (_booked) ...[
              const Icon(
                Icons.check_rounded,
                size: 17,
                color: BeegiiColors.good,
              ),
              const SizedBox(width: 7),
            ],
            Text(
              _booked ? 'Booked' : label,
              style: BeegiiType.sans(
                size: 14,
                weight: FontWeight.w700,
                color: _booked ? BeegiiColors.good : Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _note() {
    return TextField(
      controller: _noteCtrl,
      maxLines: 3,
      style: BeegiiType.sans(size: 13, height: 1.5),
      cursorColor: BeegiiColors.ink,
      decoration: InputDecoration(
        filled: true,
        fillColor: BeegiiColors.bg,
        hintText: 'Add a note…',
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 13,
          vertical: 12,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: BeegiiColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: BeegiiColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: BeegiiColors.accent),
        ),
      ),
    );
  }

  Widget _checklistRow(int i) {
    final step = _steps[i];
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => step.done = !step.done),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          border: i == 0
              ? null
              : const Border(top: BorderSide(color: BeegiiColors.line)),
        ),
        child: Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              width: 20,
              height: 20,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: step.done ? BeegiiColors.good : BeegiiColors.surface,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: step.done
                      ? BeegiiColors.good
                      : const Color(0xFFDDDEDC),
                  width: 1.5,
                ),
              ),
              child: step.done
                  ? const Icon(
                      Icons.check_rounded,
                      size: 13,
                      color: Colors.white,
                    )
                  : null,
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Text(
                step.label,
                style: BeegiiType.sans(
                  size: 13,
                  color: step.done ? BeegiiColors.ink3 : BeegiiColors.ink,
                  decoration: step.done ? TextDecoration.lineThrough : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StoriesSheet extends StatelessWidget {
  const _StoriesSheet({required this.stop});
  final PlannerStop stop;

  @override
  Widget build(BuildContext context) {
    final s = stop.stories;
    return _SheetScaffold(
      kicker: 'Traveller stories',
      title: s.title,
      subtitle: Text(
        s.sub,
        style: BeegiiType.sans(
          size: 12,
          weight: FontWeight.w500,
          color: BeegiiColors.ink3,
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(
          20,
          16,
          20,
          26 + MediaQuery.of(context).padding.bottom,
        ),
        children: [
          _hero(s),
          const SizedBox(height: 12),
          Text(
            s.heroT,
            style: BeegiiType.sans(
              size: 15,
              weight: FontWeight.w700,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            s.heroBy,
            style: BeegiiType.sans(size: 11.5, color: BeegiiColors.ink3),
          ),
          if (s.reels.isNotEmpty) ...[
            const SizedBox(height: 18),
            Text(
              'MORE FROM THIS PLACE',
              style: BeegiiType.sans(
                size: 10,
                weight: FontWeight.w700,
                color: BeegiiColors.ink3,
                letterSpacing: 1,
              ),
            ),
            const SizedBox(height: 10),
            for (var i = 0; i < s.reels.length; i++)
              _reelRow(s.reels[i], i == 0),
          ],
        ],
      ),
    );
  }

  Widget _hero(StoriesInfo s) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Container(
        height: 182,
        decoration: BoxDecoration(gradient: BeegiiGradients.cat(s.hero)),
        child: Stack(
          children: [
            Center(
              child: Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.94),
                  shape: BoxShape.circle,
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x66000000),
                      blurRadius: 18,
                      offset: Offset(0, 6),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.play_arrow_rounded,
                  size: 26,
                  color: BeegiiColors.ink,
                ),
              ),
            ),
            Positioned(
              right: 11,
              bottom: 11,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0x8C1B1E22),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  s.dur,
                  style: BeegiiType.mono(
                    size: 10,
                    weight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _reelRow(StoryReel r, bool first) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        border: first
            ? null
            : const Border(top: BorderSide(color: BeegiiColors.line)),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(11),
            child: Container(
              width: 92,
              height: 62,
              decoration: BoxDecoration(gradient: BeegiiGradients.cat(r.cat)),
              child: Stack(
                children: [
                  Center(
                    child: Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.92),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.play_arrow_rounded,
                        size: 17,
                        color: BeegiiColors.ink,
                      ),
                    ),
                  ),
                  Positioned(
                    right: 6,
                    bottom: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0x8C1B1E22),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        r.dur,
                        style: BeegiiType.sans(
                          size: 8.5,
                          weight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.title,
                  style: BeegiiType.sans(
                    size: 13,
                    weight: FontWeight.w600,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  r.author,
                  style: BeegiiType.sans(size: 11, color: BeegiiColors.ink3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
