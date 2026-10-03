import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _controller = TextEditingController();
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final password = _controller.text;
    if (password.isEmpty) return;
    setState(() => _busy = true);
    final ok = await context.read<SessionController>().login(password);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!ok) {
      final err = context.read<SessionController>().lastError ?? "No se pudo entrar";
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = context.watch<SessionController>().online;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
          children: [
            Text(
              "HOMESTEAD",
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    color: HomesteadColors.navy,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.2,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              "Control",
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: HomesteadColors.accentDeep,
                  ),
            ),
            const SizedBox(height: 12),
            const Text(
              "Administra contenido, solicitudes y agenda. Facebook e Instagram se publican en el servidor.",
              style: TextStyle(color: HomesteadColors.charcoal, height: 1.4),
            ),
            if (!online) ...[
              const SizedBox(height: 16),
              const _Banner(
                text: "Sin conexión. El inicio de sesión necesita internet.",
                danger: true,
              ),
            ],
            const SizedBox(height: 32),
            TextField(
              controller: _controller,
              obscureText: _obscure,
              enabled: !_busy,
              decoration: InputDecoration(
                labelText: "Contraseña de administrador",
                suffixIcon: IconButton(
                  onPressed: () => setState(() => _obscure = !_obscure),
                  icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                ),
              ),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy || !online ? null : _submit,
              child: Text(_busy ? "Entrando…" : "Entrar"),
            ),
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, this.danger = false});
  final String text;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: danger ? const Color(0x1A9B1C1C) : const Color(0x1AC45C26),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text, style: TextStyle(color: danger ? HomesteadColors.danger : HomesteadColors.accentDeep)),
    );
  }
}
