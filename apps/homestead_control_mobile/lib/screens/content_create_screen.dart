import "dart:io";

import "package:flutter/material.dart";
import "package:image_picker/image_picker.dart";
import "package:provider/provider.dart";

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
  bool _busy = false;
  String? _status;
  Map<String, dynamic>? _result;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick(ImageSource source, {bool multi = false}) async {
    if (multi) {
      final remaining = kMaxContentPhotos - _files.length;
      if (remaining <= 0) return;
      final picked = await _picker.pickMultiImage(imageQuality: 92, limit: remaining);
      setState(() => _files.addAll(picked.take(remaining)));
      return;
    }
    final file = await _picker.pickImage(source: source, imageQuality: 92);
    if (file == null) return;
    if (_files.length >= kMaxContentPhotos) return;
    setState(() => _files.add(file));
  }

  Future<void> _upload() async {
    if (_files.isEmpty || _busy) return;
    if (!context.read<SessionController>().online) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Sin conexión. No se encola la carga para reintento automático.")),
      );
      return;
    }
    setState(() {
      _busy = true;
      _status = "Subiendo ${_files.length} foto(s). El servidor genera el texto…";
      _result = null;
    });
    try {
      final result = await context.read<SessionController>().api.ingestPhotos(
            files: _files.map((f) => File(f.path)).toList(),
            note: _note.text.trim(),
            onProgress: (sent, total) {
              if (!mounted) return;
              setState(() => _status = "Progreso $sent / $total");
            },
          );
      if (!mounted) return;
      setState(() {
        _result = result;
        _busy = false;
        _status = result["ok"] == true ? "Carga aceptada. Revisa piezas creadas." : "Carga con errores.";
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = (_result?["items"] ?? _result?["results"] ?? _result?["created"] ?? []) as Object?;
    final list = items is List ? items.whereType<Map>().toList() : const <Map>[];
    return Scaffold(
      appBar: AppBar(title: const Text("Crear contenido")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            "Hasta 8 fotos (límite del backend). Una pieza por foto. El texto lo genera la integración existente en el servidor. Video/carrusel no soportados.",
            style: TextStyle(color: HomesteadColors.mist),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
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
            decoration: const InputDecoration(labelText: "Nota opcional"),
            maxLines: 2,
          ),
          const SizedBox(height: 12),
          Text("${_files.length} / $kMaxContentPhotos seleccionadas"),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (var i = 0; i < _files.length; i++)
                Stack(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.file(File(_files[i].path), width: 88, height: 88, fit: BoxFit.cover),
                    ),
                    Positioned(
                      right: 0,
                      top: 0,
                      child: IconButton(
                        iconSize: 18,
                        style: IconButton.styleFrom(backgroundColor: Colors.black54),
                        onPressed: _busy
                            ? null
                            : () => setState(() => _files.removeAt(i)),
                        icon: const Icon(Icons.close, color: Colors.white),
                      ),
                    ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy || _files.isEmpty ? null : _upload,
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
