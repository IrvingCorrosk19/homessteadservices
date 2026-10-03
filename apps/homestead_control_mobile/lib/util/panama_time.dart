import "package:intl/intl.dart";

String formatPanamaNow() {
  final now = DateTime.now().toUtc().subtract(const Duration(hours: 5));
  return DateFormat("EEEE d MMM yyyy · HH:mm", "es_PA").format(now) + " (Panamá)";
}

String formatPanamaIso(String? iso) {
  if (iso == null || iso.isEmpty) return "—";
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return iso;
  final panama = parsed.toUtc().subtract(const Duration(hours: 5));
  return DateFormat("d MMM yyyy · HH:mm", "es_PA").format(panama);
}
