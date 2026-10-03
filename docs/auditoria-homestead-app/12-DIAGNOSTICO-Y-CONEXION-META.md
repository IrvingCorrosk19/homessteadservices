# 12 — Diagnóstico Meta y recorrido n8n

Fecha: 2026-10-02, noche, America/Panama. Lectura del VPS y de Postgres de n8n. No se ejecutó ningún workflow, no se activó ningún flujo inactivo y no se cambió el webhook de Telegram.

## Dónde están las credenciales

| Lugar | Qué hay | Qué no hay |
| --- | --- | --- |
| `/opt/apps/homestead/deploy/vps/.env` | `META_PAGE_ACCESS_TOKEN` (una sola copia), `FACEBOOK_PAGE_ID` `1390930010760052`, `INSTAGRAM_ACCOUNT_ID` `17841418928294546`, `META_APP_ID` `1800317640994615`, `META_GRAPH_VERSION` `v22.0` | `META_ACCESS_TOKEN`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `META_PAGE_ID`, `META_APP_SECRET` |
| Contenedor `homestead_web` | El token, la Página, Instagram y `v22.0` coinciden con el archivo. `CONTENT_DRY_RUN=false`, `CONTENT_MODE=ASSISTED`. `CONTENT_PUBLISH_ENABLED=true` llega por el valor por defecto del compose, porque esa clave no está en el archivo | `META_APP_ID` y `META_APP_SECRET` no entran al contenedor. El publicador no los lee |
| Contenedor `n8n_n8n` | Ninguna variable Meta, Facebook, Instagram ni de Página | No guarda el token de acceso a Meta |
| Variables de n8n | `HOMESTEAD_WEBHOOK_SECRET`, `HOMESTEAD_TELEGRAM_CHAT_ID` | El secreto del webhook autentica n8n contra Homestead. No es el token de Meta |
| Nodos de Homestead | Cabecera `X-Homestead-Webhook-Secret` tomada de `$vars.HOMESTEAD_WEBHOOK_SECRET` | Sin credencial de nodo, sin `access_token`, sin `META_PAGE_ACCESS_TOKEN`, sin `graph.facebook.com` ni `graph.instagram.com` |

El token del archivo y el del contenedor tienen la misma longitud (206) y el mismo resumen. No hay espacios ni comillas dentro del valor.

Copias comparadas solo por igualdad, sin abrir el secreto:

| Copia | Token, Página, Instagram, app id, versión Graph |
| --- | --- |
| `homestead-pre-content-meta-20260922-130657` | IGUAL. `CONTENT_DRY_RUN` distinto |
| `homestead-pre-content-meta-20260922-131221` | IGUAL. `CONTENT_DRY_RUN` distinto |
| `homestead-pre-content-meta-20260922-132044` | IGUAL. `CONTENT_DRY_RUN` distinto |
| `homestead-pre-photo-batch-20260922-135846` | IGUAL, incluido `CONTENT_DRY_RUN` |
| `homestead-pre-control-20261002-212845` | IGUAL, incluido `CONTENT_DRY_RUN` |

El despliegue de Control no sustituyó el token ni los identificadores. El script aparta el `.env` y lo devuelve. La copia previa al despliegue es idéntica a la actual en esas claves.

## Quién llama a Meta

El backend Homestead. n8n no llama a Graph.

En `workflow_entity` y en `workflow_history` el texto `graph.facebook.com` y `graph.instagram.com` aparece 0 veces. Tampoco aparece la palabra `facebook` ni `instagram` en ningún workflow guardado, activo, inactivo o histórico. Los cinco workflows Homestead activos usan solo `scheduleTrigger`, `webhook`, `httpRequest`, `code`, `if` y `respondToWebhook`.

Recorrido real:

1. Content Studio recibe el webhook de Telegram y hace `POST https://homestead.lat/api/internal/content/telegram-update` con el secreto interno.
2. Esa ruta llama a `handleTelegramUpdate`. Las acciones `now` y `live` llaman a `publishJob`.
3. Content Scheduler, cada 10 minutos, hace `POST https://homestead.lat/api/internal/content/scheduler-tick` con el mismo secreto. El tick llama a `publishJob(..., "scheduler")`. El nodo de alerta dice que n8n no publica en Meta.
4. `publishJob` en `src/lib/content-publish.ts` usa `src/lib/content-meta.ts`: `https://graph.facebook.com/v22.0/...` con `META_PAGE_ACCESS_TOKEN`. Facebook: `POST /{página}/photos`. Instagram: `POST /{ig}/media` y luego `POST /{ig}/media_publish`.

No hay combinación: n8n despierta a Homestead; solo Homestead habla con Meta.

## Qué flujo publicó de verdad

Hay 12 filas `PUBLISHED` con `dry_run=0`, id externo y enlace presentes. Son las seis piezas en Facebook e Instagram:

