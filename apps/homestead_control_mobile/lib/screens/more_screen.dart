import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../config.dart";
import "../state/session_controller.dart";
import "batches_screen.dart";
import "campaigns_screen.dart";
import "customers_screen.dart";
import "errors_screen.dart";

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    return Scaffold(
      appBar: AppBar(title: const Text("Más")),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.people_outline),
            title: const Text("Clientes"),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CustomersScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.collections_outlined),
            title: const Text("Lotes"),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BatchesScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.campaign_outlined),
            title: const Text("Campañas"),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CampaignsScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.error_outline),
            title: const Text("Centro de fallos"),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ErrorsScreen())),
          ),
          const Divider(),
          ListTile(
            title: const Text("Servidor"),
            subtitle: Text(session.baseUrl),
          ),
          ListTile(
            title: const Text("Zona horaria"),
            subtitle: const Text(kTimeZoneLabel),
          ),
          ListTile(
            title: const Text("Versión app"),
            subtitle: const Text("1.0.0+1"),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text("Cerrar sesión"),
            onTap: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text("Cerrar sesión"),
                  content: const Text("Se invalidará la sesión en el servidor."),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("Cancelar")),
                    FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Salir")),
                  ],
                ),
              );
              if (ok == true && context.mounted) {
                await context.read<SessionController>().logout();
              }
            },
          ),
        ],
      ),
    );
  }
}
