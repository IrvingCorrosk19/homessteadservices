/// Default production API. Override with --dart-define=API_BASE=https://...
const String kApiBase = String.fromEnvironment(
  "API_BASE",
  defaultValue: "https://homestead.lat",
);

const String kMobileClientHeader = "control-mobile";
const String kAppName = "Homestead Control";
const String kTimeZoneLabel = "America/Panama";
const int kMaxContentPhotos = 8;
