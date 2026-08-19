# HOMESTEAD SERVICES — n8n + Telegram

Notificaciones internas de solicitudes. El cliente nunca ve errores de n8n ni Telegram.

## Arquitectura

```text
Cliente
  → homestead.lat
  → Formulario Solicitar servicio
  → POST /api/contact
  → validación
  → SQLite (folio HS-YYYY-NNNNNN + fotos)
  → email existente
  → webhook server-to-server → n8n
  → Telegram (cuando hay credenciales)
```

El navegador no llama a n8n ni a Telegram. Los secretos no van al frontend.

## Flujo Homestead

- Formulario: `src/components/contact/RequestForm.tsx`
- Endpoint: `src/app/api/contact/route.ts`
- Persistencia: `src/lib/service-requests.ts` (SQLite en `DATA_DIR`)
- Folio público: `HS-YYYY-NNNNNN` (año Panamá, contador transaccional)
- Email: `src/lib/mail.ts` + `src/lib/contact-email.ts`
- Webhook: `src/lib/n8n.ts` (timeout 25s, fire-and-forget tras persistir, no bloquea ni falla la respuesta del cliente)
- Mini CRM: `/admin/solicitudes` (sesión httpOnly + `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`)
- Fotos: disco `DATA_DIR/photos/HS-YYYY-NNNNNN/photo-01.jpg` + URL firmada HMAC (`/api/media/request-photos`) para n8n/Telegram. El panel sirve fotos por `/api/admin/.../photos/` con sesión. JPEG/PNG/WebP, máximo 6, 5 MB, magic bytes.

Telegram usa **Bot API oficial** (`sendMessage`, `sendPhoto`, `sendMediaGroup`). n8n llama a `api.telegram.org` en cuanto llega el webhook. No depende de que Telegram Desktop, Web o el móvil estén abiertos. Si la API responde `ok` y el teléfono no muestra push, es configuración de notificaciones del dispositivo.

Botones Telegram:

- `📧 RESPONDER` → `https://homestead.lat/admin/solicitudes/HS-YYYY-NNNNNN`
- `💬 WHATSAPP` → `wa.me` con mensaje preparado (no se envía solo)

No existe panel administrativo. El botón **Ver solicitud** no se incluye. El botón **Contactar** abre WhatsApp (`wa.me`) cuando el teléfono es válido.

El formulario no pide barrio. No se inventa una ubicación. Se envían tipo de propiedad y el mensaje.

## Workflow n8n

- Nombre: `HOMESTEAD — Nueva solicitud → Telegram`
- Instancia: `https://n8n.autonomousflow.lat`
- Webhook de producción: `POST https://n8n.autonomousflow.lat/webhook/homestead-service-request`
- Archivo importable: `n8n/homestead-n8n-telegram-workflow.json`
- Versión de n8n en VPS: `2.3.6`

## Variables Homestead

En `/opt/apps/homestead/deploy/vps/.env` (nunca en Git):

```text
N8N_HOMESTEAD_WEBHOOK_URL=https://n8n.autonomousflow.lat/webhook/homestead-service-request
N8N_HOMESTEAD_WEBHOOK_SECRET=
DATA_DIR=/app/data
```

Para desactivar notificaciones n8n/Telegram sin tocar código: vaciar `N8N_HOMESTEAD_WEBHOOK_URL` y recrear `homestead_web`.

## Variables n8n

Esta instalación de n8n 2.3.6 bloquea `$env` en nodos (Code e IF: `access to env vars denied`). También bloquea `require('crypto')` en Code.

Por eso n8n autentica con **Variables de n8n** (`$vars`), no con el `.env` del contenedor.

Ya configurada en n8n:

- `HOMESTEAD_WEBHOOK_SECRET` — mismo valor que `N8N_HOMESTEAD_WEBHOOK_SECRET` de Homestead

Pendientes de introducir en **n8n → Settings → Variables** (no en Git, no en nodos Code):

```text
TELEGRAM_BOT_TOKEN              # configurado en n8n (no está en Git)
HOMESTEAD_TELEGRAM_CHAT_ID      # configurado; el administrador debe abrir el bot y enviar /start
```

Bot: `t.me/HomesteadServicesNotifyBot`

El administrador ya inició el bot. Las solicitudes nuevas llegan a ese chat privado.

## Seguridad del webhook

Homestead firma el cuerpo:

