# 13 — Homestead Control Flutter Android

Fecha: 2026-10-03 America/Panama.

## Entrega

| Ítem | Valor |
| --- | --- |
| Carpeta | `apps/homestead_control_mobile` |
| applicationId | `lat.homestead.control` |
| versionName / versionCode | `1.0.0` / `1` |
| Android mínimo | API 24 |
| targetSdk | 36 |
| APK debug instalable | `apps/homestead_control_mobile/dist/homestead-control-1.0.0+1-debug.apk` |
| SHA-256 debug | `26D0EA4545DEA485B737F06BCC5E67A50C801F78EF68A2561A0AF9A80F9090E6` |
| APK release (firma debug) | `apps/homestead_control_mobile/dist/homestead-control-1.0.0+1-release-debugsigned.apk` |
| SHA-256 release-debugsigned | `11C643B963B149FEC2F7988226481B181ACD085312FEAA173F11965797752436` |
| Firma | Debug keystore de Android SDK. **No** es firma de producción |
| Flutter | 3.35.5 / Dart 3.9.2 |
| JDK | Microsoft OpenJDK 17 |

No hay keystore de producción Homestead en el repositorio. El APK “release” está firmado con la clave debug solo para instalación de prueba. No presentar esa firma como release de tienda.

## Instalación breve

1. Copia el APK debug al teléfono o emulador.
2. Permite instalar apps de orígenes desconocidos.
3. Instala `homestead-control-1.0.0+1-debug.apk`.
4. Abre **Homestead Control**.
5. Inicia sesión con la contraseña de administrador del backend desplegado.

La app habla con `https://homestead.lat` por defecto (`--dart-define=API_BASE=...` para otro host).

## Qué es y qué no es

Es una interfaz Flutter nativa (no WebView) sobre las APIs `/api/admin/*`.

Conserva la PWA en `/admin`, SQLite, Telegram, n8n y el publicador compartido del servidor. Facebook/Instagram se publican solo en el backend. El APK no incluye tokens Meta, App Secret, secretos de webhook, OpenAI, Telegram, SMTP ni contraseñas.

## APIs usadas (código contrastado)

### Ya existían

- `POST /api/admin/login`, `POST /api/admin/logout`
- `GET /api/admin/control/session`
- `GET /api/admin/content/home|jobs|jobs/:id|preview|media|studio|batches|campaigns|errors`
- `POST /api/admin/content/jobs/:id/action` (`approve`, `approve_and_schedule`, `reschedule`, `reject`, `publish_now`, `retry_platform`)
- `POST /api/admin/content/intake` (multipart `files`, tope 8)
- `POST /api/admin/content/studio`, `POST /api/admin/content/campaigns/:id/pause`
- `GET/PATCH /api/admin/appointments`, `PATCH /api/admin/service-requests/:id`

### Añadidas o adaptadas para el móvil

| Cambio | Motivo |
| --- | --- |
| Bearer `Authorization` + header `X-Homestead-Client: control-mobile` | Sesión sin depender solo de cookie httpOnly |
| Login móvil devuelve `session` + `csrf` en JSON | Almacenamiento seguro en el dispositivo |
| Middleware acepta Bearer | Edge ya no bloquea al móvil sin cookie |
| `requireAdminSession(request)` en rutas admin | Lee cookie o Bearer |
| CSRF sigue obligatorio en mutaciones (`X-CSRF-Token`) | No se desactivó el CSRF web |
| `GET /api/admin/service-requests` | La lista solo existía en SSR |
| `GET /api/admin/customers` | La lista solo existía en SSR |
| `q` en `GET /api/admin/content/jobs` | Búsqueda por folio desde el cliente |
| Actor `admin-mobile` | Distinguir recibos de idempotencia |

`Origin` ausente (cliente nativo) sigue permitido; un `Origin` de otro host sigue rechazado. Logout revoca la sesión en SQLite.

No se usa `/api/internal/content/publish-live` ni el secreto de webhook desde el móvil.

## Funciones de la app

Implementadas en Flutter:

- Login / logout con `flutter_secure_storage`
- Inicio (resumen + pausa/reanudación del estudio)
- Cola de contenido con filtros y búsqueda
- Detalle: imagen, texto, versión, redes, enlaces FB/IG
- Acciones: aprobar, rechazar, aprobar y programar, reprogramar
- Publicar ahora con diálogo de confirmación + idempotency key
- Reintentar red fallida; bloqueo visible si hay `UNCERTAIN`
- Crear contenido desde galería/cámara, hasta 8 fotos
- Solicitudes (estado), agenda (confirmar/completar/cancelar), clientes
- Lotes, campañas (pausar), centro de fallos
- Estados de carga/vacío/error/sin conexión
- Fechas etiquetadas America/Panama
- Aviso explícito: video/Reels/carrusel no soportados

## Verificación ejecutada

| Prueba | Resultado |
| --- | --- |
| `flutter analyze` | PASS (4 infos, 0 errores) |
| `flutter test` (API mock + login widget) | PASS 6/6 |
| `flutter build apk --debug` | PASS |
| `flutter build apk --release` | PASS (firma debug) |
| Emulador AVD `Homestead_API36` | Creado; quedó `offline` en este host. Instalación/UI en emulador: **NO PROBADO** |
| Teléfono físico | **NO PROBADO** |
| Publicación real / mensajes a clientes / reintentos históricos | **No autorizados** en esta tarea |
| Lectura producción autenticada | Pendiente de desplegar las APIs Bearer/listas |

Las pruebas de escritura/publicación del cliente usan HTTP mockeado. No se presentaron resultados simulados como publicaciones reales.

## Compatibilidad y despliegue

La app **no** está operativa contra producción hasta desplegar el backend con:

1. Auth Bearer + login `session` para `control-mobile`
2. `GET /api/admin/service-requests`
3. `GET /api/admin/customers`
4. `q` en jobs

Cambios locales listos en el repo. Recrear solo `homestead_web` con el commit que los contenga. No hace falta segundo dominio ni tocar n8n/Telegram/Meta.

Contra un backend aislado (`npm run control:dev`) se puede ejercitar login/mutaciones con Graph simulado, sin publicar en Meta.

## Pendientes

- Keystore de producción Homestead y firma release real
- Smoke en emulador/dispositivo cuando el AVD arranque con hardware acceleration
- Despliegue VPS de las APIs móviles
- Prueba de lectura autenticada en `https://homestead.lat` tras el deploy
- Publicación controlada futura (requiere autorización nueva; la de la cola ya se consumió)

## Rama / commit

Ver historial git del commit que incluye esta carpeta y el doc 13.
