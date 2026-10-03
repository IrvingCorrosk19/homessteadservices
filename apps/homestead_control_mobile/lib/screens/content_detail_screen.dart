import "dart:typed_data";

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
  final _copyCtrl = TextEditingController();
  final _contextCtrl = TextEditingController();
  final _pageCtrl = PageController();
  int _pageIndex = 0;
  bool _copyDirty = false;
  bool _contextDirty = false;
  /// Busts FutureBuilder cache after reprocess / reload.
  int _mediaEpoch = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _copyCtrl.dispose();
    _contextCtrl.dispose();
    _pageCtrl.dispose();
    super.dispose();
  }

  void _syncEditors(ContentJobCard job) {
    if (!_copyDirty) _copyCtrl.text = job.copy;
    if (!_contextDirty) _contextCtrl.text = job.aiContext;
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
        _mediaEpoch++;
        _syncEditors(job);
      });
      final ids = _finalAssetIds(job);
      if (ids.isEmpty) {
        _pageIndex = 0;
      } else if (_pageIndex >= ids.length) {
        _pageIndex = ids.length - 1;
        if (_pageCtrl.hasClients) _pageCtrl.jumpToPage(_pageIndex);
      } else if (_pageCtrl.hasClients && _pageCtrl.page?.round() != _pageIndex) {
        _pageCtrl.jumpToPage(_pageIndex);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Future<void> _runAction(
    String action, {
    bool needsConfirm = false,
    String? copy,
    String? note,
  }) async {
    final job = _job;
    if (job == null || _busy) return;
    var confirm = !needsConfirm;
    if (needsConfirm) {
      Map<String, dynamic>? preview;
      try {
        preview = await context.read<SessionController>().api.publishPreview(job.publicId);
      } catch (_) {}
      if (!mounted) return;
      final modality = job.modalityLabel;
      confirm = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text("Confirmar publicación"),
              content: Text(
                "Pieza ${job.publicId} · versión ${job.version}.\n"
                "Modalidad: $modality.\n"
                "Facebook e Instagram se publican en el servidor Homestead.\n"
                "El video no está soportado.\n"
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
    if (!confirm || !mounted) return;
    setState(() => _busy = true);
    final key = _idempotency.v4();
    final api = context.read<SessionController>().api;
    try {
      final result = await api.jobAction(
            publicId: job.publicId,
            action: action,
            version: job.version,
            confirm: needsConfirm,
            idempotencyKey: key,
            copy: copy,
            note: note,
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
      } else {
        if (action == "save_copy") _copyDirty = false;
        if (action == "regenerate_copy" || action == "update_ai_context") {
          _copyDirty = false;
          _contextDirty = false;
        }
        if (result["invalidatedApproval"] == true) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Aprobación invalidada. Revisa de nuevo antes de publicar.")),
          );
        }
      }
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == "timeout") {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              "Tiempo de espera agotado. No se asume éxito ni se reintenta solo. Revisa el estado antes de repetir.",
            ),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveCopy() async {
    final text = _copyCtrl.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("El texto no puede quedar vacío.")),
      );
      return;
    }
    await _runAction("save_copy", copy: text);
  }

  Future<void> _offerRegenerateAfterContextChange() async {
    if (!_contextDirty) {
      await _runAction("regenerate_copy", note: _contextCtrl.text.trim());
      return;
    }
    final choice = await showDialog<String>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text("Contexto modificado"),
            content: const Text(
              "Cambiaste el contexto después de generar el texto. "
              "¿Regenerar el texto con el nuevo contexto? "
              "Tus ediciones actuales del texto se reemplazarán.",
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, "cancel"), child: const Text("Cancelar")),
              TextButton(
                onPressed: () => Navigator.pop(ctx, "save_context"),
                child: const Text("Solo guardar contexto"),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, "regenerate"),
                child: const Text("Regenerar texto"),
              ),
            ],
          ),
        ) ??
        "cancel";
    if (!mounted || choice == "cancel") return;
    if (choice == "save_context") {
      await _runAction("update_ai_context", note: _contextCtrl.text.trim());
      // update_ai_context also regenerates on server — warn if copy was dirty
      return;
    }
    await _runAction("regenerate_copy", note: _contextCtrl.text.trim());
  }

  Future<void> _reorderMedia(int from, int to) async {
    final job = _job;
    if (job == null || _busy) return;
    final items = [...job.mediaItems];
    if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
    final moved = items.removeAt(from);
    items.insert(to, moved);
    final order = items.map((m) => m.assetId).where((id) => id > 0).toList();
    if (order.length != items.length) return;
    setState(() => _busy = true);
    try {
      await context.read<SessionController>().api.updateJobMedia(publicId: job.publicId, order: order);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Orden actualizado. La aprobación queda invalidada.")),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeMedia(int assetId) async {
    final job = _job;
    if (job == null || _busy) return;
    final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text("Quitar foto"),
            content: const Text(
              "Se quitará esta foto del orden. La aprobación de la pieza quedará invalidada.",
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("Cancelar")),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Quitar")),
            ],
          ),
        ) ??
        false;
    if (!ok || !mounted) return;
    final remaining = job.mediaItems.map((m) => m.assetId).where((id) => id > 0 && id != assetId).toList();
    setState(() => _busy = true);
    final api = context.read<SessionController>().api;
    try {
      await api.updateJobMedia(
            publicId: job.publicId,
            order: remaining,
            remove: [assetId],
          );
      if (!mounted) return;
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _platformLabel(String platform) {
    switch (platform.toLowerCase()) {
      case "facebook":
      case "fb":
        return "Facebook";
      case "instagram":
      case "ig":
        return "Instagram";
      default:
        return platform.isEmpty ? "Red" : platform;
    }
  }

  List<int> _finalAssetIds(ContentJobCard job) {
    if (job.mediaItems.isNotEmpty) {
      return job.mediaItems.map((m) => m.assetId).where((id) => id > 0).toList();
    }
    if (job.previewAssetId != null) return [job.previewAssetId!];
    return const [];
  }

  Future<void> _openZoom(Uint8List bytes, String title) async {
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ZoomImageScreen(bytes: bytes, title: title),
      ),
    );
  }

  Widget _finalPreview(ContentJobCard job) {
    final api = context.read<SessionController>().api;
    final ids = _finalAssetIds(job);
    if (ids.isEmpty) {
      return const Text(
        "Sin imagen final todavía.",
        style: TextStyle(color: HomesteadColors.mist),
      );
    }
    final total = ids.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          total > 1
              ? "Imágenes finales (las que se publican) · ${total} fotos"
              : "Imagen final (la que se publica)",
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 4),
        const Text(
          "Recorte 4:5 y marca Homestead. Toca para ampliar. Contiene = sin recortar la marca.",
          style: TextStyle(color: HomesteadColors.mist, fontSize: 13),
        ),
        const SizedBox(height: 8),
        AspectRatio(
          aspectRatio: 4 / 5,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: const Color(0x110B1F33),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: HomesteadColors.navy.withValues(alpha: 0.12)),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: PageView.builder(
                controller: _pageCtrl,
                itemCount: total,
                onPageChanged: (i) => setState(() => _pageIndex = i),
                itemBuilder: (context, i) {
                  final assetId = ids[i];
                  return FutureBuilder<Uint8List>(
                    key: ValueKey("final-$_mediaEpoch-$assetId"),
                    future: api.mediaBytes(assetId),
                    builder: (context, snap) {
                      if (snap.hasError) {
                        return Center(
                          child: Text(
                            "Error imagen #$assetId",
                            style: const TextStyle(color: HomesteadColors.danger),
                          ),
                        );
                      }
                      if (!snap.hasData) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      return GestureDetector(
                        onTap: () => _openZoom(
                          snap.data!,
                          total > 1 ? "Final ${i + 1}/$total · asset $assetId" : "Final · asset $assetId",
                        ),
                        child: InteractiveViewer(
                          minScale: 1,
                          maxScale: 4,
                          child: Image.memory(
                            snap.data!,
                            fit: BoxFit.contain,
                            width: double.infinity,
                            height: double.infinity,
                            gaplessPlayback: true,
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Text(
              total > 1 ? "${_pageIndex + 1} / $total" : "1 / 1",
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(width: 12),
            if (job.brandedDims.isNotEmpty)
              Text("Feed ${job.brandedDims}", style: const TextStyle(color: HomesteadColors.mist, fontSize: 13)),
            const Spacer(),
            Text(
              "asset ${ids[_pageIndex.clamp(0, ids.length - 1)]}",
              style: const TextStyle(color: HomesteadColors.mist, fontSize: 12),
            ),
          ],
        ),
      ],
    );
  }

  Widget _compareOriginal(ContentJobCard job) {
    final api = context.read<SessionController>().api;
    final originalId = job.originalAssetId;
    final brandedId = job.previewAssetId ?? job.brandedAssetId;
    if (originalId == null || brandedId == null || originalId == brandedId) {
      return const SizedBox.shrink();
    }
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: const Text("Comparar con original"),
      subtitle: Text(
        "Original #$originalId · Final #$brandedId (archivos distintos)",
        style: const TextStyle(fontSize: 12, color: HomesteadColors.mist),
      ),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                children: [
                  const Text("Original", style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  AspectRatio(
                    aspectRatio: 3 / 4,
                    child: FutureBuilder<Uint8List>(
                      key: ValueKey("orig-$_mediaEpoch-$originalId"),
                      future: api.mediaBytes(originalId),
                      builder: (context, snap) {
                        if (!snap.hasData) {
                          return const Center(child: CircularProgressIndicator());
                        }
                        return GestureDetector(
                          onTap: () => _openZoom(snap.data!, "Original · asset $originalId"),
                          child: Image.memory(snap.data!, fit: BoxFit.contain),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                children: [
                  const Text("Final + marca", style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  AspectRatio(
                    aspectRatio: 3 / 4,
                    child: FutureBuilder<Uint8List>(
                      key: ValueKey("brand-$_mediaEpoch-$brandedId"),
                      future: api.mediaBytes(brandedId),
                      builder: (context, snap) {
                        if (!snap.hasData) {
                          return const Center(child: CircularProgressIndicator());
                        }
                        return GestureDetector(
                          onTap: () => _openZoom(snap.data!, "Final · asset $brandedId"),
                          child: Image.memory(snap.data!, fit: BoxFit.contain),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    final online = context.watch<SessionController>().online;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.publicId),
        actions: [
          IconButton(
            onPressed: _loading || _busy ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: "Actualizar",
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, style: const TextStyle(color: HomesteadColors.danger), textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        OutlinedButton(onPressed: _load, child: const Text("Reintentar")),
                      ],
                    ),
                  ),
                )
              : job == null
                  ? const Center(child: Text("No encontrada"))
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        if (!online)
                          Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: HomesteadColors.danger.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Text(
                              "Sin conexión. Las acciones necesitan internet.",
                              style: TextStyle(color: HomesteadColors.danger),
                            ),
                          ),
                        _finalPreview(job),
                        const SizedBox(height: 12),
                        _compareOriginal(job),
                        const SizedBox(height: 12),
                        Text(job.processingPhaseLabel, style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text("Versión ${job.version} · ${job.status}"),
                        if (!job.publishImageReady) ...[
                          const SizedBox(height: 8),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: HomesteadColors.danger.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              job.publishImageIssueLabel.isEmpty
                                  ? "La imagen final no está lista. No se puede aprobar ni publicar."
                                  : job.publishImageIssueLabel,
                              style: const TextStyle(color: HomesteadColors.danger),
                            ),
                          ),
                        ],
                        if (job.lastErrorLabel.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(
                            "Detalle: ${job.lastErrorLabel}",
                            style: const TextStyle(color: HomesteadColors.danger),
                          ),
                        ],
                        const SizedBox(height: 8),
                        Text(
                          "Modalidad: ${job.modalityLabel}",
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (job.format.isNotEmpty)
                          Text("Formato: ${job.format}", style: const TextStyle(color: HomesteadColors.mist)),
                        if (job.laterNote.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(job.laterNote, style: const TextStyle(color: HomesteadColors.mist, fontSize: 13)),
                        ],
                        const SizedBox(height: 16),
                        const Text("Contexto para la IA", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        const Text(
                          "Describe qué muestran las fotos y qué quieres destacar. "
                          "Esta nota orienta el texto y no se publica automáticamente. "
                          "El servidor no analiza visualmente las fotos: solo usa este contexto y metadatos.",
                          style: TextStyle(color: HomesteadColors.mist, fontSize: 13),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _contextCtrl,
                          maxLines: 4,
                          onChanged: (_) => setState(() => _contextDirty = true),
                          decoration: const InputDecoration(
                            hintText:
                                "Ej.: Instalamos esta cerradura digital en un apartamento. Destaca la comodidad y el acceso sin llaves",
                          ),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (job.actionEnabled("regenerateCopy") || job.actionEnabled("updateAiContext"))
                              FilledButton.tonal(
                                onPressed: _busy || !online ? null : _offerRegenerateAfterContextChange,
                                child: Text(_contextDirty ? "Aplicar contexto / regenerar" : "Regenerar texto"),
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const Text("Texto de publicación", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        const Text(
                          "Puedes editar antes de aprobar. Guardar o regenerar invalida la aprobación.",
                          style: TextStyle(color: HomesteadColors.mist, fontSize: 13),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _copyCtrl,
                          maxLines: 6,
                          onChanged: (_) => setState(() => _copyDirty = true),
                          decoration: const InputDecoration(hintText: "Texto generado…"),
                        ),
                        const SizedBox(height: 8),
                        if (job.actionEnabled("saveCopy"))
                          OutlinedButton(
                            onPressed: _busy || !online || !_copyDirty ? null : _saveCopy,
                            child: const Text("Guardar texto editado"),
                          ),
                        const SizedBox(height: 8),
                        const Text(
                          "El video no está soportado en esta entrega.",
                          style: TextStyle(color: HomesteadColors.mist),
                        ),
                        if (job.mediaItems.length > 1) ...[
                          const SizedBox(height: 16),
                          const Text("Fotos (orden de publicación)", style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          const Text(
                            "Reordenar o quitar invalida la aprobación.",
                            style: TextStyle(color: HomesteadColors.mist, fontSize: 13),
                          ),
                          const SizedBox(height: 8),
                          ...List.generate(job.mediaItems.length, (i) {
                            final item = job.mediaItems[i];
                            final dims = [
                              if (item.width != null) "${item.width}",
                              if (item.height != null) "${item.height}",
                            ].join("×");
                            final api = context.read<SessionController>().api;
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                child: Row(
                                  children: [
                                    SizedBox(
                                      width: 64,
                                      height: 64,
                                      child: item.assetId > 0
                                          ? FutureBuilder<Uint8List>(
                                              key: ValueKey("thumb-$_mediaEpoch-${item.assetId}"),
                                              future: api.mediaBytes(item.assetId),
                                              builder: (context, snap) {
                                                if (!snap.hasData) {
                                                  return const Center(
                                                    child: SizedBox(
                                                      width: 20,
                                                      height: 20,
                                                      child: CircularProgressIndicator(strokeWidth: 2),
                                                    ),
                                                  );
                                                }
                                                return ClipRRect(
                                                  borderRadius: BorderRadius.circular(8),
                                                  child: Image.memory(snap.data!, fit: BoxFit.contain),
                                                );
                                              },
                                            )
                                          : const ColoredBox(color: Color(0x220B1F33)),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Text(
                                        "#${i + 1}${dims.isEmpty ? "" : " · $dims"} · #${item.assetId}",
                                        style: const TextStyle(fontWeight: FontWeight.w600),
                                      ),
                                    ),
                                    IconButton(
                                      tooltip: "Subir",
                                      onPressed: _busy || i == 0 ? null : () => _reorderMedia(i, i - 1),
                                      icon: const Icon(Icons.arrow_upward),
                                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                    ),
                                    IconButton(
                                      tooltip: "Bajar",
                                      onPressed: _busy || i >= job.mediaItems.length - 1
                                          ? null
                                          : () => _reorderMedia(i, i + 1),
                                      icon: const Icon(Icons.arrow_downward),
                                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                    ),
                                    IconButton(
                                      tooltip: "Quitar",
                                      onPressed: _busy || item.assetId <= 0
                                          ? null
                                          : () => _removeMedia(item.assetId),
                                      icon: const Icon(Icons.delete_outline, color: HomesteadColors.danger),
                                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }),
                        ],
                        const SizedBox(height: 16),
                        const Text("Resultado por red", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        if (job.publications.isEmpty)
                          const Text("Sin publicaciones registradas aún.", style: TextStyle(color: HomesteadColors.mist)),
                        ...job.publications.map((p) {
                          return Card(
                            margin: const EdgeInsets.only(bottom: 8),
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              title: Text(_platformLabel(p.platform), style: const TextStyle(fontWeight: FontWeight.w700)),
                              subtitle: Text(
                                [
                                  "Estado: ${p.status.isEmpty ? "—" : p.status}",
                                  if (p.errorLabel.isNotEmpty) "Error: ${p.errorLabel}",
                                  if (p.dryRun) "dry-run",
                                ].join("\n"),
                              ),
                              isThreeLine: p.errorLabel.isNotEmpty || p.dryRun,
                              trailing: p.permalink.isNotEmpty
                                  ? IconButton(
                                      icon: const Icon(Icons.open_in_new),
                                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                      onPressed: () =>
                                          launchUrl(Uri.parse(p.permalink), mode: LaunchMode.externalApplication),
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
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _runAction("approve"),
                                child: const Text("Aprobar"),
                              ),
                            if (job.actionEnabled("approveAndSchedule"))
                              FilledButton(
                                onPressed: _busy || !online ? null : () => _runAction("approve_and_schedule"),
                                child: const Text("Aprobar y programar"),
                              ),
                            if (job.actionEnabled("reschedule"))
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _runAction("reschedule"),
                                child: const Text("Reprogramar"),
                              ),
                            if (job.actionEnabled("reject"))
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _runAction("reject"),
                                child: const Text("Rechazar"),
                              ),
                            if (job.actionEnabled("publishNow"))
                              FilledButton(
                                onPressed: _busy || !online ? null : () => _runAction("publish_now", needsConfirm: true),
                                child: const Text("Publicar ahora"),
                              ),
                            if (job.actionEnabled("reprocessMedia"))
                              FilledButton.tonal(
                                onPressed: _busy || !online ? null : () => _runAction("reprocess_media"),
                                child: const Text("Reprocesar imagen"),
                              ),
                            if (job.actionEnabled("blockedByIncompleteImage") == true)
                              const Padding(
                                padding: EdgeInsets.only(top: 8),
                                child: Text(
                                  "Aprobación y publicación bloqueadas hasta tener imagen feed válida.",
                                  style: TextStyle(color: HomesteadColors.danger, fontSize: 13),
                                ),
                              ),
                          ],
                        ),
                        if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
                      ],
                    ),
    );
  }
}

class _ZoomImageScreen extends StatelessWidget {
  const _ZoomImageScreen({required this.bytes, required this.title});
  final Uint8List bytes;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(title, style: const TextStyle(fontSize: 14)),
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 0.5,
          maxScale: 6,
          child: Image.memory(bytes, fit: BoxFit.contain),
        ),
      ),
    );
  }
}
