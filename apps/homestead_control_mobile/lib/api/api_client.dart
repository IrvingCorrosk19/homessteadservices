import "dart:async";
import "dart:convert";
import "dart:io";
import "dart:typed_data";

import "package:http/http.dart" as http;
import "package:http_parser/http_parser.dart";
import "package:path/path.dart" as p;
import "package:uuid/uuid.dart";

import "../config.dart";
import "models.dart";

typedef TokenReader = Future<String?> Function();
typedef CsrfReader = Future<String?> Function();
typedef AuthCleared = Future<void> Function();

class HomesteadApi {
  HomesteadApi({
    required this.baseUrl,
    required this.readSession,
    required this.readCsrf,
    required this.onUnauthorized,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final String baseUrl;
  final TokenReader readSession;
  final CsrfReader readCsrf;
  final AuthCleared onUnauthorized;
  final http.Client _client;

  Uri _u(String path, [Map<String, String>? query]) {
    final root = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    return Uri.parse("$root$path").replace(queryParameters: query);
  }

  Future<Map<String, String>> _headers({bool mutating = false, bool json = true}) async {
    final headers = <String, String>{
      "Accept": "application/json",
      "X-Homestead-Client": kMobileClientHeader,
    };
    if (json) headers["Content-Type"] = "application/json";
    final session = await readSession();
    if (session != null && session.isNotEmpty) {
      headers["Authorization"] = "Bearer $session";
    }
    if (mutating) {
      final csrf = await readCsrf();
      if (csrf != null && csrf.isNotEmpty) {
        headers["X-CSRF-Token"] = csrf;
      }
    }
    return headers;
  }

  Future<Map<String, dynamic>> _decode(http.Response response) async {
    if (response.statusCode == 401) {
      await onUnauthorized();
      throw ApiException("Sesión vencida. Vuelve a iniciar sesión.", statusCode: 401, code: "unauthorized");
    }
    Map<String, dynamic> body = {};
    if (response.body.isNotEmpty) {
      final parsed = jsonDecode(response.body);
      if (parsed is Map<String, dynamic>) body = parsed;
      else if (parsed is Map) body = Map<String, dynamic>.from(parsed);
    }
    if (response.statusCode >= 400) {
      throw ApiException(
        "${body["error"] ?? "Error ${response.statusCode}"}",
        statusCode: response.statusCode,
        code: "${body["error"] ?? ""}",
      );
    }
    return body;
  }

  Future<Map<String, dynamic>> _get(String path, [Map<String, String>? query]) async {
    try {
      final response = await _client
          .get(_u(path, query), headers: await _headers())
          .timeout(const Duration(seconds: 45));
      return _decode(response);
    } on SocketException {
      throw ApiException("Sin conexión. Esta acción necesita internet.", code: "offline");
    } on TimeoutException {
      throw ApiException("Tiempo de espera agotado. No se repitió la operación.", code: "timeout");
    }
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body, {bool mutating = true}) async {
    try {
      final response = await _client
          .post(
            _u(path),
            headers: await _headers(mutating: mutating),
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 120));
      return _decode(response);
    } on SocketException {
      throw ApiException("Sin conexión. Esta acción necesita internet.", code: "offline");
    } on TimeoutException {
      throw ApiException("Tiempo de espera agotado. No se repitió la operación.", code: "timeout");
    }
  }

  Future<Map<String, dynamic>> _patch(String path, Map<String, dynamic> body) async {
    try {
      final response = await _client
          .patch(
            _u(path),
            headers: await _headers(mutating: true),
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 45));
      return _decode(response);
    } on SocketException {
      throw ApiException("Sin conexión. Esta acción necesita internet.", code: "offline");
    } on TimeoutException {
      throw ApiException("Tiempo de espera agotado. No se repitió la operación.", code: "timeout");
    }
  }

  Future<({String session, String csrf})> login(String password) async {
    final body = await _post("/api/admin/login", {"password": password}, mutating: false);
    final session = "${body["session"] ?? ""}";
    final csrf = "${body["csrf"] ?? ""}";
    if (session.isEmpty || csrf.isEmpty) {
      throw ApiException("El servidor no devolvió sesión móvil. ¿APIs desplegadas?");
    }
    return (session: session, csrf: csrf);
  }

  Future<void> logout() async {
    try {
      await _post("/api/admin/logout", {});
    } catch (_) {
      // local clear still happens in SessionController
    }
  }

  Future<Map<String, dynamic>> sessionProbe() => _get("/api/admin/control/session");

  Future<HomeSummary> home() async => HomeSummary(await _get("/api/admin/content/home"));

