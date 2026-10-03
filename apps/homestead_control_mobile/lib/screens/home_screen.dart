import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "../util/panama_time.dart";
import "content_create_screen.dart";
import "content_queue_screen.dart";
import "errors_screen.dart";

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  HomeSummary? _summary;
  Map<String, dynamic>? _studio;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<SessionController>().api;
      final home = await api.home();
      final studio = await api.studio();
      if (!mounted) return;
      setState(() {
        _summary = home;
        _studio = studio;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Future<void> _togglePause() async {
    final paused = _studio?["paused"] == true;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(paused ? "Reanudar estudio" : "Pausar estudio"),
        content: Text(
          paused
              ? "El scheduler podrá publicar piezas programadas según la política del servidor."
              : "Se pausa el estudio. No se publicarán piezas hasta reanudarlo.",
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("Cancelar")),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Confirmar")),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await context.read<SessionController>().api.setStudioPaused(!paused);
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    final paused = _studio?["paused"] == true;
    return Scaffold(
      appBar: AppBar(
        title: const Text("Inicio"),
        actions: [
          IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContentCreateScreen()));
          _load();
        },
        icon: const Icon(Icons.add_a_photo_outlined),
        label: const Text("Nuevo"),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(formatPanamaNow(), style: const TextStyle(color: HomesteadColors.mist)),
            const SizedBox(height: 8),
            if (_loading) const LinearProgressIndicator(),
            if (_error != null) Text(_error!, style: const TextStyle(color: HomesteadColors.danger)),
            if (s != null) ...[
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _Metric("Por aprobar", s.pendingApproval),
                  _Metric("Programadas", s.scheduled),
                  _Metric("Revisión", s.needsReview),
                  _Metric("Fallos", s.failed),
                ],
              ),
              const SizedBox(height: 16),
              Card(
                child: ListTile(
                  title: Text(paused ? "Estudio en pausa" : "Estudio activo"),
                  subtitle: Text(
                    paused
                        ? "Las publicaciones automáticas están detenidas."
                        : "DRY RUN servidor: ${s.dryRun ? "sí" : "no"}",
                  ),
                  trailing: FilledButton(
                    onPressed: _togglePause,
                    child: Text(paused ? "Reanudar" : "Pausar"),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text("Cola de contenido"),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ContentQueueScreen(embedded: false)),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.error_outline),
                title: const Text("Centro de fallos"),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ErrorsScreen()),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value);
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 150,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text("$value", style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: HomesteadColors.navy)),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(color: HomesteadColors.mist)),
            ],
          ),
        ),
      ),
    );
  }
}
