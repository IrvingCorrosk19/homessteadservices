import "dart:async";

import "package:firebase_core/firebase_core.dart";
import "package:firebase_messaging/firebase_messaging.dart";
import "package:flutter/foundation.dart";
import "package:flutter_local_notifications/flutter_local_notifications.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";

import "../api/api_client.dart";

const String kPushChannelId = "homestead_control_alerts";
const String kPushChannelName = "Alertas Homestead";

/// Deep-link payload from FCM data keys: type, id, route.
class PushDeepLink {
  const PushDeepLink({
    required this.type,
    required this.id,
    this.route,
  });

  final String type;
  final String id;
  final String? route;

  bool get isServiceRequest => type == "service_request";
  bool get isAppointment => type == "appointment";
}

@pragma("vm:entry-point")
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Background/terminated UI relies on the FCM notification payload.
  // Initialize Firebase so the isolate is safe if data-only work is added later.
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
  } catch (_) {
    // Missing / invalid google-services — ignore in background isolate.
  }
}

class PushService extends ChangeNotifier {
  PushService._();
  static final PushService instance = PushService._();

  static const _kStoredToken = "hs_fcm_token";

  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();
  final Set<String> _shownMessageIds = <String>{};

  HomesteadApi? _api;
  bool _initialized = false;
  bool _enabled = false;
  String _status = "not_initialized";
  String _permissionLabel = "desconocido";
  Map<String, dynamic>? _serverPush;
  String? _token;
  PushDeepLink? _pendingNav;
  void Function(PushDeepLink link)? onNavigate;

