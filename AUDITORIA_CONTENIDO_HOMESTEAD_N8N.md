# Auditoría de solo lectura — Homestead Content Studio / n8n / Meta

**Fecha:** 2026-09-21 (America/Panama)  
**Alcance:** generación y publicación de contenido (Instagram, Facebook, Telegram, OpenAI)  
**Cambios realizados:** ninguno en flujos, credenciales, base de datos ni código de producto  
**Instancia n8n inspeccionada:** `https://n8n.autonomousflow.lat` (contenedor `n8n_n8n` + Postgres `n8n_postgres`)  
**App Homestead inspeccionada:** contenedor `homestead_web`, SQLite `/opt/apps/homestead/data/homestead.sqlite`

Leyenda de certeza:

| Marca | Significado |
| --- | --- |
| **VERIFICADO** | Leído en código, export JSON, Postgres n8n, SQLite o `printenv` (solo SET/EMPTY o flags no secretos) |
| **INFERIDO** | Conclusión razonable a partir de arquitectura, no ejecutada como publicación |

No se disparó ninguna publicación. No se llamó a Graph API con tokens (los tokens Meta están vacíos). `getWebhookInfo` de Telegram se usó solo para URL y error, sin listar el token.

---

## Resumen ejecutivo

**Qué tenemos.** Un estudio de contenido que ya funciona por Telegram: el operador envía fotos o pide una campaña en español, Homestead genera copy e imagen (fotos reales o `gpt-image-1`), pone marca de agua, pide aprobación humana y puede simular la publicación (dry-run). n8n no genera el contenido: solo recibe el webhook de Telegram y, cada 10 minutos, llama al programador de Homestead.

**Qué falta.** Facebook no está conectado. Instagram tampoco: no hay token de Página, ni ID de cuenta IG, ni ID de Página en el contenedor. El código de publicación a Instagram **no envía la foto** (`image_url` ausente). Facebook está explícitamente no implementado. No hay videos/reels. El recolector de métricas corre cada 12 h y responde “no configurado”, con `collected: 0`. No hay medición automática de consultas por WhatsApp o homestead.lat.

**Siguiente paso.** No conectar cuentas todavía. Primero decidir una **versión 1 de publicación real** sobre lo existente: mantener aprobación por Telegram + dry-run, corregir la subida de imagen a Graph, añadir Facebook Page Photos, inyectar `INSTAGRAM_ACCOUNT_ID` / `FACEBOOK_PAGE_ID` / token de Página de larga duración, y hacer una prueba controlada de un solo post aprobado. Hasta entonces, nada sale a redes.

---

## 1. Inventario de flujos

`active: false` en los JSON de Git es **artefacto de exportación**. El estado real está en Postgres n8n (**VERIFICADO** 2026-09-21).

### Flujos Homestead en la instancia n8n (activos)

| Nombre | ID n8n | Activo | Disparador | Frecuencia | Finalidad | Ubicación |
| --- | --- | --- | --- | --- | --- | --- |
| HOMESTEAD — Content Studio | `x9PZMUr4NNvvlv8i` | sí | webhook `homestead-content-studio` | bajo demanda (Telegram) | Proxy Telegram → Homestead Content API | Live n8n; export Git `n8n/homestead-n8n-content-studio.json` (el ID del export no coincide; ver nota) |
| HOMESTEAD — Content Scheduler | `nGiCm9Yt3PzPzDP9` | sí | schedule | cada 10 min | POST `scheduler-tick` (cola de contenido + otros motores) | Live + `n8n/homestead-n8n-content-scheduler.json` |
| HOMESTEAD — Marketing Analytics Collector | `ZiQfUIPtEq3RsqVW` | sí | schedule | cada 12 h | POST `analytics-collect` | Live + `n8n/homestead-n8n-analytics-collector.json` |
| HOMESTEAD — Weekly Marketing Report | `aSGBqm6D5SjSsYGL` | sí | schedule | cada 7 días | POST `weekly-report` → Telegram admin | Live + `n8n/homestead-n8n-weekly-report.json` |
| HOMESTEAD — Nueva solicitud → Telegram | `i4t4Bw8JTQB8A2KE` | sí | webhook `homestead-service-request` | bajo demanda (formulario/HS) | **No es Content Studio.** Avisos de solicitudes | Live + `n8n/homestead-n8n-telegram-workflow.json` |

