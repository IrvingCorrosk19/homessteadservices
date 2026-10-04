import "package:firebase_messaging/firebase_messaging.dart";
import "package:flutter/material.dart";
import "package:intl/intl.dart";
import "package:intl/date_symbol_data_local.dart";
import "package:provider/provider.dart";

import "config.dart";
import "push/push_service.dart";
import "screens/request_detail_screen.dart";
import "screens/shell_screen.dart";
import "screens/login_screen.dart";
import "state/session_controller.dart";
import "theme/homestead_theme.dart";
import "widgets/homestead_brand_header.dart";

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  await initializeDateFormatting("es_PA");
  Intl.defaultLocale = "es_PA";
  await PushService.instance.init();
  runApp(const HomesteadControlApp());
}

class HomesteadControlApp extends StatelessWidget {
  const HomesteadControlApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => SessionController()..bootstrap()),
        ChangeNotifierProvider.value(value: PushService.instance),
      ],
      child: MaterialApp(
        title: kAppName,
        debugShowCheckedModeBanner: false,
        theme: buildHomesteadTheme(),
        home: const _RootGate(),
      ),
    );
  }
}

class _RootGate extends StatefulWidget {
  const _RootGate();

  @override
  State<_RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<_RootGate> {
  final GlobalKey<ShellScreenState> _shellKey = GlobalKey<ShellScreenState>();
  bool _wasAuthenticated = false;

  @override
  void initState() {
    super.initState();
    PushService.instance.onNavigate = _handleDeepLink;
  }

  @override
  void dispose() {
    if (PushService.instance.onNavigate == _handleDeepLink) {
      PushService.instance.onNavigate = null;
    }
    super.dispose();
  }

  void _handleDeepLink(PushDeepLink link) {
    if (!mounted) {
      PushService.instance.setPendingNavigation(link);
      return;
    }
    final session = context.read<SessionController>();
    if (!session.isAuthenticated) {
      PushService.instance.setPendingNavigation(link);
      return;
    }
    _navigateDeepLink(link);
  }

  void _navigateDeepLink(PushDeepLink link) {
    if (link.isServiceRequest && link.id.isNotEmpty) {
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => RequestDetailScreen(publicId: link.id)),
      );
      return;
    }
    if (link.isAppointment && link.id.isNotEmpty) {
      final shell = _shellKey.currentState;
      if (shell == null) {
        PushService.instance.setPendingNavigation(link);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          final pending = PushService.instance.takePendingNavigation();
          if (pending != null) _navigateDeepLink(pending);
        });
        return;
      }
      shell.openAgendaForAppointment(link.id);
    }
  }

  void _consumePendingIfReady() {
    final pending = PushService.instance.takePendingNavigation();
    if (pending == null) return;
    _navigateDeepLink(pending);
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    if (session.booting) {
      return Scaffold(
        backgroundColor: HomesteadColors.cream,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset(
                "assets/branding/homestead-logo-full.png",
                height: 96,
                errorBuilder: (_, __, ___) => const HomesteadBrandHeader(compact: true),
              ),
              const SizedBox(height: 20),
              const Text(
                "Homestead Control",
                style: TextStyle(
                  color: HomesteadColors.navy,
                  fontWeight: FontWeight.w700,
                  fontSize: 18,
                ),
              ),
              const SizedBox(height: 24),
              const CircularProgressIndicator(),
            ],
          ),
        ),
      );
    }
    final authenticated = session.isAuthenticated;
    if (authenticated && !_wasAuthenticated) {
      _wasAuthenticated = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _consumePendingIfReady();
      });
    } else if (!authenticated) {
      _wasAuthenticated = false;
    }
    if (!authenticated) return const LoginScreen();
    return ShellScreen(key: _shellKey);
  }
}
