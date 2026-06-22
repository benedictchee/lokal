import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'router.dart';
import 'state/app_state.dart';
import 'state/shell_controller.dart';
import 'theme/theme.dart';

class BeegiiApp extends StatelessWidget {
  const BeegiiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AppState()),
        ChangeNotifierProvider(create: (_) => ShellController()),
      ],
      child: Consumer<AppState>(
        builder: (context, app, _) {
          return MaterialApp.router(
            title: 'Beegii',
            debugShowCheckedModeBanner: false,
            theme: buildBeegiiTheme(app.accent),
            routerConfig: appRouter,
          );
        },
      ),
    );
  }
}
