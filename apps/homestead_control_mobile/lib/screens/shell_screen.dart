import "package:connectivity_plus/connectivity_plus.dart";
import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../state/session_controller.dart";
import "appointments_screen.dart";
import "content_queue_screen.dart";
import "home_screen.dart";
import "more_screen.dart";
import "requests_screen.dart";

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _index = 0;
  late final Stream<List<ConnectivityResult>> _connectivity;

  @override
  void initState() {
    super.initState();
    _connectivity = Connectivity().onConnectivityChanged;
    Connectivity().checkConnectivity().then(_applyConnectivity);
    _connectivity.listen(_applyConnectivity);
  }

  void _applyConnectivity(List<ConnectivityResult> results) {
    final online = results.any((r) => r != ConnectivityResult.none);
    if (!mounted) return;
    context.read<SessionController>().setOnline(online);
  }

  @override
  Widget build(BuildContext context) {
    final online = context.watch<SessionController>().online;
    final pages = [
      const HomeScreen(),
      const ContentQueueScreen(),
      const RequestsScreen(),
      const AppointmentsScreen(),
      const MoreScreen(),
    ];
    return Scaffold(
      body: Column(
        children: [
          if (!online)
            Material(
              color: const Color(0xFF9B1C1C),
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Text(
                    "Sin conexión. Lecturas y publicaciones requieren internet; no se encolan envíos automáticos.",
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.white),
                  ),
                ),
              ),
            ),
          Expanded(child: IndexedStack(index: _index, children: pages)),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.home_outlined), label: "Inicio"),
          BottomNavigationBarItem(icon: Icon(Icons.photo_library_outlined), label: "Contenido"),
          BottomNavigationBarItem(icon: Icon(Icons.assignment_outlined), label: "Solicitudes"),
          BottomNavigationBarItem(icon: Icon(Icons.event_outlined), label: "Agenda"),
          BottomNavigationBarItem(icon: Icon(Icons.more_horiz), label: "Más"),
        ],
      ),
    );
  }
}