```text
HMAC_SHA256(secret, "{timestamp}.{canonicalJson(payload)}")
```

Headers:

```text
X-Homestead-Timestamp
X-Homestead-Signature: sha256=<hex>
X-Homestead-Webhook-Secret: <mismo secreto>
X-Homestead-Idempotency-Key: service_request.created:HS-2026-000001
```

n8n valida:

1. secreto compartido (`X-Homestead-Webhook-Secret` === `$vars.HOMESTEAD_WEBHOOK_SECRET`)
2. timestamp ±300 segundos (anti-replay)
3. schema del payload (`service_request.created` + folio `HS-YYYY-NNNNNN`)

HMAC completo en n8n no es práctico aquí: el task runner impide `crypto` y el nodo Crypto no conservó el payload. Homestead **sí genera HMAC** para auditoría y clientes futuros.

Sin secreto válido: HTTP 401 y no hay Telegram.

## Idempotencia

Clave: `service_request.created:{requestId}`

Guardada en static data del workflow (7 días). Un reintento responde `{ duplicate: true }` y no envía otro Telegram.

## Payload

Campos reales del formulario (no se inventan otros):

```json
{
  "event": "service_request.created",
  "requestId": "HS-2026-000001",
  "createdAt": "2026-08-19T03:00:00.000Z",
  "customer": { "name": "", "phone": "", "email": "" },
  "service": { "slug": "plumbing", "type": "Plomería", "property": "Casa", "description": "" },
  "photos": { "count": 0, "names": [] },
  "actions": { "contactWhatsApp": "https://wa.me/50760000000" }
}
```

## Activar / desactivar Telegram

- **Apagar Telegram y n8n:** vaciar `N8N_HOMESTEAD_WEBHOOK_URL` en Homestead y recrear `homestead_web`.
- **Apagar solo el workflow:** desactivarlo en n8n. Homestead guarda la solicitud, envía email y registra `N8nNotificationFailed`.
- **Workflow activo sin token:** n8n responde 200, no envía Telegram.
- **Encender Telegram:** crear `TELEGRAM_BOT_TOKEN` y `HOMESTEAD_TELEGRAM_CHAT_ID` en Variables de n8n. No hace falta redeploy de Homestead.

## Rollback

1. Quitar `N8N_HOMESTEAD_WEBHOOK_URL` del `.env` de Homestead y recrear `homestead_web`.
2. Desactivar o borrar solo el workflow `HOMESTEAD — Nueva solicitud → Telegram`.
3. No toca workflows BrokerPro ni el gateway Telegram existente.

La base SQLite queda en `/opt/apps/homestead/data`. No se borra en un rebuild de Docker.

## Logs Homestead

```text
ServiceRequestCreated
EmailNotificationSucceeded
EmailNotificationFailed
N8nNotificationRequested
N8nNotificationSucceeded
N8nNotificationFailed
N8nNotificationSkipped
```

No se registran secretos, tokens ni firmas.

## Importar el workflow

En el VPS, con backup previo de n8n:

```bash
# el JSON debe ir envuelto en un array
n8n import:workflow --input=/tmp/homestead-n8n-import.json
n8n publish:workflow --id=<ID>
# reiniciar solo n8n_n8n para registrar el webhook
```

Script de reemplazo (solo este workflow): `deploy/vps/replace-homestead-n8n.sh`. No toca otros flujos.

## Pruebas ejecutadas en VPS

| Prueba | Resultado |
| --- | --- |
| Formulario + `POST /api/contact` | PASS (`HS-2026-000002`) |
| Persistencia SQLite | PASS |
| Email existente | PASS |
| Webhook n8n autenticado | PASS |
| Webhook sin secreto | PASS (401) |
| Payload malformado | PASS (400) |
| Idempotencia | PASS (segunda llamada `duplicate: true`) |
| n8n inaccesible | PASS (solicitud `HS-2026-000003` guardada, cliente 200, `N8nNotificationFailed`) |
| Telegram live | PASS (`HS-2026-000004`, `message_id` en Telegram Bot API) |
| 0 fotografías | PASS (`HS-2026-000012`, 1 `message_id`, ~1 s) |
| 1 fotografía `sendPhoto` | PASS (`HS-2026-000013`, 2 `message_id`, URL firmada servida) |
| 3 fotografías `sendMediaGroup` | PASS (`HS-2026-000014`, 4 `message_id`, 3 GET firmados) |
| Secretos en Git | 0 |

