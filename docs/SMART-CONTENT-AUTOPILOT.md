# Smart Content Autopilot

Evoluciona Homestead Content Studio. **No reemplaza** el flujo de solicitudes ni reconstruye el bot.

## Flujo actual extendido

```text
Telegram (mismo bot) /publicar o álbum
        ↓
n8n  HOMESTEAD — Content Studio   (sin cambios de ruta)
        ↓
Homestead: originales inmutables → IA → watermark → cola
        ↓
Telegram: preview + aprobación
        ↓
APROBAR HORARIO → SCHEDULED
PUBLICAR AHORA  → DRY RUN o Meta
        ↓
n8n  HOMESTEAD — Content Scheduler (cada 10 min)
        ↓
POST /api/internal/content/scheduler-tick
```

Workflow de solicitudes `HOMESTEAD — Nueva solicitud → Telegram` **no se modifica**.

## Modos

- `MANUAL` — no programa solo
- `ASSISTED` — recomendado; tú apruebas (default)
- `AUTO` — no activar (`CONTENT_MODE=AUTO` requiere decisión explícita)

`CONTENT_DRY_RUN=true` (default): simula publicación. Instagram/Facebook **NOT CONFIGURED**.

## Comandos Telegram (allowlist)

`/publicar` `/pendientes` `/programadas` `/publicadas` `/proxima` `/estado` `/pausa` `/reanudar`

## Estados

RECEIVING → PROCESSING → AWAITING_APPROVAL → SCHEDULED → PUBLISHING → PUBLISHED

Alternos: REJECTED, FAILED, NEEDS_REVIEW, CANCELLED. `APPROVED` del Studio V1 sigue existiendo (guardar sin red).

## Zona horaria

`America/Panama`. Ventana inicial 18:00–20:00, máx. 1 post/día, 36 h entre posts (3–5 por semana). Editable en `content_settings`.

## Idempotencia

`content_publications.idempotency_key` = `{folio}:{plataforma}:{dry|live}`

Lock `publish_lock_until` evita doble scheduler.

## Restore

Ver `BACKUP-MANIFEST.md` (checkpoint `pre-smart-content-autopilot-20260820-2024`).
