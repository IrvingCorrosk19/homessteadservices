import "package:flutter/material.dart";
import "package:provider/provider.dart";
import "package:url_launcher/url_launcher.dart";
import "package:uuid/uuid.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";

class ContentDetailScreen extends StatefulWidget {
  const ContentDetailScreen({super.key, required this.publicId});
  final String publicId;

  @override
  State<ContentDetailScreen> createState() => _ContentDetailScreenState();
}

class _ContentDetailScreenState extends State<ContentDetailScreen> {
  ContentJobCard? _job;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  final _idempotency = const Uuid();

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
      final job = await context.read<SessionController>().api.jobDetail(widget.publicId);
      if (!mounted) return;
      setState(() {
        _job = job;
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

  Future<void> _runAction(String action, {bool needsConfirm = false}) async {
    final job = _job;
    if (job == null || _busy) return;
    var confirm = !needsConfirm;
    if (needsConfirm) {
      Map<String, dynamic>? preview;
      try {
        preview = await context.read<SessionController>().api.publishPreview(job.publicId);
      } catch (_) {}
      if (!mounted) return;
      confirm = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text("Confirmar publicación"),
              content: Text(
                "Pieza ${job.publicId} · versión ${job.version}.\n"
                "Facebook e Instagram se publican en el servidor Homestead.\n"
                "Video/Reels/carrusel no están soportados.\n"
                "${preview != null ? "Vista previa recibida del API." : "Sin vista previa adicional."}\n\n"
                "Un timeout no autoriza repetir a ciegas.",
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("Cancelar")),
                FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Confirmar")),
              ],
            ),
          ) ??
          false;
    }
    if (!confirm) return;
    setState(() => _busy = true);
    final key = _idempotency.v4();
    try {
      final result = await context.read<SessionController>().api.jobAction(
            publicId: job.publicId,
            action: action,
            version: job.version,
            confirm: needsConfirm,
            idempotencyKey: key,
          );
      if (!mounted) return;
      if (result["ok"] != true) {
        final err = "${result["error"] ?? "falló"}";
        if (err == "uncertain_pending") {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Hay un resultado incierto. Conciliar antes de reintentar.")),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
        }
      }
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    final api = context.read<SessionController>().api;
    return Scaffold(
      appBar: AppBar(title: Text(widget.publicId)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: HomesteadColors.danger)))
              : job == null
                  ? const Center(child: Text("No encontrada"))
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        if (job.previewAssetId != null)
                          FutureBuilder(
                            future: api.mediaBytes(job.previewAssetId!),
                            builder: (context, snap) {
                              if (!snap.hasData) {
                                return const SizedBox(height: 220, child: Center(child: CircularProgressIndicator()));
                              }
                              return ClipRRect(
                                borderRadius: BorderRadius.circular(16),
                                child: Image.memory(snap.data!, fit: BoxFit.cover, height: 240, width: double.infinity),
                              );
                            },
                          ),
                        const SizedBox(height: 12),
                        Text(job.displayLabel, style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text("Versión ${job.version} · ${job.status}"),
                        const SizedBox(height: 8),
                        Text(job.copy.isEmpty ? "(Sin texto)" : job.copy),
                        const SizedBox(height: 8),
                        const Text(
                          "Video, Reels y carrusel no están soportados en esta entrega.",
                          style: TextStyle(color: HomesteadColors.mist),
                        ),
                        const SizedBox(height: 16),
                        ...job.publications.map((p) {
                          return Card(
                            child: ListTile(
                              title: Text(p.platform.toUpperCase()),
                              subtitle: Text(
                                [
                                  p.status,
                                  if (p.errorLabel.isNotEmpty) p.errorLabel,
                                  if (p.dryRun) "dry-run",
                                ].join(" · "),
                              ),
                              trailing: p.permalink.isNotEmpty
                                  ? IconButton(
                                      icon: const Icon(Icons.open_in_new),
                                      onPressed: () => launchUrl(Uri.parse(p.permalink), mode: LaunchMode.externalApplication),
                                    )
                                  : null,
                            ),
                          );
                        }),
                        if (job.actions["retryBlockedByUncertain"] == true)
                          const Padding(
                            padding: EdgeInsets.only(top: 8),
                            child: Text(
                              "Resultado incierto: no reintentar a ciegas. Conciliar primero.",
                              style: TextStyle(color: HomesteadColors.danger),
                            ),
                          ),
                        const SizedBox(height: 16),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (job.actionEnabled("approve"))
                              OutlinedButton(onPressed: _busy ? null : () => _runAction("approve"), child: const Text("Aprobar")),
                            if (job.actionEnabled("approveAndSchedule"))
                              FilledButton(onPressed: _busy ? null : () => _runAction("approve_and_schedule"), child: const Text("Aprobar y programar")),
                            if (job.actionEnabled("reschedule"))
                              OutlinedButton(onPressed: _busy ? null : () => _runAction("reschedule"), child: const Text("Reprogramar")),
                            if (job.actionEnabled("reject"))
                              OutlinedButton(onPressed: _busy ? null : () => _runAction("reject"), child: const Text("Rechazar")),
                            if (job.actionEnabled("publishNow"))
                              FilledButton(onPressed: _busy ? null : () => _runAction("publish_now", needsConfirm: true), child: const Text("Publicar ahora")),
                            if (job.actionEnabled("retryPlatform"))
                              OutlinedButton(onPressed: _busy ? null : () => _runAction("retry_platform", needsConfirm: true), child: const Text("Reintentar red fallida")),
                          ],
                        ),
                        if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
                      ],
                    ),
    );
  }
}
