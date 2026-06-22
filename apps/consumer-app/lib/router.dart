import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'screens/explore/explore_screen.dart';
import 'screens/inspired/get_inspired_screen.dart';
import 'screens/planner/planner_screen.dart';
import 'screens/profile/profile_screen.dart';
import 'screens/search/search_screen.dart';
import 'screens/shop/shop_screen.dart';
import 'screens/trips/trips_screen.dart';
import 'widgets/animated_branch_container.dart';
import 'widgets/app_shell.dart';

final _rootKey = GlobalKey<NavigatorState>();
final _exploreKey = GlobalKey<NavigatorState>();
final _searchKey = GlobalKey<NavigatorState>();
final _planKey = GlobalKey<NavigatorState>();
final _accountKey = GlobalKey<NavigatorState>();

/// A page with no transition (used for tab branch roots).
CustomTransitionPage<void> _noTransition(Widget child, GoRouterState state) =>
    CustomTransitionPage<void>(
      key: state.pageKey,
      child: child,
      transitionsBuilder: (_, _, _, c) => c,
    );

final GoRouter appRouter = GoRouter(
  navigatorKey: _rootKey,
  initialLocation: '/explore',
  routes: [
    StatefulShellRoute(
      builder: (context, state, navigationShell) =>
          AppShell(navigationShell: navigationShell),
      navigatorContainerBuilder: (context, navigationShell, children) =>
          AnimatedBranchContainer(
            currentIndex: navigationShell.currentIndex,
            children: children,
          ),
      branches: [
        StatefulShellBranch(
          navigatorKey: _exploreKey,
          routes: [
            GoRoute(
              path: '/explore',
              pageBuilder: (c, s) => _noTransition(const ExploreScreen(), s),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _searchKey,
          routes: [
            GoRoute(
              path: '/search',
              pageBuilder: (c, s) => _noTransition(const SearchScreen(), s),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _planKey,
          routes: [
            GoRoute(
              path: '/plan',
              pageBuilder: (c, s) => _noTransition(const TripsScreen(), s),
            ),
          ],
        ),
        StatefulShellBranch(
          navigatorKey: _accountKey,
          routes: [
            GoRoute(
              path: '/account',
              pageBuilder: (c, s) => _noTransition(
                const ProfileScreen(guideId: 'aisha', isMe: true),
                s,
              ),
            ),
          ],
        ),
      ],
    ),
    // Full-screen detail routes (pushed over the shell + dock).
    GoRoute(
      path: '/guide/:id',
      parentNavigatorKey: _rootKey,
      builder: (c, s) =>
          ProfileScreen(guideId: s.pathParameters['id']!, isMe: false),
    ),
    GoRoute(
      path: '/shop/:shopId/:index',
      parentNavigatorKey: _rootKey,
      builder: (c, s) => ShopScreen(
        shopId: s.pathParameters['shopId']!,
        index: int.tryParse(s.pathParameters['index'] ?? '0') ?? 0,
      ),
    ),
    GoRoute(
      path: '/planner',
      parentNavigatorKey: _rootKey,
      builder: (c, s) => PlannerScreen(title: s.uri.queryParameters['title']),
    ),
    GoRoute(
      path: '/new-trip',
      parentNavigatorKey: _rootKey,
      builder: (c, s) => const GetInspiredScreen(),
    ),
  ],
);

/// Navigation helpers.
extension BeegiiNav on BuildContext {
  void openGuide(String id) => push('/guide/$id');
  void openShop(String shopId, [int index = 0]) => push('/shop/$shopId/$index');
  void openPlanner({String? title}) => push(
    title == null ? '/planner' : '/planner?title=${Uri.encodeComponent(title)}',
  );
  void openNewTrip() => push('/new-trip');
}
