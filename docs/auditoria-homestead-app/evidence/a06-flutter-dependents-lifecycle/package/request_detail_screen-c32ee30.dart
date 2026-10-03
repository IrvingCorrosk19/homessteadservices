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
        const SnackBar(content: Text("Sin conexi├│n. Esta acci├│n necesita internet.")),
      );
      return;
    }

    final title = switch (action) {
      "reject" => "Rechazar solicitud",
      "cancel" => "Cancelar solicitud",
      "request_info" => "Pedir informaci├│n",
      "reopen" => "Reabrir solicitud",
      _ => "Disposici├│n",
    };

    final payload = await showModalBottomSheet<_DispositionPayload>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _DispositionSheet(
        title: title,
        publicId: item.publicId,
        customerMessageDraft: item.customerMessageDraft,
      ),
    );
    // Wait for sheet route + keyboard MediaQuery dependents to clear.
    await _awaitRouteTeardown();
    if (payload == null || !mounted) return;

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
          SnackBar(content: Text(payload.send ? "Disposici├│n registrada. Mensaje al cliente solicitado." : "Disposici├│n registrada.")),
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
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => _SecurityReviewDialog(action: action),
    );
    // showDialog completes on pop while the route may still be deactivating
    // InheritedWidgets (MediaQuery/keyboard). Rebuild only after teardown.
    await _awaitRouteTeardown();
    if (reason == null || !mounted) return;

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

  /// Yield until modal route exit + a frame so InheritedElement dependents clear.
  Future<void> _awaitRouteTeardown() async {
    await Future<void>.delayed(Duration.zero);
    if (!mounted) return;
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    await Future<void>.delayed(const Duration(milliseconds: 50));
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
                              "Sin conexi├│n. Las acciones necesitan internet.",
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
                                  "Revisi├│n de seguridad requerida",
                                  style: TextStyle(fontWeight: FontWeight.w700, color: HomesteadColors.accentDeep),
                                ),
                                if (item.securityReviewReason.isNotEmpty)
                                  Text(item.securityReviewReason, style: const TextStyle(color: HomesteadColors.charcoal)),
                              ],
                            ),
                          ),
                        Text(item.publicId, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
                        const SizedBox(height: 4),
                        Text("${item.name} ┬╖ ${item.phone}"),
                        Text("${item.service} ┬╖ ${item.status}"),
                        if (item.dispositionKind.isNotEmpty)
                          Text("Disposici├│n: ${item.dispositionKind}", style: const TextStyle(color: HomesteadColors.mist)),
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
                                  "Nota interna (solo equipo ΓÇö no enviada al cliente)",
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
                                ].join(" ┬╖ "),
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
                                  ].join(" ┬╖ "),
                                ),
                              ),
                            );
                          }),
                        const SizedBox(height: 16),
                        const Text("Estado r├ípido", style: TextStyle(fontWeight: FontWeight.w700)),
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
                        const Text("Disposici├│n", style: TextStyle(fontWeight: FontWeight.w700)),
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
                                child: const Text("Marcar revisi├│n seguridad"),
                              ),
                            if (item.securityReviewRequired)
                              FilledButton(
                                onPressed: _busy || !online ? null : () => _securityReview("resolve"),
                                child: const Text("Resolver revisi├│n seguridad"),
                              ),
                          ],
                        ),
                        if (_busy) const Padding(padding: EdgeInsets.only(top: 16), child: LinearProgressIndicator()),
                      ],
                    ),
    );
  }
}

class _DispositionPayload {
  const _DispositionPayload({
    required this.category,
    required this.reason,
    required this.internal,
    required this.customer,
    required this.send,
  });
  final String category;
  final String reason;
  final String internal;
  final String customer;
  final bool send;
}

/// Security dialog without TextEditingController ΓÇö avoids dispose races with
/// InheritedElement (MediaQuery/keyboard) during route pop (_dependents.isEmpty).
class _SecurityReviewDialog extends StatefulWidget {
  const _SecurityReviewDialog({required this.action});
  final String action;

  @override
  State<_SecurityReviewDialog> createState() => _SecurityReviewDialogState();
}

class _SecurityReviewDialogState extends State<_SecurityReviewDialog> {
  String _reason = "";

  void _confirm() {
    FocusScope.of(context).unfocus();
    Navigator.pop(context, _reason.trim());
  }

