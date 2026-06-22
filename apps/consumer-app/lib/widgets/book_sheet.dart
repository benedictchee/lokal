import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/models.dart';
import '../state/app_state.dart';
import '../theme/colors.dart';
import '../theme/typography.dart';
import 'primitives.dart';
import 'toast.dart';

/// Shows the "Request to book" bottom sheet for [guide].
Future<void> showBookSheet(BuildContext context, Guide guide) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: const Color(0x99080604),
    builder: (_) => _BookSheet(guide: guide),
  );
}

class _BookSheet extends StatefulWidget {
  const _BookSheet({required this.guide});
  final Guide guide;

  @override
  State<_BookSheet> createState() => _BookSheetState();
}

class _BookSheetState extends State<_BookSheet> {
  int? _selected;

  @override
  Widget build(BuildContext context) {
    final g = widget.guide;
    final accent = context.watch<AppState>().accent;
    return BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 3, sigmaY: 3),
      child: Container(
        decoration: const BoxDecoration(
          color: BeegiiColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        ),
        padding: EdgeInsets.fromLTRB(
          20,
          8,
          20,
          20 + MediaQuery.of(context).padding.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 5,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: const Color(0xFFDDDEDC),
                  borderRadius: BorderRadius.circular(5),
                ),
              ),
            ),
            Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: g.color,
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Text(
                    g.init,
                    style: BeegiiType.serif(
                      size: 22,
                      weight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'REQUEST TO BOOK',
                        style: BeegiiType.mono(
                          size: 10,
                          weight: FontWeight.w700,
                          color: accent.deep,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${g.displayHandle} · ${g.role}',
                        style: BeegiiType.serif(
                          size: 20,
                          weight: FontWeight.w700,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              'TODAY — FREE NOW',
              style: BeegiiType.sans(
                size: 11,
                weight: FontWeight.w700,
                color: BeegiiColors.ink3,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 9),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: List.generate(g.times.length, (i) {
                final t = g.times[i];
                final on = _selected == i;
                return Pressable(
                  onTap: () => setState(() => _selected = i),
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 62),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 9,
                    ),
                    decoration: BoxDecoration(
                      color: on ? accent.soft : BeegiiColors.surface,
                      borderRadius: BorderRadius.circular(11),
                      border: Border.all(
                        color: on ? accent.base : const Color(0xFFDDDEDC),
                      ),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          t.hour,
                          style: BeegiiType.sans(
                            size: 12.5,
                            weight: FontWeight.w600,
                            color: on ? accent.deep : BeegiiColors.ink2,
                          ),
                        ),
                        Text(
                          t.ampm,
                          style: BeegiiType.sans(
                            size: 9.5,
                            weight: FontWeight.w500,
                            color: on ? accent.deep : BeegiiColors.ink4,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 20),
            DarkButton(
              'Send request',
              expand: true,
              trailingIcon: Icons.event_outlined,
              onTap: () {
                if (_selected == null) {
                  showBeegiiToast(context, 'Pick a start time first');
                  return;
                }
                final t = g.times[_selected!];
                Navigator.of(context).pop();
                showBeegiiToast(
                  context,
                  'Request sent to ${g.firstName} — today ${t.hour} ${t.ampm}',
                  avatarColor: g.color,
                  avatarInit: g.init,
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
