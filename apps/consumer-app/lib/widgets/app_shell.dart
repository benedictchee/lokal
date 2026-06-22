import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/colors.dart';
import 'dock.dart';

/// The persistent app shell: the active tab branch + the floating bottom dock.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  void _goBranch(int index) {
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final dockBottom = (mq.padding.bottom > 0 ? mq.padding.bottom + 6 : 18)
        .toDouble();

    return Scaffold(
      backgroundColor: BeegiiColors.bg,
      body: Stack(
        children: [
          navigationShell,
          Positioned(
            left: 0,
            right: 0,
            bottom: dockBottom,
            child: Align(
              alignment: Alignment.bottomCenter,
              child: BeegiiDock(
                currentIndex: navigationShell.currentIndex,
                onTapBranch: _goBranch,
                onSearchTap: () => _goBranch(Branch.search),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