Nota de ID: el backup de 2026-08-22 listaba Content Studio como `l10Rh1i8NDrdkfUa`. Hoy el activo es `x9PZMUr4NNvvlv8i`. El webhook público sigue siendo el mismo path (**VERIFICADO**).

### En Git, no presentes en el inventario live de nombres Homestead

| Nombre | Archivo | Estado live | Notas |
| --- | --- | --- | --- |
| HOMESTEAD — Daily Business Briefing | `n8n/homestead-n8n-daily-briefing.json` | no aparece | Revenue briefing, no Meta |
| HOMESTEAD — Weekly Revenue Report | `n8n/homestead-n8n-weekly-revenue.json` | no aparece | Revenue, no Meta |

### Lógica de contenido **fuera** de n8n (Homestead)

Toda la inteligencia (OpenAI, sharp, aprobación, dry-run, Graph) vive en `src/lib/content-*.ts` y rutas `/api/internal/content/*`. n8n no tiene nodos Facebook, Instagram, OpenAI ni DALL·E.

Webhook Telegram **VERIFICADO:** `https://n8n.autonomousflow.lat/webhook/homestead-content-studio` (`pending_update_count=0`, sin `last_error`).

---

## 2. Recorrido completo de cada flujo

### 2.1 HOMESTEAD — Content Studio (idea/fotos → Homestead)

Disparador: Telegram Bot API entrega updates a n8n.

| Nodo | Tipo | Entrada | Salida / servicio | Si falla |
| --- | --- | --- | --- | --- |
| Webhook | `n8n-nodes-base.webhook` POST `homestead-content-studio` | Update Telegram + header `x-telegram-bot-api-secret-token` | Pasa JSON al IF | Telegram reintenta si no hay HTTP 2xx (**INFERIDO** comportamiento Bot API) |
| ¿Update autorizado? | IF | Secret del header vs `$vars.TELEGRAM_WEBHOOK_SECRET` | true → API Homestead; false → 401 | Rechazo 401, no llega a Homestead **VERIFICADO** en export |
| Homestead Content API | HTTP POST `https://homestead.lat/api/internal/content/telegram-update` | Body del update + `X-Homestead-Webhook-Secret` (`$vars.HOMESTEAD_WEBHOOK_SECRET`) | Respuesta Homestead | `onError: continueErrorOutput` → **Responder 503** (**VERIFICADO**). Telegram puede reintentar |
| Responder | 200 `{ ok: true }` | — | ACK a Telegram | — |
| Responder 401 / 503 | JSON error | — | Telegram no considera el update procesado en 401/503 | **VERIFICADO** en JSON |

A partir de aquí **Homestead** (no n8n) ejecuta `handleTelegramUpdate` en `src/lib/content-handler.ts`:

```text
Telegram (privado, operador autorizado)
  → /publicar + fotos   (modo A: trabajo real)
  → texto NL tipo «Crea una publicidad de cerrajería»  (modo B: AI_CAMPAIGN)
  → «¿Qué podemos publicar?» / /recomendar           (modo C: ideas, sin generar imagen cara)
        ↓
SQLite content_jobs (folio HC-YYYY-NNNNNN)
originals/ inmutables → OpenAI gpt-4o (análisis/copy) y/o gpt-image-1 (campaña)
sharp: crop 4:5 y 1:1 + watermark homesteadservices.png
        ↓
Preview en Telegram + botones versionados
✅ APROBAR | PUBLICAR AHORA | APROBAR HORARIO | cambiar copy/imagen | descartar
```

**VERIFICADO:** silencio ≠ aprobación; callbacks llevan `:v{n}`; Meta no se llama si `CONTENT_DRY_RUN=true` o faltan tokens.

### 2.2 HOMESTEAD — Content Scheduler

| Nodo | Entrada | Salida | Si falla |
| --- | --- | --- | --- |
| Cada 10 minutos | cron n8n | dispara HTTP | no hay reintento extra en el JSON |
| Homestead scheduler | POST `/api/internal/content/scheduler-tick` + secret | JSON Homestead | `continueOnFail: true` **VERIFICADO** — n8n marca success aunque Homestead falle |

El tick **VERIFICADO** en `src/app/api/internal/content/scheduler-tick/route.ts` hace más que contenido: ops engine, retención, autonomous scan, outbox, recordatorios de leads/citas, y **después** `runContentScheduler()`. Un “success” de n8n **no prueba** que se haya publicado un post.

