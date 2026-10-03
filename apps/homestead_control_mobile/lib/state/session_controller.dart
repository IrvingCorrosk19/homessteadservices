import "package:flutter/foundation.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";

import "../api/api_client.dart";
import "../api/models.dart";
import "../config.dart";

class SessionController extends ChangeNotifier {
  SessionController({
    FlutterSecureStorage? storage,
    HomesteadApi? api,
    this.baseUrl = kApiBase,
  }) : _storage = storage ?? const FlutterSecureStorage() {
    _api = api ??
        HomesteadApi(
          baseUrl: baseUrl,
          readSession: () async => session,
          readCsrf: () async => csrf,
          onUnauthorized: () async {
            await clearLocal();
          },
        );
  }

  final FlutterSecureStorage _storage;
  final String baseUrl;
  late final HomesteadApi _api;

  static const _kSession = "hs_admin_session";
  static const _kCsrf = "hs_admin_csrf";

  String? session;
  String? csrf;
  bool booting = true;
  bool online = true;
  String? lastError;

  HomesteadApi get api => _api;
  bool get isAuthenticated => session != null && session!.isNotEmpty && csrf != null && csrf!.isNotEmpty;

  Future<void> bootstrap() async {
    booting = true;
    notifyListeners();
    session = await _storage.read(key: _kSession);
    csrf = await _storage.read(key: _kCsrf);
    if (isAuthenticated) {
      try {
        final probe = await _api.sessionProbe();
        if (probe["csrf"] is String && (probe["csrf"] as String).isNotEmpty) {
          csrf = probe["csrf"] as String;
          await _storage.write(key: _kCsrf, value: csrf);
        }
      } on ApiException catch (e) {
        if (e.isUnauthorized) {
          await clearLocal();
        } else {
          lastError = e.message;
        }
      } catch (e) {
        lastError = "$e";
      }
    }
    booting = false;
    notifyListeners();
  }

  Future<bool> login(String password) async {
    lastError = null;
    try {
      final result = await _api.login(password);
      session = result.session;
      csrf = result.csrf;
      await _storage.write(key: _kSession, value: session);
      await _storage.write(key: _kCsrf, value: csrf);
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      lastError = e.message == "invalid" ? "Contraseña incorrecta" : e.message;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await _api.logout();
    } finally {
      await clearLocal();
    }
  }

  Future<void> clearLocal() async {
    session = null;
    csrf = null;
    await _storage.delete(key: _kSession);
    await _storage.delete(key: _kCsrf);
    notifyListeners();
  }

  void setOnline(bool value) {
    if (online == value) return;
    online = value;
    notifyListeners();
  }
}
