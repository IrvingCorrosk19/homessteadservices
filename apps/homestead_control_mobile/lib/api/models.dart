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

/// Intake / job publish modality.
class PublishMode {
  static const album = "album";
  static const separate = "separate";

  static String label(String? mode) {
    switch (mode) {
      case album:
        return "Una publicación con varias fotos";
      case separate:
        return "Una publicación por foto";
      default:
        return mode == null || mode.isEmpty ? "—" : mode;
    }
  }
}

class MediaItem {
  MediaItem(this.raw);
  final Map<String, dynamic> raw;

  int get assetId => int.tryParse("${raw["assetId"] ?? 0}") ?? 0;
  int? get width {
    final v = raw["width"];
    if (v == null) return null;
    return int.tryParse("$v");
  }

  int? get height {
    final v = raw["height"];
    if (v == null) return null;
    return int.tryParse("$v");
  }

  int? get order {
    final v = raw["order"] ?? raw["index"];
    if (v == null) return null;
    return int.tryParse("$v");
  }
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
  /// Operator AI context (stored as job.description). Not published as-is.
  String get aiContext => "${raw["description"] ?? raw["aiContext"] ?? ""}";
  String get recommendedPublishLabel => "${raw["recommendedPublishLabel"] ?? ""}";
  String get lastErrorLabel => "${raw["lastErrorLabel"] ?? raw["lastError"] ?? ""}";
  String get format => "${raw["format"] ?? ""}";
  String get publishMode => "${raw["publishMode"] ?? ""}";
  String get laterNote => "${raw["laterNote"] ?? ""}";

  String get modalityLabel {
    if (publishMode.isNotEmpty) return PublishMode.label(publishMode);
    if (format.toUpperCase() == "CAROUSEL") return PublishMode.label(PublishMode.album);
    if (format.isNotEmpty) return format;
    return "—";
  }

  int? get previewAssetId {
    final v = raw["previewAssetId"];
    if (v == null) return null;
    return int.tryParse("$v");
  }

  int? get originalAssetId {
    final v = raw["originalAssetId"];
    if (v == null) return null;
    return int.tryParse("$v");
  }

  int? get brandedAssetId {
    final v = raw["brandedAssetId"] ?? raw["previewAssetId"];
    if (v == null) return null;
    return int.tryParse("$v");
  }

  bool get publishImageReady => raw["publishImageReady"] == true;
  String get publishImageIssueLabel =>
      "${raw["publishImageIssueLabel"] ?? raw["publishImageIssue"] ?? ""}";
  String get processingPhase => "${raw["processingPhase"] ?? ""}";

  String get processingPhaseLabel {
    switch (processingPhase) {
      case "uploading":
        return "Subiendo";
      case "processing":
        return "Procesando";
      case "ready":
        return "Lista para revisar";
      case "error":
        return "Error de imagen";
      default:
        return processingPhase.isEmpty ? displayLabel : processingPhase;
    }
  }

  String get brandedDims {
    final w = raw["brandedWidth"];
    final h = raw["brandedHeight"];
    if (w == null || h == null) return "";
    return "${w}×$h";
  }

