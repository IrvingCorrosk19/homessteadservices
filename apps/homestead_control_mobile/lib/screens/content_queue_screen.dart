import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "content_create_screen.dart";
import "content_detail_screen.dart";

class ContentQueueScreen extends StatefulWidget {
  const ContentQueueScreen({super.key, this.embedded = true});
  final bool embedded;

  @override
  State<ContentQueueScreen> createState() => _ContentQueueScreenState();
}

class _ContentQueueScreenState extends State<ContentQueueScreen> {
  final _search = TextEditingController();
  String _state = "all";
  List<ContentJobCard> _jobs = [];
  bool _loading = true;
  String? _error;

  static const _filters = <String, String>{
    "all": "Todas",
    "pending_approval": "Por aprobar",
    "scheduled": "Programadas",
    "needs_review": "Revisión",
    "partially_published": "Parcial",
    "published": "Publicadas",
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final jobs = await context.read<SessionController>().api.jobs(state: _state, q: _search.text);
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
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
    return Scaffold(
      appBar: AppBar(
        title: const Text("Contenido"),
        automaticallyImplyLeading: !widget.embedded,
        actions: [
          IconButton(
            onPressed: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ContentCreateScreen()));
              _load();
            },
            icon: const Icon(Icons.add_a_photo_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                hintText: "Buscar folio HC-…",
                suffixIcon: IconButton(onPressed: _load, icon: const Icon(Icons.search)),
              ),
              onSubmitted: (_) => _load(),
            ),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: _filters.entries.map((e) {
                final selected = _state == e.key;
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ChoiceChip(
                    label: Text(e.value),
                    selected: selected,
                    onSelected: (_) {
                      setState(() => _state = e.key);
                      _load();
                    },
                  ),
                );
              }).toList(),
            ),
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, style: const TextStyle(color: HomesteadColors.danger)),
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _jobs.isEmpty && !_loading
                  ? ListView(children: const [SizedBox(height: 80), Center(child: Text("No hay piezas en este filtro."))])
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _jobs.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (context, index) {
                        final job = _jobs[index];
                        return Card(
                          child: ListTile(
                            title: Text(job.publicId, style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text("${job.displayLabel}\n${job.recommendedPublishLabel.isEmpty ? "Sin slot" : job.recommendedPublishLabel}"),
                            isThreeLine: true,
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () async {
                              await Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => ContentDetailScreen(publicId: job.publicId)),
                              );
                              _load();
                            },
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
