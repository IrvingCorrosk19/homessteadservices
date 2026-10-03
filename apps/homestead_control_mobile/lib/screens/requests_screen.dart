import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "../util/panama_time.dart";
import "request_detail_screen.dart";

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

  void _openDetail(ServiceRequestItem item) {
    final id = item.publicId.trim();
    if (id.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Esta fila no tiene folio HS válido.")),
      );
      return;
    }
    Navigator.of(context)
        .push(
          MaterialPageRoute(builder: (_) => RequestDetailScreen(publicId: id)),
        )
        .then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final online = context.watch<SessionController>().online;
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
                suffixIcon: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.search),
                  constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                ),
              ),
              onSubmitted: (_) => _load(),
            ),
          ),
          if (!online)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text("Sin conexión. Mostrando último resultado si hay.", style: TextStyle(color: HomesteadColors.danger)),
              ),
            ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text(_error!, style: const TextStyle(color: HomesteadColors.danger)),
                  const SizedBox(height: 8),
                  OutlinedButton(onPressed: _load, child: const Text("Reintentar")),
                ],
              ),
            ),
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
                          child: InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: () => _openDetail(item),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(item.publicId, style: const TextStyle(fontWeight: FontWeight.w700)),
                                      ),
                                      if (item.securityReviewRequired)
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: HomesteadColors.accent.withValues(alpha: 0.2),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: const Text(
                                            "Seguridad",
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                              color: HomesteadColors.accentDeep,
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                  Text("${item.name} · ${item.phone}"),
                                  Text("${item.service} · ${item.status}"),
                                  Text(formatPanamaIso(item.createdAt), style: const TextStyle(color: HomesteadColors.mist)),
                                  if (item.message.isNotEmpty)
                                    Text(item.message, maxLines: 3, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 8),
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: TextButton(
                                      onPressed: () => _openDetail(item),
                                      child: const Text("Abrir detalle"),
                                    ),
                                  ),
                                ],
                              ),
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
