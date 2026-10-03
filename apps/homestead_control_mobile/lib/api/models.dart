class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;

  bool get isUnauthorized => statusCode == 401 || code == "unauthorized";
  bool get isOffline => code == "offline";

  @override
  String toString() => message;
}

class HomeSummary {
  HomeSummary(this.raw);
  final Map<String, dynamic> raw;

  Map<String, dynamic> get _counts {
    final c = raw["counts"];
    return c is Map ? Map<String, dynamic>.from(c) : raw;
  }

  int get pendingApproval => _int(_counts["pendingApproval"]);
  int get scheduled => _int(_counts["scheduled"]);
  int get needsReview => _int(_counts["needsReview"]);
  int get failed => _int(_counts["partial"]) + _int(_counts["needsReview"]);
  bool get paused => raw["settings"]?["paused"] == true || raw["paused"] == true;
  bool get dryRun => raw["settings"]?["dryRun"] == true || raw["dryRun"] == true;

  static int _int(dynamic v) => v is int ? v : int.tryParse("$v") ?? 0;
}

class ContentJobCard {
  ContentJobCard(this.raw);
  final Map<String, dynamic> raw;

  String get publicId => "${raw["publicId"] ?? ""}";
  String get status => "${raw["status"] ?? ""}";
  String get displayState => "${raw["displayState"] ?? ""}";
  String get displayLabel => "${raw["displayLabel"] ?? displayState}";
  int get version => int.tryParse("${raw["version"] ?? 0}") ?? 0;
  String get copy => "${raw["copy"] ?? ""}";
  String get recommendedPublishLabel => "${raw["recommendedPublishLabel"] ?? ""}";
  String get lastErrorLabel => "${raw["lastErrorLabel"] ?? raw["lastError"] ?? ""}";
  int? get previewAssetId {
    final v = raw["previewAssetId"];
    if (v == null) return null;
    return int.tryParse("$v");
  }

  List<PlatformPub> get publications {
    final list = raw["publications"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => PlatformPub(Map<String, dynamic>.from(e))).toList();
  }

  Map<String, dynamic> get actions {
    final a = raw["actions"];
    return a is Map ? Map<String, dynamic>.from(a) : {};
  }

  bool actionEnabled(String key) => actions[key] == true;
}

class PlatformPub {
  PlatformPub(this.raw);
  final Map<String, dynamic> raw;
  String get platform => "${raw["platform"] ?? ""}";
  String get status => "${raw["status"] ?? ""}";
  String get permalink => "${raw["permalink"] ?? ""}";
  String get errorLabel => "${raw["errorLabel"] ?? raw["error"] ?? ""}";
  bool get dryRun => raw["dryRun"] == true;
}

class ServiceRequestItem {
  ServiceRequestItem(this.raw);
  final Map<String, dynamic> raw;
  String get publicId => "${raw["publicId"] ?? ""}";
  String get name => "${raw["name"] ?? ""}";
  String get phone => "${raw["phone"] ?? ""}";
  String get service => "${raw["service"] ?? ""}";
  String get status => "${raw["status"] ?? ""}";
  String get message => "${raw["message"] ?? ""}";
  String get createdAt => "${raw["createdAt"] ?? ""}";
}

class AppointmentItem {
  AppointmentItem(this.raw);
  final Map<String, dynamic> raw;
  String get appointmentId => "${raw["appointmentId"] ?? ""}";
  String get date => "${raw["date"] ?? ""}";
  String get startTime => "${raw["startTime"] ?? ""}";
  String get status => "${raw["status"] ?? ""}";
  String get customerName => "${raw["customerName"] ?? raw["customerFirst"] ?? ""}";
  String get serviceLabel => "${raw["serviceLabel"] ?? ""}";
  String get zone => "${raw["zone"] ?? ""}";
}

class CustomerItem {
  CustomerItem(this.raw);
  final Map<String, dynamic> raw;
  int get id => int.tryParse("${raw["id"] ?? raw["customerId"] ?? 0}") ?? 0;
  String get name => "${raw["name"] ?? ""}";
  String get phone => "${raw["phone"] ?? ""}";
  String get email => "${raw["email"] ?? ""}";
}

class IntakeResult {
  IntakeResult(this.raw);
  final Map<String, dynamic> raw;
  bool get ok => raw["ok"] == true;
  List<Map<String, dynamic>> get items {
    final list = raw["items"] ?? raw["results"] ?? raw["jobs"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }
}
