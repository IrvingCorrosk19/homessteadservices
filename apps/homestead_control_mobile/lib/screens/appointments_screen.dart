import "package:flutter/material.dart";
import "package:provider/provider.dart";

import "../api/models.dart";
import "../state/session_controller.dart";
import "../theme/homestead_theme.dart";
import "../util/panama_time.dart";
import "request_detail_screen.dart";

class AppointmentsScreen extends StatefulWidget {
  const AppointmentsScreen({
    super.key,
    this.focusAppointmentId,
    this.focusToken = 0,
  });

  /// When set (with a new [focusToken]), select that appointment's day and show its id.
  final String? focusAppointmentId;
  final int focusToken;

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  List<AppointmentItem> _items = [];
  bool _loading = true;
  String? _error;
  late DateTime _visibleMonth;
  late DateTime _selectedDay;
  int _appliedFocusToken = 0;

  @override
  void initState() {
    super.initState();
    final today = panamaNow();
    _selectedDay = DateTime(today.year, today.month, today.day);
    _visibleMonth = DateTime(today.year, today.month);
    _load();
  }

  @override
  void didUpdateWidget(covariant AppointmentsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.focusToken != oldWidget.focusToken &&
        widget.focusAppointmentId != null &&
        widget.focusAppointmentId!.isNotEmpty) {
      _applyFocusAppointment(widget.focusAppointmentId!);
    }
  }

  void _applyFocusAppointment(String appointmentId) {
    _appliedFocusToken = widget.focusToken;
    AppointmentItem? match;
    for (final item in _items) {
      if (item.appointmentId == appointmentId) {
        match = item;
        break;
      }
    }
    if (match != null) {
      final d = match.dateLocal;
      if (d != null) {
        setState(() {
          _selectedDay = d;
          _visibleMonth = DateTime(d.year, d.month);
        });
      }
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text("Cita $appointmentId")),
    );
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // Broad window so month navigation works offline of extra fetches; single agenda source.
      final from = isoDate(DateTime(_visibleMonth.year, _visibleMonth.month - 1, 1));
      final to = isoDate(DateTime(_visibleMonth.year, _visibleMonth.month + 2, 0));
      final items = await context.read<SessionController>().api.appointments(from: from, to: to);
      if (!mounted) return;
      // Deduplicate by appointmentId (reschedules keep one HA id; cancelled remain listed once).
      final byId = <String, AppointmentItem>{};
      for (final item in items) {
        if (item.appointmentId.isEmpty) continue;
        byId[item.appointmentId] = item;
      }
      setState(() {
        _items = byId.values.toList()
          ..sort((a, b) {
            final c = a.date.compareTo(b.date);
            if (c != 0) return c;
            return a.startTime.compareTo(b.startTime);
          });
        _loading = false;
      });
      if (widget.focusAppointmentId != null &&
          widget.focusAppointmentId!.isNotEmpty &&
          widget.focusToken != _appliedFocusToken) {
        _applyFocusAppointment(widget.focusAppointmentId!);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Set<String> get _daysWithAppointments =>
      _items.map((e) => e.date).where((d) => d.isNotEmpty).toSet();

  List<AppointmentItem> get _selectedDayItems {
    final key = isoDate(_selectedDay);
    return _items.where((e) => e.date == key).toList();
  }

  List<AppointmentItem> get _upcoming {
    final today = isoDate(panamaNow());
    return _items.where((e) {
      if (e.date.compareTo(today) < 0) return false;
      final s = e.status.toUpperCase();
      return s != "CANCELLED" && s != "COMPLETED";
    }).toList();
  }

  Color _statusColor(String status) {
    switch (status.toUpperCase()) {
      case "REQUESTED":
      case "PROPOSED":
        return HomesteadColors.accentDeep;
      case "CONFIRMED":
        return HomesteadColors.success;
      case "RESCHEDULED":
        return const Color(0xFF1D4E89);
      case "COMPLETED":
        return HomesteadColors.mist;
      case "CANCELLED":
        return HomesteadColors.danger;
      default:
        return HomesteadColors.charcoal;
    }
  }

  void _shiftMonth(int delta) {
    setState(() {
      _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month + delta);
      final last = DateTime(_visibleMonth.year, _visibleMonth.month + 1, 0).day;
      final day = _selectedDay.day.clamp(1, last);
      _selectedDay = DateTime(_visibleMonth.year, _visibleMonth.month, day);
    });
    _load();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDay,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      helpText: "Elegir fecha (America/Panama)",
      locale: const Locale("es", "PA"),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _selectedDay = DateTime(picked.year, picked.month, picked.day);
      _visibleMonth = DateTime(picked.year, picked.month);
    });
    _load();
  }

  void _openRequest(AppointmentItem item) {
    if (!item.canOpenRequest) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Esta cita no tiene solicitud HS vinculada.")),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => RequestDetailScreen(publicId: item.leadId)),
    );
  }

  Widget _monthGrid() {
    final first = DateTime(_visibleMonth.year, _visibleMonth.month, 1);
    // Monday-first grid
    final startOffset = (first.weekday + 6) % 7;
    final daysInMonth = DateTime(_visibleMonth.year, _visibleMonth.month + 1, 0).day;
    final cells = startOffset + daysInMonth;
    final rows = ((cells + 6) / 7).floor();
    final today = panamaNow();
    final todayKey = isoDate(DateTime(today.year, today.month, today.day));

    return Column(
      children: [
        Row(
          children: [
            IconButton(
              tooltip: "Mes anterior",
              onPressed: () => _shiftMonth(-1),
              icon: const Icon(Icons.chevron_left),
            ),
            Expanded(
              child: Text(
                formatPanamaMonth(_visibleMonth),
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            IconButton(
              tooltip: "Mes siguiente",
              onPressed: () => _shiftMonth(1),
              icon: const Icon(Icons.chevron_right),
            ),
            IconButton(
              tooltip: "Elegir fecha",
              onPressed: _pickDate,
              icon: const Icon(Icons.calendar_month_outlined),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Row(
          children: const [
            Expanded(child: Center(child: Text("L", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
            Expanded(child: Center(child: Text("M", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
            Expanded(child: Center(child: Text("X", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
            Expanded(child: Center(child: Text("J", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
            Expanded(child: Center(child: Text("V", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
            Expanded(child: Center(child: Text("S", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
            Expanded(child: Center(child: Text("D", style: TextStyle(fontSize: 12, color: HomesteadColors.mist)))),
          ],
        ),
        const SizedBox(height: 4),
        ...List.generate(rows, (row) {
          return Row(
            children: List.generate(7, (col) {
              final index = row * 7 + col;
              final dayNum = index - startOffset + 1;
              if (dayNum < 1 || dayNum > daysInMonth) {
                return const Expanded(child: SizedBox(height: 44));
              }
              final day = DateTime(_visibleMonth.year, _visibleMonth.month, dayNum);
              final key = isoDate(day);
              final selected = key == isoDate(_selectedDay);
              final isToday = key == todayKey;
              final has = _daysWithAppointments.contains(key);
              return Expanded(
                child: InkWell(
                  onTap: () => setState(() => _selectedDay = day),
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    height: 44,
                    margin: const EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      color: selected ? HomesteadColors.navy : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                      border: isToday && !selected
                          ? Border.all(color: HomesteadColors.accentDeep)
                          : null,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          "$dayNum",
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: selected ? HomesteadColors.cream : HomesteadColors.navy,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Container(
                          width: 5,
                          height: 5,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: has
                                ? (selected ? HomesteadColors.cream : HomesteadColors.accent)
                                : Colors.transparent,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          );
        }),
      ],
    );
  }

  Widget _appointmentCard(AppointmentItem item) {
    final color = _statusColor(item.status);
    return Card(
      child: InkWell(
        onTap: () => _openRequest(item),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    item.startTime.isEmpty ? "—" : item.startTime,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
                  ),
                  if (item.endTime.isNotEmpty)
                    Text(" – ${item.endTime}", style: const TextStyle(color: HomesteadColors.mist)),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      item.statusLabel,
                      style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                item.customerName.isEmpty ? "(Sin cliente)" : item.customerName,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(item.serviceLabel.isEmpty ? "Servicio —" : item.serviceLabel),
              const SizedBox(height: 4),
              Text(
                [
                  if (item.zone.isNotEmpty) item.zone else "Ubicación no indicada",
                  if (item.leadId.isNotEmpty) item.leadId,
                  item.appointmentId,
                ].join(" · "),
                style: const TextStyle(color: HomesteadColors.mist, fontSize: 13),
              ),
              const SizedBox(height: 6),
              Text(
                item.hasAssignee ? "Responsable: ${item.assignedTo}" : "Sin asignar",
                style: TextStyle(
                  color: item.hasAssignee ? HomesteadColors.charcoal : HomesteadColors.accentDeep,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              if (item.canOpenRequest)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    "Toca para abrir la solicitud",
                    style: TextStyle(color: HomesteadColors.mist, fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final online = context.watch<SessionController>().online;
    final dayItems = _selectedDayItems;
    final upcoming = _upcoming.take(8).toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text("Agenda"),
        actions: [
          IconButton(
            tooltip: "Hoy",
            onPressed: () {
              final t = panamaNow();
              setState(() {
                _selectedDay = DateTime(t.year, t.month, t.day);
                _visibleMonth = DateTime(t.year, t.month);
              });
              _load();
            },
            icon: const Icon(Icons.today_outlined),
          ),
          IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: Column(
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (!online)
            Container(
              width: double.infinity,
              color: HomesteadColors.danger.withValues(alpha: 0.12),
              padding: const EdgeInsets.all(12),
              child: const Text(
                "Sin conexión. No se puede actualizar la agenda.",
                style: TextStyle(color: HomesteadColors.danger),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Text(_error!, style: const TextStyle(color: HomesteadColors.danger)),
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    "Zona horaria America/Panama · ${formatPanamaNow()}",
                    style: const TextStyle(color: HomesteadColors.mist, fontSize: 13),
                  ),
                  const SizedBox(height: 8),
                  _monthGrid(),
                  const SizedBox(height: 16),
                  Text(
                    formatPanamaDate(_selectedDay),
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  if (!_loading && dayItems.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(
                        child: Text(
                          "Sin citas este día.",
                          style: TextStyle(color: HomesteadColors.mist),
                        ),
                      ),
                    ),
                  ...dayItems.map(_appointmentCard),
                  if (upcoming.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    const Text("Próximas citas", style: TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    ...upcoming.map((item) {
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text("${item.date} · ${item.startTime} · ${item.customerName}"),
                        subtitle: Text(
                          "${item.serviceLabel} · ${item.statusLabel}"
                          "${item.hasAssignee ? " · ${item.assignedTo}" : " · Sin asignar"}",
                        ),
                        trailing: Icon(Icons.chevron_right, color: _statusColor(item.status)),
                        onTap: () {
                          final d = item.dateLocal;
                          if (d != null) {
                            setState(() {
                              _selectedDay = d;
                              _visibleMonth = DateTime(d.year, d.month);
                            });
                          }
                          _openRequest(item);
                        },
                      );
                    }),
                  ],
                  const SizedBox(height: 24),
                  const Text(
                    "Misma agenda del servidor Homestead. Cancelaciones y reprogramaciones se reflejan aquí; no se crea una agenda paralela.",
                    style: TextStyle(color: HomesteadColors.mist, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