  List<MediaItem> get mediaItems {
    final list = raw["mediaItems"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => MediaItem(Map<String, dynamic>.from(e))).toList();
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

/// Admin reject / cancel reason categories (API values + Spanish labels).
class DispositionReasonCategory {
  static const securityRisk = "SECURITY_RISK";
  static const outOfCoverage = "OUT_OF_COVERAGE";
  static const serviceNotOffered = "SERVICE_NOT_OFFERED";
  static const requirementsNotMet = "REQUIREMENTS_NOT_MET";
  static const noAvailability = "NO_AVAILABILITY";
  static const other = "OTHER";

  static const List<({String value, String label})> rejectChoices = [
    (value: securityRisk, label: "Riesgo de seguridad"),
    (value: outOfCoverage, label: "Fuera de cobertura"),
    (value: serviceNotOffered, label: "Servicio no ofrecido"),
    (value: requirementsNotMet, label: "Condiciones o requisitos incumplidos"),
    (value: noAvailability, label: "Falta de disponibilidad"),
    (value: other, label: "Otro"),
  ];

  static String labelFor(String? value) {
    for (final c in rejectChoices) {
      if (c.value == value) return c.label;
    }
    if (value == null || value.isEmpty) return "—";
    return value;
  }
}

class ServiceRequestHistoryEntry {
  ServiceRequestHistoryEntry(this.raw);
  final Map<String, dynamic> raw;

  String get at => "${raw["at"] ?? raw["createdAt"] ?? raw["timestamp"] ?? ""}";
  String get action => "${raw["action"] ?? raw["kind"] ?? raw["event"] ?? ""}";
  String get actor => "${raw["actor"] ?? ""}";
  String get note => "${raw["note"] ?? raw["summary"] ?? ""}";
  /// Never treat as customer-facing unless explicitly marked.
  bool get isInternal => raw["internal"] == true || raw["visibility"] == "internal";
}

class RelatedAppointment {
  RelatedAppointment(this.raw);
  final Map<String, dynamic> raw;

  String get appointmentId => "${raw["appointmentId"] ?? raw["id"] ?? ""}";
  String get date => "${raw["date"] ?? ""}";
  String get startTime => "${raw["startTime"] ?? ""}";
  String get status => "${raw["status"] ?? ""}";
  String get serviceLabel => "${raw["serviceLabel"] ?? ""}";
  String get zone => "${raw["zone"] ?? ""}";
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
  String get dispositionKind => "${raw["dispositionKind"] ?? ""}";
  /// Admin-only. Never show as if it were sent to the customer.
  String get internalNote => "${raw["internalNote"] ?? ""}";
  String get customerMessageDraft => "${raw["customerMessageDraft"] ?? ""}";
  bool get securityReviewRequired =>
      raw["securityReviewRequired"] == true || status.toUpperCase().contains("SECURITY");
  String get securityReviewReason => "${raw["securityReviewReason"] ?? ""}";

  List<ServiceRequestHistoryEntry> get history {
    final list = raw["history"];
    if (list is! List) return const [];
    return list
        .whereType<Map>()
        .map((e) => ServiceRequestHistoryEntry(Map<String, dynamic>.from(e)))
        .toList();
  }

  RelatedAppointment? get relatedAppointment {
    final a = raw["relatedAppointment"];
    if (a is Map) return RelatedAppointment(Map<String, dynamic>.from(a));
    return null;
  }

  bool get canCancel => status == "IN_PROGRESS";
  bool get canReopen => status == "CANCELLED";
  bool get canReject =>
      status == "NEW" || status == "CONTACTED" || status == "IN_PROGRESS" || status == "NEEDS_INFO";
  bool get canRequestInfo => status != "CANCELLED" && status != "COMPLETED" && status != "REJECTED";
}

class AppointmentItem {
  AppointmentItem(this.raw);
  final Map<String, dynamic> raw;
  String get appointmentId => "${raw["appointmentId"] ?? ""}";
  /// Service-request folio when linked (HS-…).
  String get leadId => "${raw["leadId"] ?? raw["publicId"] ?? ""}";
  String get date => "${raw["date"] ?? ""}";
  String get startTime => "${raw["startTime"] ?? ""}";
  String get endTime => "${raw["endTime"] ?? ""}";
  String get status => "${raw["status"] ?? ""}";
  String get customerName => "${raw["customerName"] ?? raw["customerFirst"] ?? ""}";
  String get serviceLabel => "${raw["serviceLabel"] ?? ""}";
  String get zone => "${raw["zone"] ?? ""}";
  String get assignedTo => "${raw["assignedTo"] ?? ""}";
  String get phone => "${raw["phone"] ?? ""}";
  String get originLabel => "${raw["originLabel"] ?? ""}";

  bool get hasAssignee => assignedTo.trim().isNotEmpty;
  bool get canOpenRequest => leadId.startsWith("HS-");

  DateTime? get dateLocal {
    final parts = date.split("-");
    if (parts.length != 3) return null;
    final y = int.tryParse(parts[0]);
    final m = int.tryParse(parts[1]);
    final d = int.tryParse(parts[2]);
    if (y == null || m == null || d == null) return null;
    return DateTime(y, m, d);
  }

  String get statusLabel {
    switch (status.toUpperCase()) {
      case "REQUESTED":
        return "Solicitada";
      case "PROPOSED":
        return "Propuesta";
      case "CONFIRMED":
        return "Confirmada";
      case "RESCHEDULED":
        return "Reprogramada";
      case "COMPLETED":
        return "Completada";
      case "CANCELLED":
        return "Cancelada";
      default:
        return status.isEmpty ? "—" : status;
    }
  }
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
