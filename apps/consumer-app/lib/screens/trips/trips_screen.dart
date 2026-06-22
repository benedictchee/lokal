import 'package:flutter/material.dart';

import '../../data/mock_data.dart';
import '../../data/models.dart';
import '../../router.dart';
import '../../theme/colors.dart';
import '../../theme/gradients.dart';
import '../../theme/tokens.dart';
import '../../theme/typography.dart';
import '../../widgets/beegii_media.dart';
import '../../widgets/primitives.dart';

class TripsScreen extends StatelessWidget {
  const TripsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ongoing = MockData.trips.where((t) => t.state == 'ongoing').toList();
    final past = MockData.trips.where((t) => t.state != 'ongoing').toList();

    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(context),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: Layout.dockReserve + 12),
              children: [
                if (ongoing.isNotEmpty) ...[
                  _sectionLabel('Ongoing'),
                  _grid(context, ongoing),
                ],
                if (past.isNotEmpty) ...[
                  _sectionLabel('Past'),
                  _grid(context, past),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 16, 18, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: SerifTitle('Your trips', size: 30, weight: FontWeight.w800),
          ),
          Pressable(
            onTap: () => context.openNewTrip(),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
              decoration: BoxDecoration(
                color: BeegiiColors.ink,
                borderRadius: BorderRadius.circular(Radii.pill),
                boxShadow: Shadows.sh2,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.add_rounded,
                    size: 16,
                    color: BeegiiColors.accent,
                  ),
                  const SizedBox(width: 7),
                  Text(
                    'New trip',
                    style: BeegiiType.sans(
                      size: 13.5,
                      weight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionLabel(String text) => Padding(
    padding: const EdgeInsets.fromLTRB(22, 14, 22, 9),
    child: Text(
      text.toUpperCase(),
      style: BeegiiType.sans(
        size: 11.5,
        weight: FontWeight.w700,
        color: BeegiiColors.ink3,
        letterSpacing: 0.8,
      ),
    ),
  );

  Widget _grid(BuildContext context, List<Trip> trips) {
    final rows = <Widget>[];
    for (var i = 0; i < trips.length; i += 2) {
      rows.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _TripCard(trip: trips[i])),
              const SizedBox(width: 12),
              Expanded(
                child: i + 1 < trips.length
                    ? _TripCard(trip: trips[i + 1])
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18),
      child: Column(children: rows),
    );
  }
}

class _TripCard extends StatelessWidget {
  const _TripCard({required this.trip});
  final Trip trip;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: () => context.openPlanner(title: trip.name),
      child: Container(
        decoration: BoxDecoration(
          color: BeegiiColors.surface,
          borderRadius: BorderRadius.circular(18),
          boxShadow: Shadows.sh2,
          border: Border.all(color: BeegiiColors.hair),
        ),
        clipBehavior: Clip.antiAlias,
        child: AspectRatio(
          aspectRatio: 1,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: BeegiiMedia(
                  gradient: BeegiiGradients.destination[trip.gradKey],
                  glyph: MediaGlyph.none,
                  scrim: true,
                  overlay: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          trip.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: BeegiiType.serif(
                            size: 18,
                            weight: FontWeight.w700,
                            color: Colors.white,
                            height: 1.05,
                          ),
                        ),
                        const SizedBox(height: 2),
                        EmojiLabel(
                          trip.flag,
                          trip.city,
                          style: BeegiiType.sans(
                            size: 11.5,
                            weight: FontWeight.w500,
                            color: Colors.white.withValues(alpha: 0.92),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 11, 14, 13),
                child: Row(
                  children: [
                    const Icon(
                      Icons.calendar_today_outlined,
                      size: 13,
                      color: BeegiiColors.ink3,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      trip.dates,
                      style: BeegiiType.sans(
                        size: 12,
                        weight: FontWeight.w600,
                        color: BeegiiColors.ink2,
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
}
