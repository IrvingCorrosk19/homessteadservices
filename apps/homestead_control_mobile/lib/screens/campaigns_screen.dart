import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";

class CampaignsScreen extends StatefulWidget {
  const CampaignsScreen({super.key});

  @override
  State<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends State<CampaignsScreen> {
  List<Map<String, dynamic>> _items = [];
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
      final items = await context.read<SessionController>().api.campaigns();
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

  Future<void> _toggle(Map<String, dynamic> item, bool paused) async {
    final id = "${item["publicId"] ?? item["campaignId"] ?? ""}";
    if (id.isEmpty) return;
    try {
      await context.read<SessionController>().api.setCampaignPaused(id, paused);
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Campañas")),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: HomesteadColors.danger)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final item = _items[index];
                      final status = "${item["status"] ?? ""}";
                      final paused = status == "PAUSED";
                      return Card(
                        child: ListTile(
                          title: Text("${item["publicId"] ?? item["name"] ?? "campaña"}"),
                          subtitle: Text(status),
                          trailing: TextButton(
                            onPressed: () => _toggle(item, !paused),
                            child: Text(paused ? "Reanudar" : "Pausar"),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
