/// Default production API. Override with --dart-define=API_BASE=https://...
const String kApiBase = String.fromEnvironment(
  "API_BASE",
  defaultValue: "https://homestead.lat",
);

const String kMobileClientHeader = "control-mobile";
const String kAppName = "Homestead Control";
const String kTimeZoneLabel = "America/Panama";
const int kMaxContentPhotos = 8;

bool get kIsProductionApi =>
    kApiBase == "https://homestead.lat" || kApiBase == "https://homestead.lat/";

/// Visible banner when the APK is not talking to production.
String get kApiEnvironmentLabel {
  if (kIsProductionApi) return "";
  final uri = Uri.tryParse(kApiBase);
  final host = uri?.host.isNotEmpty == true ? uri!.host : kApiBase;
  final port = uri?.hasPort == true ? ":${uri!.port}" : "";
  return "ENTORNO DE PRUEBA · $host$port";
}
