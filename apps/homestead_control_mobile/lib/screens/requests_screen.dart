import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "../util/panama_time.dart";

class RequestsScreen extends StatefulWidget {
  const RequestsScreen({super.key});

  @override
  State<RequestsScreen> createState() => _RequestsScreenState();
}

class _RequestsScreenState extends State<RequestsScreen> {
  final _q = TextEditingController();
  List<ServiceRequestItem> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await context.read<SessionController>().api.serviceRequests(q: _q.text);
      if (!mounted) return;
      setState(() {
        _items = items;
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

  Future<void> _setStatus(ServiceRequestItem item, String status) async {
    try {
      await context.read<SessionController>().api.patchRequestStatus(item.publicId, status);
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Solicitudes")),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _q,
              decoration: InputDecoration(
                hintText: "Buscar HS-…, nombre o teléfono",
                suffixIcon: IconButton(onPressed: _load, icon: const Icon(Icons.search)),
              ),
              onSubmitted: (_) => _load(),
            ),
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: Text(_error!, style: const TextStyle(color: HomesteadColors.danger))),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _items.isEmpty && !_loading
                  ? ListView(children: const [SizedBox(height: 80), Center(child: Text("Sin solicitudes."))])
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        return Card(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item.publicId, style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text("${item.name} · ${item.phone}"),
                                Text("${item.service} · ${item.status}"),
                                Text(formatPanamaIso(item.createdAt), style: const TextStyle(color: HomesteadColors.mist)),
                                if (item.message.isNotEmpty) Text(item.message, maxLines: 3, overflow: TextOverflow.ellipsis),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  children: [
                                    OutlinedButton(
                                      onPressed: () => _setStatus(item, "CONTACTED"),
                                      child: const Text("Contactada"),
                                    ),
                                    OutlinedButton(
                                      onPressed: () => _setStatus(item, "IN_PROGRESS"),
                                      child: const Text("En curso"),
                                    ),
                                    OutlinedButton(
                                      onPressed: () => _setStatus(item, "COMPLETED"),
                                      child: const Text("Completada"),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