`runContentScheduler` solo toma jobs `SCHEDULED` con `recommendedPublishAt <= now` y llama `publishJob`. Si `paused` o `MANUAL`, no publica.

### 2.3 Marketing Analytics Collector

POST `/api/internal/content/analytics-collect`. **VERIFICADO:** no llama Graph; si faltan token + IDs, responde `meta_not_configured`, `collected: 0`, `instagram/facebook: NOT AVAILABLE`. n8n `continueOnFail: true`.

Última ejecución **VERIFICADA:** 2026-09-21 12:00 America/Panama, status `success`.

### 2.4 Weekly Marketing Report

POST `/api/internal/content/weekly-report`. Envía texto a Telegram admin: posts publicados, cola, “Alcance: NOT AVAILABLE”, `/lead`. **VERIFICADO** en código. Última ejecución **VERIFICADA:** 2026-09-20 00:00, `success`.

### 2.5 Nueva solicitud → Telegram

Fuera del producto de contenido. Conservado porque comparte el mismo bot. El webhook de Bot API **solo** puede apuntar a una URL: hoy es Content Studio. Las solicitudes usan HTTP **saliente** Homestead → n8n `homestead-service-request` → Telegram sendMessage. **VERIFICADO** en docs + export de solicitudes.

---

## 3. Estado real por función

| Función | Clasificación | Evidencia |
| --- | --- | --- |
| Ideas / “qué publicar” | **Parcial** | Intent `IDEATION` + `/recomendar` (`content-campaign-intent.ts`, handler). No hay calendario editorial visual. Live: 0 eventos de contenido |
| Calendario editorial | **Parcial** | `content_settings`: zona `America/Panama`, ventana 18:00–20:00, máx. 1 post/día, 36 h entre posts, días 1–6. Programación por `recommended_publish_at` + scheduler. No hay UI de calendario de campañas |
| Guiones / textos | **Operativa (código + OpenAI key SET)** | `analyzeAndWriteCopy`, `writeAiCampaignCopy`, `rewriteCopyOnly` → `gpt-4o`. No se verificó una generación live en esta auditoría (0 filas `content_usage`) |
| Imágenes (trabajo real) | **Operativa en código** | Fotos Telegram + enhance OpenAI o `sharp` + watermark. 0 assets en SQLite ahora |
| Imágenes (campaña AI) | **Configurada / poco usada** | `generateCampaignImage` → `https://api.openai.com/v1/images/generations` modelo `gpt-image-1` (no DALL·E 3 por nombre). Key SET |
| Videos / reels | **Inexistente** | Cero coincidencias `video`/`reel`/`mp4` en `src/lib/content*.ts` |
| Revisión por Telegram | **Operativa (orquestación live)** | Webhook Content Studio, 3 ejecuciones success en 14 días (16 y 18 sep). Preview/teclado en `content-process.ts` |
| Aprobación humana | **Operativa en código** | `content.approve`; `approval_required=1`; modo `ASSISTED`. Un job live `HC-2026-000017` quedó `REJECTED` (3 sep), sin assets ni versiones |
| Publicación Instagram | **Configurada sin probar / incompleta** | Función `publishInstagram` existe; tokens IG vacíos; **no pasa `image_url`** (ver §4) |
| Publicación Facebook | **Inexistente (código rechaza)** | `facebook_uses_page_token_unconfigured` hardcodeado |
| Seguimiento de errores | **Parcial** | Telegram “No pude publicar”; `content_publications.error`; n8n Content Studio 503. Scheduler n8n **oculta** fallos HTTP (`continueOnFail`) |
| Métricas / consultas | **Parcial / no atribuye canales** | Collector no lee Graph. `/lead HC-…` manual. WhatsApp y homestead.lat no se ligan al folio de contenido de forma automática |

Flags live **VERIFICADOS:** `CONTENT_STUDIO_ENABLED=true`, `CONTENT_MODE=ASSISTED`, `CONTENT_DRY_RUN=true`.

---

## 4. Conexiones Meta

### Credenciales y variables (nombres only)

