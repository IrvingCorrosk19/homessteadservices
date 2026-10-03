import "dart:io";

import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";
import "package:provider/provider.dart";
import "package:uuid/uuid.dart";

import "../api/models.dart";
import "../config.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "content_detail_screen.dart";

class ContentCreateScreen extends StatefulWidget {
  const ContentCreateScreen({super.key});

  @override
  State<ContentCreateScreen> createState() => _ContentCreateScreenState();
}

class _ContentCreateScreenState extends State<ContentCreateScreen> {
  final _picker = ImagePicker();
  final _note = TextEditingController();
  final List<XFile> _files = [];
  final _uuid = const Uuid();
  String? _publishMode;
  /// Stable across retries of the same operator upload attempt (lost response / timeout).
  String? _uploadBatchKey;
  bool _busy = false;
  String? _status;
  Map<String, dynamic>? _result;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  bool get _needsModeChoice => _files.length >= 2;
  bool get _canUpload {
    if (_files.isEmpty || _busy) return false;
    if (_needsModeChoice && _publishMode == null) return false;
    return true;
  }

  Future<void> _pick(ImageSource source, {bool multi = false}) async {
    if (multi) {
      final remaining = kMaxContentPhotos - _files.length;
      if (remaining <= 0) return;
      final picked = await _picker.pickMultiImage(imageQuality: 92, limit: remaining);
      setState(() {
        _files.addAll(picked.take(remaining));
        if (_files.length < 2) _publishMode = null;
        _uploadBatchKey = null;
      });
      return;
    }
    final file = await _picker.pickImage(source: source, imageQuality: 92);
    if (file == null) return;
    if (_files.length >= kMaxContentPhotos) return;
    setState(() {
      _files.add(file);
      if (_files.length < 2) _publishMode = null;
      _uploadBatchKey = null;
    });
  }

  void _move(int index, int delta) {
    final next = index + delta;
    if (next < 0 || next >= _files.length) return;
    setState(() {
      final item = _files.removeAt(index);
      _files.insert(next, item);
      _uploadBatchKey = null;
    });
  }

  void _removeAt(int index) {
    setState(() {
      _files.removeAt(index);
      if (_files.length < 2) _publishMode = null;
      _uploadBatchKey = null;
    });
  }

