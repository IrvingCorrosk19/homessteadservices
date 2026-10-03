import "package:flutter/material.dart";
import "package:provider/provider.dart";
import "package:uuid/uuid.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "../util/panama_time.dart";

class RequestDetailScreen extends StatefulWidget {
  const RequestDetailScreen({super.key, required this.publicId});
  final String publicId;

  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen> {
  ServiceRequestItem? _item;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  final _uuid = const Uuid();

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
      final item = await context.read<SessionController>().api.serviceRequestDetail(widget.publicId);
      if (!mounted) return;
      setState(() {
        _item = item;
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

  Future<void> _setStatus(String status) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await context.read<SessionController>().api.patchRequestStatus(widget.publicId, status);
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runDisposition(String action) async {
    final item = _item;
    if (item == null || _busy) return;
    if (!context.read<SessionController>().online) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Sin conexión. Esta acción necesita internet.")),
      );
      return;
    }

    final reasonCtrl = TextEditingController();
    final internalCtrl = TextEditingController();
    final customerCtrl = TextEditingController(text: item.customerMessageDraft);
    var category = DispositionReasonCategory.other;
    var sendCustomer = false; // never default-on: isolated/fisica must opt in explicitly
    var confirmed = false;

    final title = switch (action) {
      "reject" => "Rechazar solicitud",
      "cancel" => "Cancelar solicitud",
      "request_info" => "Pedir información",
      "reopen" => "Reabrir solicitud",
      _ => "Disposición",
    };

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 8,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
          ),
          child: StatefulBuilder(
            builder: (ctx, setLocal) {
              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Text("Solicitud ${item.publicId}", style: const TextStyle(color: HomesteadColors.mist)),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: category,
                      decoration: const InputDecoration(labelText: "Motivo (categoría)"),
                      items: [
                        for (final c in DispositionReasonCategory.rejectChoices)
                          DropdownMenuItem(value: c.value, child: Text(c.label)),
                      ],
                      onChanged: (v) {
                        if (v == null) return;
                        // Mutate without setLocal — rebuilding FormField with a new
                        // initialValue while dependents remain triggers framework assert.
                        category = v;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: reasonCtrl,
                      decoration: const InputDecoration(
                        labelText: "Detalle del motivo (opcional)",
                        helperText: "Visible en el historial administrativo",
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: internalCtrl,
                      decoration: const InputDecoration(
                        labelText: "Nota interna (solo equipo)",
                        helperText: "No se envía al cliente. No confundir con el mensaje al cliente.",
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: customerCtrl,
                      decoration: const InputDecoration(
                        labelText: "Mensaje al cliente (borrador)",
                        helperText: "Esto sí puede enviarse al cliente si marcas la casilla.",
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text("Enviar mensaje al cliente"),
                      subtitle: const Text("Si está apagado, solo se registra la disposición."),
                      value: sendCustomer,
                      onChanged: (v) => setLocal(() => sendCustomer = v),
                    ),
                    if (sendCustomer && customerCtrl.text.trim().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      const Text("Vista previa del mensaje al cliente", style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0x330B1F33)),
                        ),
                        child: Text(customerCtrl.text.trim()),
                      ),
                    ],
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: confirmed,
                      onChanged: (v) => setLocal(() => confirmed = v ?? false),
                      title: const Text("Confirmo esta acción"),
                      controlAffinity: ListTileControlAffinity.leading,
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: confirmed ? () => Navigator.pop(ctx, true) : null,
                      child: Text(title),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text("Cancelar"),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );

    final payload = (
      category: category,
      reason: reasonCtrl.text.trim(),
      internal: internalCtrl.text.trim(),
      customer: customerCtrl.text.trim(),
      send: sendCustomer,
    );
    reasonCtrl.dispose();
    internalCtrl.dispose();
    customerCtrl.dispose();

    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    final api = context.read<SessionController>().api;
    try {
      final result = await api.disposeServiceRequest(
            publicId: item.publicId,
            action: action,
            reasonCategory: payload.category,
            reason: payload.reason.isEmpty ? null : payload.reason,
            internalNote: payload.internal.isEmpty ? null : payload.internal,
            customerMessage: payload.customer.isEmpty ? null : payload.customer,
            sendCustomerMessage: payload.send,
            idempotencyKey: _uuid.v4(),
          );
      if (!mounted) return;
      if (result["ok"] == false) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("${result["error"] ?? "No se pudo completar"}")),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(payload.send ? "Disposición registrada. Mensaje al cliente solicitado." : "Disposición registrada.")),
        );
      }
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _securityReview(String action) async {
    final item = _item;
    if (item == null || _busy) return;
    final reasonCtrl = TextEditingController();
    final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(action == "set" ? "Marcar revisión de seguridad" : "Resolver revisión de seguridad"),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  action == "set"
                      ? "La solicitud quedará marcada para revisión de seguridad."
                      : "Se quitará la marca de revisión de seguridad.",
                ),
                if (action == "set") ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: reasonCtrl,
                    decoration: const InputDecoration(labelText: "Motivo"),
                    maxLines: 2,
                  ),
                ],
              ],
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("Cancelar")),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Confirmar")),
            ],
          ),
        ) ??
        false;
    final reason = reasonCtrl.text.trim();
    reasonCtrl.dispose();
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    final api = context.read<SessionController>().api;
    try {
      await api.securityReviewServiceRequest(
            publicId: item.publicId,
            action: action,
            reason: reason.isEmpty ? null : reason,
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

  @override
  Widget build(BuildContext context) {
    final item = _item;
    final online = context.watch<SessionController>().online;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.publicId),
        actions: [
          IconButton(onPressed: _loading || _busy ? null : _load, icon: const Icon(Icons.refresh)),
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
              : item == null
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
                        if (item.securityReviewRequired)
                          Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: HomesteadColors.accent.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: HomesteadColors.accentDeep.withValues(alpha: 0.4)),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  "Revisión de seguridad requerida",
                                  style: TextStyle(fontWeight: FontWeight.w700, color: HomesteadColors.accentDeep),
                                ),
                                if (item.securityReviewReason.isNotEmpty)
                                  Text(item.securityReviewReason, style: const TextStyle(color: HomesteadColors.charcoal)),
                              ],
                            ),
                          ),
                        Text(item.publicId, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
                        const SizedBox(height: 4),
                        Text("${item.name} · ${item.phone}"),
                        Text("${item.service} · ${item.status}"),
                        if (item.dispositionKind.isNotEmpty)
                          Text("Disposición: ${item.dispositionKind}", style: const TextStyle(color: HomesteadColors.mist)),
                        Text(formatPanamaIso(item.createdAt), style: const TextStyle(color: HomesteadColors.mist)),
                        if (item.message.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          const Text("Mensaje del cliente", style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text(item.message),
                        ],
                        if (item.customerMessageDraft.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          const Text("Borrador de mensaje al cliente", style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text(item.customerMessageDraft),
                        ],
                        if (item.internalNote.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0x140B1F33),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  "Nota interna (solo equipo — no enviada al cliente)",
                                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                                ),
                                const SizedBox(height: 4),
                                Text(item.internalNote),
                              ],
                            ),
                          ),
                        ],
                        if (item.relatedAppointment != null) ...[
                          const SizedBox(height: 16),
                          const Text("Cita relacionada", style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 8),
                          Card(
                            child: ListTile(
                              title: Text(item.relatedAppointment!.appointmentId.isEmpty
                                  ? "Cita"
                                  : item.relatedAppointment!.appointmentId),
                              subtitle: Text(
                                [
                                  if (item.relatedAppointment!.date.isNotEmpty) item.relatedAppointment!.date,
                                  if (item.relatedAppointment!.startTime.isNotEmpty) item.relatedAppointment!.startTime,
                                  if (item.relatedAppointment!.status.isNotEmpty) item.relatedAppointment!.status,
                                  if (item.relatedAppointment!.serviceLabel.isNotEmpty)
                                    item.relatedAppointment!.serviceLabel,
                                  if (item.relatedAppointment!.zone.isNotEmpty) item.relatedAppointment!.zone,
                                ].join(" · "),
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        const Text("Historial", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        if (item.history.isEmpty)
                          const Text("Sin eventos en el historial.", style: TextStyle(color: HomesteadColors.mist))
                        else
                          ...item.history.map((h) {
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: ListTile(
                                title: Text(h.action.isEmpty ? "Evento" : h.action),
                                subtitle: Text(
                                  [
                                    formatPanamaIso(h.at),
                                    if (h.actor.isNotEmpty) h.actor,
                                    if (h.note.isNotEmpty) h.note,
                                    if (h.isInternal) "(interno)",
                                  ].join(" · "),
                                ),
                              ),
                            );
                          }),
                        const SizedBox(height: 16),
                        const Text("Estado rápido", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            OutlinedButton(
                              onPressed: _busy || !online ? null : () => _setStatus("CONTACTED"),
                              child: const Text("Contactada"),
                            ),
                            OutlinedButton(
                              onPressed: _busy || !online ? null : () => _setStatus("IN_PROGRESS"),
                              child: const Text("En curso"),
                            ),
                            OutlinedButton(
                              onPressed: _busy || !online ? null : () => _setStatus("COMPLETED"),
                              child: const Text("Completada"),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const Text("Disposición", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (item.canReject)
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _runDisposition("reject"),
                                child: const Text("Rechazar"),
                              ),
                            if (item.canCancel)
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _runDisposition("cancel"),
                                child: const Text("Cancelar"),
                              ),
                            if (item.canRequestInfo)
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _runDisposition("request_info"),
                                child: const Text("Pedir info"),
                              ),
                            if (item.canReopen)
                              FilledButton(
                                onPressed: _busy || !online ? null : () => _runDisposition("reopen"),
                                child: const Text("Reabrir"),
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const Text("Seguridad", style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (!item.securityReviewRequired)
                              OutlinedButton(
                                onPressed: _busy || !online ? null : () => _securityReview("set"),
                                child: const Text("Marcar revisión seguridad"),
                              ),
                            if (item.securityReviewRequired)
                              FilledButton(
                                onPressed: _busy || !online ? null : () => _securityReview("resolve"),
                                child: const Text("Resolver revisión seguridad"),
                              ),
                          ],
                        ),
                        if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
                      ],
                    ),
    );
  }
}