  @override
  Widget build(BuildContext context) {
    final isSet = widget.action == "set";
    return AlertDialog(
      title: Text(isSet ? "Marcar revisi├│n de seguridad" : "Resolver revisi├│n de seguridad"),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            isSet
                ? "La solicitud quedar├í marcada para revisi├│n de seguridad."
                : "Se quitar├í la marca de revisi├│n de seguridad.",
          ),
          if (isSet) ...[
            const SizedBox(height: 12),
            TextField(
              decoration: const InputDecoration(labelText: "Motivo"),
              maxLines: 2,
              onChanged: (v) => _reason = v,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _confirm(),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () {
            FocusScope.of(context).unfocus();
            Navigator.pop(context);
          },
          child: const Text("Cancelar"),
        ),
        FilledButton(onPressed: _confirm, child: const Text("Confirmar")),
      ],
    );
  }
}

/// Disposition sheet without TextEditingControllers (same dependents teardown race).
class _DispositionSheet extends StatefulWidget {
  const _DispositionSheet({
    required this.title,
    required this.publicId,
    required this.customerMessageDraft,
  });
  final String title;
  final String publicId;
  final String customerMessageDraft;

  @override
  State<_DispositionSheet> createState() => _DispositionSheetState();
}

class _DispositionSheetState extends State<_DispositionSheet> {
  late String _reason;
  late String _internal;
  late String _customer;
  String _category = DispositionReasonCategory.other;
  var _sendCustomer = false; // never default-on: isolated/fisica must opt in explicitly
  var _confirmed = false;

  @override
  void initState() {
    super.initState();
    _reason = "";
    _internal = "";
    _customer = widget.customerMessageDraft;
  }

  void _submit() {
    FocusScope.of(context).unfocus();
    Navigator.pop(
      context,
      _DispositionPayload(
        category: _category,
        reason: _reason.trim(),
        internal: _internal.trim(),
        customer: _customer.trim(),
        send: _sendCustomer,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text("Solicitud ${widget.publicId}", style: const TextStyle(color: HomesteadColors.mist)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: "Motivo (categor├¡a)"),
              items: [
                for (final c in DispositionReasonCategory.rejectChoices)
                  DropdownMenuItem(value: c.value, child: Text(c.label)),
              ],
              onChanged: (v) {
                if (v == null) return;
                // Mutate without setState ΓÇö rebuilding FormField with a new
                // initialValue while dependents remain triggers framework assert.
                _category = v;
              },
            ),
            const SizedBox(height: 12),
            TextField(
              decoration: const InputDecoration(
                labelText: "Detalle del motivo (opcional)",
                helperText: "Visible en el historial administrativo",
              ),
              maxLines: 2,
              onChanged: (v) => _reason = v,
            ),
            const SizedBox(height: 12),
            TextField(
              decoration: const InputDecoration(
                labelText: "Nota interna (solo equipo)",
                helperText: "No se env├¡a al cliente. No confundir con el mensaje al cliente.",
              ),
              maxLines: 2,
              onChanged: (v) => _internal = v,
            ),
            const SizedBox(height: 12),
            TextField(
              decoration: const InputDecoration(
                labelText: "Mensaje al cliente (borrador)",
                helperText: "Esto s├¡ puede enviarse al cliente si marcas la casilla.",
              ),
              maxLines: 3,
              onChanged: (v) {
                _customer = v;
                if (_sendCustomer) setState(() {});
              },
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text("Enviar mensaje al cliente"),
              subtitle: const Text("Si est├í apagado, solo se registra la disposici├│n."),
              value: _sendCustomer,
              onChanged: (v) => setState(() => _sendCustomer = v),
            ),
            if (_sendCustomer && _customer.trim().isNotEmpty) ...[
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
                child: Text(_customer.trim()),
              ),
            ],
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _confirmed,
              onChanged: (v) => setState(() => _confirmed = v ?? false),
              title: const Text("Confirmo esta acci├│n"),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _confirmed ? _submit : null,
              child: Text(widget.title),
            ),
            TextButton(
              onPressed: () {
                FocusScope.of(context).unfocus();
                Navigator.pop(context);
              },
              child: const Text("Cancelar"),
            ),
          ],
        ),
      ),
    );
  }
}