| Nombre | Dónde | ¿Configurada? |
| --- | --- | --- |
| `META_PAGE_ACCESS_TOKEN` | env `homestead_web` / `.env.example` / compose | **EMPTY** |
| `META_PAGE_ID` | compose + env contenedor | **EMPTY** (el publicador **no lee** esta variable) |
| `FACEBOOK_PAGE_ID` | código analytics + `publishJob` platforms | **EMPTY**; **no está** en `deploy/vps/docker-compose.yml` |
| `INSTAGRAM_ACCOUNT_ID` | `content-publish.ts`, analytics | **EMPTY**; **no está** en compose |
| n8n credentials store | auditoría 2026-08-22: `credentials_entity` vacía | no reconsultada hoy; Homestead Content usa `$vars`, no credencial Facebook de n8n |
| n8n variables | **VERIFICADO** nombres: `HOMESTEAD_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `HOMESTEAD_TELEGRAM_CHAT_ID` | ninguna variable Meta en n8n |

No hay tipo de token, permisos, vencimiento ni Page ID que informar: **no hay token**.

### Método que usa este proyecto (código)

Objetivo: **Instagram API with Facebook Login** (`graph.facebook.com/v21.0`), token de Página en query/body `access_token`.

`publishInstagram` (**VERIFICADO** `src/lib/content-publish.ts`):

1. `POST /{INSTAGRAM_ACCOUNT_ID}/media` con `caption` + token.  
   `imageBytes` se descarta (`void imageBytes`). **No hay `image_url` ni upload resumable.** Según [documentación oficial de Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing), el contenedor de imagen **requiere** `image_url` (o flujo de vídeo) en un servidor público. Esta implementación **no publicaría una foto real** aunque el token existiera.
2. `POST /{ig}/media_publish` con `creation_id`.

Facebook: no hay `POST /{page-id}/photos` ni `/feed`. El branch Facebook siempre falla con causa fija.

Dry-run: si `content_settings.dry_run=1` **o** `!metaConfigured()`, registra `content_publications` con `dry_run=true` y avisa por Telegram “No salió en Instagram ni Facebook”. Settings live: `dry_run=1`, platforms `instagram,facebook`.

---

## 5. Pruebas y fallos (ejecuciones recientes)

Ventana ~14 días, Postgres n8n **VERIFICADO**. Cero ejecuciones Homestead en estado `error`/`crashed`/`failed`.

| Fecha (America/Panama) | Flujo | Status n8n | Qué demuestra | Qué **no** demuestra |
| --- | --- | --- | --- | --- |
| 2026-09-21 cada 10 min (p. ej. 21:00) | Content Scheduler | success | n8n alcanzó Homestead `scheduler-tick` | Publicación Meta (dry-run + 0 jobs SCHEDULED) |
| 2026-09-21 12:00 y 00:00 | Analytics Collector | success | el tick HTTP respondió | Métricas IG/FB (`collected: 0` por diseño sin token) |
| 2026-09-20 00:00 | Weekly Marketing Report | success | se llamó el reporte | Alcance real (el texto dice NOT AVAILABLE) |
| 2026-09-18 17:20; 2026-09-16 17:11 (×2) | Content Studio | success | Telegram → Homestead ACK | Un post publicado (0 publications) |

SQLite contenido **VERIFICADO:**

| Dato | Valor |
| --- | --- |
| Jobs | 1 (`HC-2026-000017`, `REJECTED`, `COMPLETED_WORK`, creado 2026-09-03) |
| Assets / versions / usage / events | 0 |
| Publications | 0 |

No hay un “nodo Meta” que haya fallado: **la publicación real no se ha ejecutado**. Declarar Instagram o Facebook “funcionando” sería falso.

El scheduler marca success aunque el HTTP de Homestead falle (`continueOnFail: true`): riesgo de **falsos positivos** en n8n.

---

## 6. Brecha vs flujo deseado

Deseado: planificar → pieza visual + texto → revisar marca → aprobar Telegram → programar → publicar IG **y** FB → guardar URL → avisar fallos → medir consultas.

| Etapa deseada | ¿Se puede reutilizar? | Brecha |
| --- | --- | --- |
| Planificar | Ventanas + `recommended_publish_at` + ideas NL | No hay planificador de campaña semanal con piezas concretas; IDEATION no genera el visual hasta que se pida |
| Generar visual + texto | OpenAI + sharp + Mode A/B | No reels; campaña AI es 1024² luego recorte 4:5 |
| Revisar datos y marca | Privacy flags + watermark + copy “no inventar” | Revisión es Telegram, no un desk de marca aparte |
| Aprobar Telegram | Botones versionados | Listo para V1 |
| Programar | Scheduler 10 min | Listo; depende de jobs SCHEDULED |
| Publicar IG + FB | Cascarón `publishJob` + lock + idempotencia `{folio}:{plataforma}:{dry\|live}` | IG sin `image_url`; FB no implementado; token vacío; IDs no están en compose |
| Registrar URL/resultado | `external_post_id` en publications | En dry-run guarda `dry-{folio}-{platform}`, no URL Graph |
| Avisar fallos | Telegram al chat del job | Scheduler n8n no falla a la vista si Homestead cae |
| Medir consultas (DM, WhatsApp, web) | `/lead` manual + weekly “NOT AVAILABLE” | No hay insights Graph, ni click WhatsApp, ni `hs_ref` automático desde el post |

---

## 7. Conexión de Facebook e Instagram

Documentación oficial vigente usada: [Content Publishing (Instagram Platform)](https://developers.facebook.com/docs/instagram-platform/content-publishing) e [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/). El código apunta a **Facebook Login for Business** + token de Página (`graph.facebook.com`), no a `graph.instagram.com` / Instagram Login.

### Lo que debes hacer tú (cuentas, sin compartir contraseñas)

1. Convertir Instagram a **cuenta profesional** (Business o Creator) y **vincularla a una Facebook Page** de Homestead.  
2. Crear o usar una **app** en [developers.facebook.com](https://developers.facebook.com/) (tipo Business).  
3. Facebook Login for Business y permisos de publicación (nombres oficiales actuales para esta vía): `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`; para publicar en la Page: `pages_manage_posts` / `pages_show_list` (App Review si sale de modo desarrollo). El usuario del token debe poder **CREATE_CONTENT** o **MANAGE** en la Page.  
4. Generar un **Page access token** de larga duración y anotar (para pegar luego en el servidor, no en este chat):  
   - ID de la Page (`FACEBOOK_PAGE_ID`)  
   - IG User ID profesional (`INSTAGRAM_ACCOUNT_ID`, no el @username)  
5. Si la Page exige Page Publishing Authorization, completarla en Meta.  
6. En modo desarrollo, solo roles de la app verán el post; para clientes reales hace falta App Review + live.

### Lo que se puede automatizar después (ingeniería, no es ahora)

- Guardar token e IDs en `.env` del VPS e inyectarlos en compose (`INSTAGRAM_ACCOUNT_ID` y `FACEBOOK_PAGE_ID` hoy **faltan** en `docker-compose.yml`).  
- Exponer el JPEG branded en una URL HTTPS que Meta pueda descargar (`image_url`), p. ej. ruta firmada temporal en homestead.lat.  
- Completar `publishInstagram` y añadir `POST /{page-id}/photos` (o `/feed` con `url`) para Facebook.  
- Renovación de token: un Page token de larga duración suele durar ~60 días si parte de un user token; hay que calendarizar rotación. **No hay renovación automática hoy.**  
- Webhooks de insights (opcional) para el collector.

n8n **no** debe ser el publicador en V1: ya hay un publicador en Homestead. Conectar “Facebook node” en n8n duplicaría el camino y el riesgo de dobles posts.

No se piden contraseñas. Cuando toque implementar, el operador pega el token en el servidor o en un canal seguro, no en el repositorio.

---

## 8. Plan de implementación (cuando lo apruebes)

Prioridad: **una pieza aprobada, un post, sin duplicados, dry-run primero, luego un live controlado.**

| Paso | Qué tocar | Dependencia | Esfuerzo | Prueba E2E |
| --- | --- | --- | --- | --- |
| 0. Congelar política | Seguir `ASSISTED` + `CONTENT_DRY_RUN=true` | — | 0 | Confirmar Telegram “DRY RUN — no salió” |
| 1. URL pública de imagen | Nueva ruta interna firmada para `branded` feed JPEG; **no** abrir todo `/data/content` | Auth HMAC + caducidad | 0.5–1 d | Meta curl de `image_url` (sandbox) |
| 2. Arreglar IG publish | `src/lib/content-publish.ts`: enviar `image_url` + caption; esperar contenedor `FINISHED` si aplica | Paso 1 + token de prueba | 0.5 d | Dry-run sigue; live solo con flag |
| 3. Implementar Facebook | `POST /{FACEBOOK_PAGE_ID}/photos` con `url` + `caption`; no hardcode de error | Mismo `image_url` | 0.5 d | Idempotency key por plataforma |
| 4. Compose / env | Añadir `INSTAGRAM_ACCOUNT_ID`, `FACEBOOK_PAGE_ID`; mapear `META_PAGE_ID` o unificar nombre | Decisión de naming | 0.2 d | `printenv` SET sin imprimir token |
| 5. Token live | Tú creas Page token; se carga en VPS `.env`; recreate `homestead_web` | Pasos 1–4 | 0.2 d | `GET /me?fields=id,name` y `GET /{ig-id}?fields=id,username` (lectura) |
| 6. Un post canario | Un `HC-…` aprobado, `PUBLICAR AHORA`, `DRY_RUN=false` **solo ese entorno** | Aprobación humana | 0.3 d | `content_publications` PUBLISHED + IDs Graph + Telegram “Publicado”; no segundo post (lock + idempotency) |
| 7. Errores visibles | Scheduler: no tragar 5xx (`continueOnFail` false o alerta si `ok:false`) | n8n JSON scheduler | 0.2 d | Forzar 401 y ver error en n8n |
| 8. Métricas V1 | Collector: insights del `external_post_id` si Graph los da; si no, UNKNOWN | Token + permisos insights | 0.5–1 d | No rellenar ceros |
| 9. Reels / atribución WhatsApp-web | Fuera de V1 | — | más tarde | — |

**No tocar** en V1: workflow de solicitudes, webhook Telegram path, BrokerPro inactivo, `9TG_GATEWAY_V1`.

Estimación V1 (pasos 1–7): **2–4 días** de ingeniería + tu tiempo en Meta Business/App Review.

---

## Tabla de evidencia

| Conclusión | Evidencia |
| --- | --- |
| n8n Content Studio activo, webhook Telegram correcto | Postgres `workflow_entity` id `x9PZMUr4NNvvlv8i` active=t; `getWebhookInfo.url` = `https://n8n.autonomousflow.lat/webhook/homestead-content-studio` |
| n8n no publica en Meta | Export `n8n/homestead-n8n-content-studio.json`: 6 nodos, solo webhook/IF/HTTP Homestead |
| Scheduler cada 10 min live | 982 success / 14 días; última 2026-09-21 21:00 |
| OpenAI configurado | `OPENAI_API_KEY=SET`, modelos `gpt-4o` / `gpt-image-1` |
| Meta no conectado | `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `FACEBOOK_PAGE_ID`, `INSTAGRAM_ACCOUNT_ID` = EMPTY |
| Dry-run y aprobación forzados | `CONTENT_DRY_RUN=true`, `CONTENT_MODE=ASSISTED`; SQLite `dry_run=1`, `approval_required=1` |
| IG no sube la foto | `publishInstagram` + `void imageBytes` en `src/lib/content-publish.ts` |
| FB no implementado | `cause: "facebook_uses_page_token_unconfigured"` misma función |
| Compose no inyecta IDs de IG/Page que usa el código | `deploy/vps/docker-compose.yml` solo `META_PAGE_ACCESS_TOKEN` y `META_PAGE_ID` |
| Cero publicaciones reales | `content_publications` COUNT 0 |
| Un intento de job, rechazado | `HC-2026-000017` REJECTED, 0 assets |
| Analytics no miden redes | `analytics-collect/route.ts` `collected: 0`, `meta_not_configured` |
| Sin vídeo | grep `src/lib/content*.ts` video/reel/mp4 vacío |
| n8n variables (nombres) | `HOMESTEAD_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `HOMESTEAD_TELEGRAM_CHAT_ID` |
| Docs oficiales IG | `image_url` obligatorio para contenedor de imagen |

---

## Qué no pude ver / qué pediría si hace falta

- Detalle interno de las 3 ejecuciones Content Studio (payload Telegram). En n8n 2.x el JSON de ejecución puede estar pruneado (`EXECUTIONS_DATA_MAX_AGE=168` en auditoría agosto). Si quieres el cuerpo, exporta esas 3 ejecuciones desde la UI (sin pegar tokens).  
- App ID de Meta / estado App Review: no existe en el repo.  
- Permisos reales del token: no hay token que inspeccionar.

---

*Fin de la auditoría de solo lectura. Ningún flujo se activó, ninguna cuenta se conectó, ningún contenido se publicó.*