| Pieza | Evento | Instagram | Facebook |
| --- | --- | --- | --- |
| HC-2026-000024 | `live:live` | 2026-09-22T13:22:49Z | 2026-09-22T13:22:58Z |
| HC-2026-000018 | `now:live` | 2026-09-22T13:35:23Z | 2026-09-22T13:35:29Z |
| HC-2026-000038 | `now:live` | 2026-09-22T15:29:42Z | 2026-09-22T15:29:51Z |
| HC-2026-000040 | `now:live` | 2026-09-22T15:52:08Z | 2026-09-22T15:52:15Z |
| HC-2026-000042 | `now:live` | 2026-09-22T22:33:34Z | 2026-09-22T22:33:39Z |
| HC-2026-000043 | `now:live` | 2026-09-22T22:34:27Z | 2026-09-22T22:34:31Z |

`now` y `live` salen de `content-handler.ts` (botones de Telegram). El scheduler escribe `scheduler`. Esas seis no las publicó el cron. Las publicó el backend cuando el operador confirmó en Telegram, después de que n8n reenvió el update.

Ejecuciones guardadas en n8n: Content Scheduler 978 `success`; Marketing Analytics Collector 13; Weekly Marketing Report 1. Content Studio no tiene filas en `execution_entity`. Eso no cambia el destino de sus nodos: la URL viva sigue siendo `telegram-update`, no Graph.

El token de esas publicaciones es el mismo que está cargado ahora. Ya estaba en el `.env` de las 13:06 del 22 de septiembre, antes de la primera publicación real.

## Diferencia con Control

Control no tiene otro publicador, otro token, otra Página ni otro Instagram. `control-service.ts` llama a `publishJob(publicId, "now")`, la misma función y las mismas variables que el botón de Telegram.

La diferencia es la puerta de entrada. Telegram entra por n8n y `telegram-update`. Control entra por la sesión de `/admin` y llama al backend directo. Los dos terminan en Graph con `META_PAGE_ACCESS_TOKEN`.

HC-2026-000054, confirmada en Control el 2026-10-03T02:54:35Z, llegó a Graph (`now:live`) y Meta rechazó Facebook e Instagram. No hay id externo ni enlace. El estudio sigue activo (`paused=0`, `dry_run=0` en SQLite).

## Lectura actual de Graph

Con el token del contenedor, sin imprimirlo:

| Llamada | Resultado |
| --- | --- |
| `GET /me?fields=id,name` | HTTP 400, código 190, subcódigo ausente, `OAuthException` |
| `GET /1390930010760052?fields=id,name,instagram_business_account` | Igual |
| `GET /17841418928294546?fields=id,username` | Igual |

El mensaje pide alguno de `pages_read_engagement`, `pages_manage_metadata`, `pages_read_user_content`, `pages_manage_ads`, `pages_show_list` o `pages_messaging`. El código 190 es de token OAuth inválido, vencido o revocado. Sin subcódigo no se distingue cuál de esos tres. `debug_token` queda NO PROBADO: `META_APP_SECRET` no está en el `.env` ni en el contenedor, y no se inventó.

Tipo de token, caducidad y permisos concedidos: NO PROBADO. Página e Instagram configurados: presentes y sin cambio desde las publicaciones reales. Lectura de Página e Instagram hoy: FAIL.

## Qué no se cambió

No se reemplazó el token. No se restauró un `.env` completo. No se usó `set-meta-page-token.sh`: además de escribir el token, fuerza `CONTENT_DRY_RUN=true` y recrea el contenedor. No se pausó el estudio. No se reintentó ninguna pieza.

Piezas `SCHEDULED`, todavía futuras: HC-2026-000029 (2026-10-05), HC-2026-000030 (2026-10-07), HC-2026-000031 (2026-10-09), HC-2026-000032 (2026-10-12), HC-2026-000033 (2026-10-14). Ninguna está vencida.

## Cambio mínimo

No hay una credencial distinta en n8n que se pueda volver a usar. La integración que ya funcionó es la del backend, y Control ya la usa.

El único valor que Meta rechaza es `META_PAGE_ACCESS_TOKEN`. Página, Instagram, app id y versión Graph siguen siendo los de las publicaciones del 22 de septiembre. El cambio mínimo es sustituir solo ese token por un token de Página vigente de la app `1800317640994615`, de la Página `1390930010760052` y de la cuenta de Instagram `17841418928294546`, y recrear únicamente `homestead_web` para que el proceso lo cargue.

Eso exige una persona con acceso a esa app y a esa Página. No hace falta crear otra app, otra Página ni otro flujo de n8n. No pegar el token en el chat. No usar `set-meta-page-token.sh` mientras su efecto de dejar `CONTENT_DRY_RUN=true` no esté aceptado. Antes de cargar un token nuevo, las cinco piezas programadas de arriba siguen pendientes: un token válido con el estudio activo y `CONTENT_DRY_RUN=false` las publicaría al llegar su horario, no ahora.
