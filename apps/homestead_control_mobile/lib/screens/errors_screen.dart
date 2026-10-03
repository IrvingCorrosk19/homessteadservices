import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "content_detail_screen.dart";

class ErrorsScreen extends StatefulWidget {
  const ErrorsScreen({super.key});

  @override
  State<ErrorsScreen> createState() => _ErrorsScreenState();
}

class _ErrorsScreenState extends State<ErrorsScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

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
      final data = await context.read<SessionController>().api.errors();
      if (!mounted) return;
      setState(() {
        _data = data;
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

  @override
  Widget build(BuildContext context) {
    final jobs = (_data?["jobs"] ?? _data?["items"] ?? []) as Object?;
    final list = jobs is List ? jobs.whereType<Map>().toList() : const <Map>[];
    return Scaffold(
      appBar: AppBar(title: const Text("Centro de fallos")),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: HomesteadColors.danger)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: list.isEmpty
                      ? ListView(children: const [SizedBox(height: 80), Center(child: Text("Sin fallos abiertos."))])
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: list.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final item = Map<String, dynamic>.from(list[index]);
                            final id = "${item["publicId"] ?? ""}";
                            return Card(
                              child: ListTile(
                                title: Text(id.isEmpty ? "pieza" : id),
                                subtitle: Text("${item["lastErrorLabel"] ?? item["lastError"] ?? item["error"] ?? ""}"),
                                onTap: id.isEmpty
                                    ? null
                                    : () => Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => ContentDetailScreen(publicId: id)),
                                        ),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