  bool get enabled => _enabled;
  String get status => _status;
  String get permissionLabel => _permissionLabel;
  Map<String, dynamic>? get serverPush => _serverPush;
  String? get token => _token;
  /// Safe short fingerprint for settings UI / evidence (never the full token).
  String get tokenFingerprint {
    final t = _token;
    if (t == null || t.isEmpty) return "ninguno";
    final tail = t.length <= 6 ? t : t.substring(t.length - 6);
    return "${t.length}c···$tail";
  }
  PushDeepLink? get pendingNavigation => _pendingNav;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      await _setupLocalNotifications();
      final messaging = FirebaseMessaging.instance;
      await _requestPermission(messaging);
      FirebaseMessaging.onMessage.listen(_onForegroundMessage);
      FirebaseMessaging.onMessageOpenedApp.listen(_onOpenedMessage);
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        _storeOrNavigate(parseDeepLink(initial));
      }
      messaging.onTokenRefresh.listen((token) async {
        _token = token;
        await _storage.write(key: _kStoredToken, value: token);
        await _registerWithServer(token);
        notifyListeners();
      });
      _enabled = true;
      _status = "firebase_ready";
    } catch (e) {
      _enabled = false;
      _status = "firebase_unavailable: $e";
      if (kDebugMode) {
        debugPrint("PushService: Firebase unavailable — $e");
      }
    }
    notifyListeners();
  }

  void attachApi(HomesteadApi api) {
    _api = api;
  }

  PushDeepLink? takePendingNavigation() {
    final pending = _pendingNav;
    _pendingNav = null;
    return pending;
  }

  void setPendingNavigation(PushDeepLink? link) {
    _pendingNav = link;
    notifyListeners();
  }

  static PushDeepLink? parseDeepLink(RemoteMessage message) {
    final data = message.data;
    final type = "${data["type"] ?? ""}".trim();
    final id = "${data["id"] ?? ""}".trim();
    final route = "${data["route"] ?? ""}".trim();
    if (type.isEmpty || id.isEmpty) return null;
    if (type != "service_request" && type != "appointment") return null;
    return PushDeepLink(type: type, id: id, route: route.isEmpty ? null : route);
  }

  Future<void> registerAfterAuth() async {
    if (!_enabled) {
      _status = "disabled";
      notifyListeners();
      return;
    }
    try {
      final messaging = FirebaseMessaging.instance;
      await _requestPermission(messaging);
      final token = await messaging.getToken();
      if (token == null || token.isEmpty) {
        _status = "no_token";
        notifyListeners();
        return;
      }
      _token = token;
      await _storage.write(key: _kStoredToken, value: token);
      await _registerWithServer(token);
      await refreshServerStatus();
      _status = "registered";
    } catch (e) {
      _status = "register_failed: $e";
      if (kDebugMode) debugPrint("PushService.registerAfterAuth: $e");
    }
    notifyListeners();
  }

  Future<void> unregisterOnLogout() async {
    final token = _token ?? await _storage.read(key: _kStoredToken);
    final api = _api;
    if (token != null && token.isNotEmpty && api != null) {
      try {
        await api.unregisterPushDevice(token: token);
      } catch (e) {
        if (kDebugMode) debugPrint("PushService.unregisterOnLogout: $e");
      }
    }
    _token = null;
    await _storage.delete(key: _kStoredToken);
    _serverPush = null;
    _status = _enabled ? "unregistered" : _status;
    notifyListeners();
  }

  Future<void> refreshServerStatus() async {
    final api = _api;
    if (api == null) return;
    try {
      final body = await api.pushStatus();
      final push = body["push"];
      if (push is Map) {
        _serverPush = Map<String, dynamic>.from(push);
      } else {
        _serverPush = body;
      }
    } catch (e) {
      if (kDebugMode) debugPrint("PushService.refreshServerStatus: $e");
    }
    notifyListeners();
  }

  Future<void> _registerWithServer(String token) async {
    final api = _api;
    if (api == null) return;
    try {
      final body = await api.registerPushDevice(token: token, platform: "android");
      final push = body["push"];
      if (push is Map) {
        _serverPush = Map<String, dynamic>.from(push);
      }
    } catch (e) {
      _status = "server_register_failed: $e";
      rethrow;
    }
  }

  Future<void> _setupLocalNotifications() async {
    const androidInit = AndroidInitializationSettings("@mipmap/ic_launcher");
    const initSettings = InitializationSettings(android: androidInit);
    await _local.initialize(
      initSettings,
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload == null || payload.isEmpty) return;
        final parts = payload.split("|");
        if (parts.length < 2) return;
        _storeOrNavigate(
          PushDeepLink(
            type: parts[0],
            id: parts[1],
            route: parts.length > 2 && parts[2].isNotEmpty ? parts[2] : null,
          ),
        );
      },
    );
    final android = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(
      const AndroidNotificationChannel(
        kPushChannelId,
        kPushChannelName,
        description: "Alertas operativas de Homestead Control",
        importance: Importance.high,
        playSound: true,
      ),
    );
  }

  Future<void> _requestPermission(FirebaseMessaging messaging) async {
    try {
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      _permissionLabel = switch (settings.authorizationStatus) {
        AuthorizationStatus.authorized => "concedido",
        AuthorizationStatus.provisional => "provisional",
        AuthorizationStatus.denied => "denegado",
        AuthorizationStatus.notDetermined => "no determinado",
      };
      final android = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.requestNotificationsPermission();
    } catch (e) {
      _permissionLabel = "error";
      if (kDebugMode) debugPrint("PushService.permission: $e");
    }
  }

  Future<void> _onForegroundMessage(RemoteMessage message) async {
    final messageId = message.messageId;
    if (messageId != null && messageId.isNotEmpty) {
      if (_shownMessageIds.contains(messageId)) return;
      _shownMessageIds.add(messageId);
      if (_shownMessageIds.length > 200) {
        _shownMessageIds.remove(_shownMessageIds.first);
      }
    }

    final title = message.notification?.title ?? message.data["title"]?.toString() ?? "Homestead";
    final body = message.notification?.body ?? message.data["body"]?.toString() ?? "";
    final link = parseDeepLink(message);
    final payload = link == null ? null : "${link.type}|${link.id}|${link.route ?? ""}";

    await _local.show(
      message.hashCode,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          kPushChannelId,
          kPushChannelName,
          channelDescription: "Alertas operativas de Homestead Control",
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
          icon: "@mipmap/ic_launcher",
        ),
      ),
      payload: payload,
    );
  }

  void _onOpenedMessage(RemoteMessage message) {
    _storeOrNavigate(parseDeepLink(message));
  }

  void _storeOrNavigate(PushDeepLink? link) {
    if (link == null) return;
    final handler = onNavigate;
    if (handler != null) {
      handler(link);
    } else {
      _pendingNav = link;
      notifyListeners();
    }
  }
}