  Future<List<ContentJobCard>> jobs({String state = "all", String q = ""}) async {
    final query = <String, String>{"state": state};
    if (q.trim().isNotEmpty) query["q"] = q.trim();
    final body = await _get("/api/admin/content/jobs", query);
    final list = body["jobs"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => ContentJobCard(Map<String, dynamic>.from(e))).toList();
  }

  Future<ContentJobCard> jobDetail(String publicId) async {
    final body = await _get("/api/admin/content/jobs/$publicId");
    return ContentJobCard(Map<String, dynamic>.from(body["job"] as Map));
  }

  Future<Map<String, dynamic>> jobAction({
    required String publicId,
    required String action,
    required int version,
    bool confirm = false,
    String? idempotencyKey,
  }) {
    return _post("/api/admin/content/jobs/$publicId/action", {
      "action": action,
      "version": version,
      "confirm": confirm,
      "idempotencyKey": idempotencyKey ?? const Uuid().v4(),
    });
  }

  Future<Map<String, dynamic>> publishPreview(String publicId) =>
      _get("/api/admin/content/jobs/$publicId/preview");

  Future<Uint8List> mediaBytes(int assetId) async {
    try {
      final response = await _client
          .get(_u("/api/admin/content/media", {"asset": "$assetId"}), headers: await _headers(json: false))
          .timeout(const Duration(seconds: 45));
      if (response.statusCode == 401) {
        await onUnauthorized();
        throw ApiException("Sesión vencida.", statusCode: 401, code: "unauthorized");
      }
      if (response.statusCode >= 400) {
        throw ApiException("No se pudo cargar la imagen", statusCode: response.statusCode);
      }
      return response.bodyBytes;
    } on SocketException {
      throw ApiException("Sin conexión.", code: "offline");
    }
  }

  Future<Map<String, dynamic>> ingestPhotos({
    required List<File> files,
    String note = "",
    void Function(int sent, int total)? onProgress,
  }) async {
    try {
      final request = http.MultipartRequest("POST", _u("/api/admin/content/intake"));
      request.headers.addAll(await _headers(mutating: true, json: false));
      request.fields["note"] = note;
      for (final file in files) {
        final bytes = await file.readAsBytes();
        request.files.add(
          http.MultipartFile.fromBytes(
            "files",
            bytes,
            filename: p.basename(file.path),
            contentType: MediaType("image", "jpeg"),
          ),
        );
      }
      onProgress?.call(0, files.length);
      final streamed = await request.send().timeout(const Duration(seconds: 180));
      final response = await http.Response.fromStream(streamed);
      onProgress?.call(files.length, files.length);
      return _decode(response);
    } on SocketException {
      throw ApiException("Sin conexión. La carga no se encoló para reintento automático.", code: "offline");
    } on TimeoutException {
      throw ApiException("Tiempo de espera agotado al subir. Revisa el lote antes de repetir.", code: "timeout");
    }
  }

  Future<Map<String, dynamic>> studio() => _get("/api/admin/content/studio");

  Future<Map<String, dynamic>> setStudioPaused(bool paused) =>
      _post("/api/admin/content/studio", {"paused": paused});

  Future<List<Map<String, dynamic>>> batches() async {
    final body = await _get("/api/admin/content/batches");
    final list = body["batches"] ?? body["items"] ?? [];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<List<Map<String, dynamic>>> campaigns() async {
    final body = await _get("/api/admin/content/campaigns");
    final list = body["campaigns"] ?? body["items"] ?? [];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<Map<String, dynamic>> setCampaignPaused(String campaignId, bool paused) =>
      _post("/api/admin/content/campaigns/$campaignId/pause", {"paused": paused});

  Future<Map<String, dynamic>> errors() => _get("/api/admin/content/errors");

  Future<List<ServiceRequestItem>> serviceRequests({String q = "", String status = "ALL"}) async {
    final body = await _get("/api/admin/service-requests", {
      "q": q,
      "status": status,
    });
    final list = body["requests"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => ServiceRequestItem(Map<String, dynamic>.from(e))).toList();
  }

  Future<Map<String, dynamic>> patchRequestStatus(String publicId, String status) =>
      _patch("/api/admin/service-requests/$publicId", {"status": status});

  Future<List<AppointmentItem>> appointments() async {
    final body = await _get("/api/admin/appointments");
    final list = body["appointments"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => AppointmentItem(Map<String, dynamic>.from(e))).toList();
  }

  Future<Map<String, dynamic>> patchAppointment(String id, Map<String, dynamic> body) =>
      _patch("/api/admin/appointments/$id", body);

  Future<List<CustomerItem>> customers({String q = ""}) async {
    final body = await _get("/api/admin/customers", {"q": q});
    final list = body["customers"];
    if (list is! List) return const [];
    return list.whereType<Map>().map((e) => CustomerItem(Map<String, dynamic>.from(e))).toList();
  }

  void close() => _client.close();
}