  Future<void> _upload() async {
    if (!_canUpload) return;
    if (_busy) return;
    if (!context.read<SessionController>().online) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Sin conexión. No se encola la carga para reintento automático.")),
      );
      return;
    }
    final mode = _files.length >= 2 ? (_publishMode ?? PublishMode.separate) : PublishMode.separate;
    _uploadBatchKey ??= _uuid.v4();
    final batchKey = _uploadBatchKey!;
    setState(() {
      _busy = true;
      _status = "Subiendo ${_files.length} foto(s)…";
      _result = null;
    });
    try {
      final result = await context.read<SessionController>().api.ingestPhotos(
            files: _files.map((f) => File(f.path)).toList(),
            note: _note.text.trim(),
            publishMode: mode,
            batchKey: batchKey,
            onProgress: (sent, total) {
              if (!mounted) return;
              setState(() {
                _status = sent < total
                    ? "Subiendo $sent / $total…"
                    : "Procesando recorte feed y marca Homestead…";
              });
            },
          );
      if (!mounted) return;
      final items = (result["items"] ?? result["results"] ?? result["created"] ?? []) as Object?;
      final list = items is List ? items.whereType<Map>().toList() : const <Map>[];
      final anyFail = list.any((item) => item["ok"] == false);
      final allOk = result["ok"] == true && !anyFail && list.isNotEmpty;
      final isAlbum = mode == PublishMode.album;
      final uniqueIds = list
          .map((item) => "${item["publicId"] ?? ""}")
          .where((id) => id.isNotEmpty)
          .toSet();
      setState(() {
        _result = result;
        _busy = false;
        if (allOk) {
          // New successful attempt → next upload gets a fresh batchKey.
          _uploadBatchKey = null;
          if (isAlbum && uniqueIds.length == 1) {
            final replayed = result["replayed"] == true;
            _status = replayed
                ? "Misma operación reutilizada (sin folio duplicado): 1 pieza con ${list.length} fotos."
                : "Álbum listo: 1 pieza con ${list.length} fotos. Ábrela y revisa cada imagen final (marca y orden) antes de aprobar.";
          } else if (isAlbum) {
            _status =
                "Carga álbum incompleta o inesperada (${uniqueIds.length} piezas). Revisa el detalle; no se asume éxito.";
          } else {
            _status =
                "Lista para revisar. Abre cada pieza y confirma la imagen final antes de aprobar.";
            _uploadBatchKey = null;
          }
        } else if (anyFail) {
          final err = list
              .where((item) => item["ok"] == false)
              .map((item) => "${item["publicId"] ?? item["filename"]}: ${item["error"] ?? "error"}")
              .join(" · ");
          _status = "Error en el procesamiento. No se anunció éxito. $err";
        } else {
          _status = "Carga con errores. Revisa el detalle antes de aprobar.";
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        // Keep _uploadBatchKey so a manual retry reuses the same operation id.
        _status = e.code == "timeout"
            ? "Tiempo agotado. No se asume éxito. Si reintentas, se reutiliza la misma operación (sin folio duplicado)."
            : "Error: ${e.message}";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = (_result?["items"] ?? _result?["results"] ?? _result?["created"] ?? []) as Object?;
    final list = items is List ? items.whereType<Map>().toList() : const <Map>[];
    final online = context.watch<SessionController>().online;
    return Scaffold(
      appBar: AppBar(title: const Text("Crear contenido")),
      body: ListView(
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
                "Sin conexión. La carga necesita internet.",
                style: TextStyle(color: HomesteadColors.danger),
              ),
            ),
          const Text(
            "Hasta 8 fotos. El contexto orienta el generador de texto (no se publica literalmente). "
            "Sin visión de las fotos. El video no está soportado.",
            style: TextStyle(color: HomesteadColors.mist),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _pick(ImageSource.gallery, multi: true),
                icon: const Icon(Icons.photo_library_outlined),
                label: const Text("Galería"),
              ),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _pick(ImageSource.camera),
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text("Cámara"),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(
              labelText: "Contexto para la IA",
              helperText:
                  "Orienta el generador; no se publica literalmente. Plantilla de fallback exige revisión",
              hintText:
                  "Ej.: Instalamos esta cerradura digital en un apartamento. Destaca la comodidad y el acceso sin llaves",
              alignLabelWithHint: true,
            ),
            maxLines: 4,
          ),
          const SizedBox(height: 16),
          Text(
            "${_files.length} / $kMaxContentPhotos seleccionadas",
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          if (_files.isEmpty)
            const Text("Elige fotos para continuar.", style: TextStyle(color: HomesteadColors.mist)),
          ...List.generate(_files.length, (i) {
            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.file(
                        File(_files[i].path),
                        width: 72,
                        height: 72,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        "Foto ${i + 1}",
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    IconButton(
                      tooltip: "Subir",
                      onPressed: _busy || i == 0 ? null : () => _move(i, -1),
                      icon: const Icon(Icons.arrow_upward),
                      iconSize: 22,
                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                    ),
                    IconButton(
                      tooltip: "Bajar",
                      onPressed: _busy || i >= _files.length - 1 ? null : () => _move(i, 1),
                      icon: const Icon(Icons.arrow_downward),
                      iconSize: 22,
                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                    ),
                    IconButton(
                      tooltip: "Quitar",
                      onPressed: _busy ? null : () => _removeAt(i),
                      icon: const Icon(Icons.delete_outline, color: HomesteadColors.danger),
                      iconSize: 22,
                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                    ),
                  ],
                ),
              ),
            );
          }),
          if (_needsModeChoice) ...[
            const SizedBox(height: 8),
            const Text(
              "¿Cómo quieres publicar estas fotos?",
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text(
              "Elige una opción para continuar. Con varias fotos es obligatorio.",
              style: TextStyle(color: HomesteadColors.mist, fontSize: 13),
            ),
            const SizedBox(height: 8),
            RadioGroup<String>(
              groupValue: _publishMode,
              onChanged: _busy
                  ? (_) {}
                  : (v) {
                      if (v == null) return;
                      setState(() => _publishMode = v);
                    },
              child: Column(
                children: const [
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    title: Text("Una publicación con varias fotos"),
                    subtitle: Text("Una sola pieza (álbum) con todas las fotos en orden."),
                    value: PublishMode.album,
                  ),
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    title: Text("Una publicación por foto"),
                    subtitle: Text("Se crea una pieza independiente por cada foto."),
                    value: PublishMode.separate,
                  ),
                ],
              ),
            ),
            if (_publishMode == null)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  "Selecciona el modo de publicación.",
                  style: TextStyle(color: HomesteadColors.accentDeep),
                ),
              ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _canUpload ? _upload : null,
            child: Text(_busy ? "Subiendo…" : "Subir y generar"),
          ),
          if (_status != null) ...[
            const SizedBox(height: 12),
            Text(_status!),
          ],
          if (_busy) const LinearProgressIndicator(),
          ...list.map((item) {
            final id = "${item["publicId"] ?? item["id"] ?? ""}";
            final ok = item["ok"] != false && (item["error"] == null || "${item["error"]}" == "");
            return ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(id.isEmpty ? "ítem" : id),
              subtitle: Text(ok ? "OK" : "${item["error"] ?? "error"}"),
              trailing: id.isEmpty
                  ? null
                  : TextButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => ContentDetailScreen(publicId: id)),
                      ),
                      child: const Text("Abrir"),
                    ),
            );
          }),
        ],
      ),
    );
  }
}
