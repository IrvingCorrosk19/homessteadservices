import "package:flutter/material.dart";
import "package:intl/intl.dart";
import "package:intl/date_symbol_data_local.dart";
import "package:provider/provider.dart";

import "config.dart";
import "screens/shell_screen.dart";
import "screens/login_screen.dart";
import "state/session_controller.dart";
import "theme/homestead_theme.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting("es_PA");
  Intl.defaultLocale = "es_PA";
  runApp(const HomesteadControlApp());
}

class HomesteadControlApp extends StatelessWidget {
  const HomesteadControlApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => SessionController()..bootstrap(),
      child: MaterialApp(
        title: kAppName,
        debugShowCheckedModeBanner: false,
        theme: buildHomesteadTheme(),
        home: const _RootGate(),
      ),
    );
  }
}

class _RootGate extends StatelessWidget {
  const _RootGate();

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    if (session.booting) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (!session.isAuthenticated) return const LoginScreen();
    return const ShellScreen();
  }
}
