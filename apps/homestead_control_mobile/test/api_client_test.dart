import "dart:convert";

import "package:flutter_test/flutter_test.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";

import "package:homestead_control_mobile/api/api_client.dart";
import "package:homestead_control_mobile/api/models.dart";

void main() {
  test("login requires mobile session body", () async {
    final client = MockClient((request) async {
      expect(request.headers["X-Homestead-Client"], "control-mobile");
      expect(request.url.path, "/api/admin/login");
      return http.Response(jsonEncode({"ok": true, "csrf": "csrf-1", "session": "exp.nonce.sig"}), 200);
    });
    final api = HomesteadApi(
      baseUrl: "https://example.test",
      readSession: () async => null,
      readCsrf: () async => null,
      onUnauthorized: () async {},
      client: client,
    );
    final result = await api.login("secret");
    expect(result.session, "exp.nonce.sig");
    expect(result.csrf, "csrf-1");
  });

  test("mutations send bearer and csrf", () async {
    http.Request? seen;
    final client = MockClient((request) async {
      seen = request;
      return http.Response(jsonEncode({"ok": true}), 200);
    });
    final api = HomesteadApi(
      baseUrl: "https://example.test",
      readSession: () async => "token-abc",
      readCsrf: () async => "csrf-xyz",
      onUnauthorized: () async {},
      client: client,
    );
    await api.setStudioPaused(true);
    expect(seen!.headers["Authorization"], "Bearer token-abc");
    expect(seen!.headers["X-CSRF-Token"], "csrf-xyz");
    expect(seen!.headers["X-Homestead-Client"], "control-mobile");
  });

  test("401 clears session via callback", () async {
    var cleared = false;
    final client = MockClient((request) async {
      return http.Response(jsonEncode({"ok": false, "error": "unauthorized"}), 401);
    });
    final api = HomesteadApi(
      baseUrl: "https://example.test",
      readSession: () async => "token",
      readCsrf: () async => "csrf",
      onUnauthorized: () async {
        cleared = true;
      },
      client: client,
    );
    await expectLater(api.home(), throwsA(isA<ApiException>()));
    expect(cleared, isTrue);
  });

  test("publish action includes idempotency key and confirm", () async {
    Map<String, dynamic>? body;
    final client = MockClient((request) async {
      body = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(jsonEncode({"ok": true}), 200);
    });
    final api = HomesteadApi(
      baseUrl: "https://example.test",
      readSession: () async => "token",
      readCsrf: () async => "csrf",
      onUnauthorized: () async {},
      client: client,
    );
    await api.jobAction(
      publicId: "HC-2026-000001",
      action: "publish_now",
      version: 1,
      confirm: true,
      idempotencyKey: "fixed-key",
    );
    expect(body!["confirm"], isTrue);
    expect(body!["idempotencyKey"], "fixed-key");
    expect(body!["action"], "publish_now");
  });

  test("HomeSummary reads nested counts", () {
    final summary = HomeSummary({
      "counts": {"pendingApproval": 2, "scheduled": 3, "needsReview": 1, "partial": 1},
      "settings": {"paused": false, "dryRun": true},
    });
    expect(summary.pendingApproval, 2);
    expect(summary.scheduled, 3);
    expect(summary.dryRun, isTrue);
  });
}
