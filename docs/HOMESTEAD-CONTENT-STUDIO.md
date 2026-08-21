# HOMESTEAD CONTENT STUDIO

Sistema interno para convertir fotografías reales de trabajos en contenido profesional. **V1 no publica en redes sociales.**

## Arquitectura

```text
Telegram (@HomesteadServicesNotifyBot)
   /publicar + fotos + botones
        ↓
n8n  HOMESTEAD — Content Studio
   webhook POST /webhook/homestead-content-studio
        ↓
Homestead  POST /api/internal/content/telegram-update
        ↓
SQLite + /app/data/content/...
OpenAI (análisis/copy/mejora) + sharp (crop, watermark)
        ↓
Telegram preview → aprobar / regenerar / rechazar
```

El flujo de solicitudes **no se mezcla**:

`HOMESTEAD — Nueva solicitud → Telegram` sigue usando `POST /webhook/homestead-service-request` y Bot API de salida.

El bot no tenía webhook de Telegram. Content Studio registra **un** webhook de Telegram hacia n8n Content Studio. Las notificaciones de solicitudes siguen siendo HTTP de salida y no dependen de ese webhook.

## Comandos

- `/publicar` — inicia `HC-YYYY-NNNNNN` (solo chat/user allowlist)
- Fotos JPEG/PNG/WebP (máx. 8, 8 MB)
- Nota opcional de texto
- `✨ PROCESAR` — una operación coordinada (no procesa al recibir cada foto)
- `✅ APROBAR` — `READY_FOR_REVIEW → APPROVED` (no publica)
- `🔄 REGENERAR` — nueva versión visual+copy; conserva la anterior
- `✏️ NUEVO COPY` — nueva versión de texto; reutiliza fotos branded
- `🖼️ REPROCESAR IMAGEN` — nueva versión visual
- `❌ RECHAZAR` — pide confirmación; originales se conservan

## Almacenamiento

Volumen: `/opt/apps/homestead/data/content/YYYY/MM/HC-…/`

- `originals/` inmutables + SHA-256
- `enhanced/`
- `branded/` (4:5 feed y 1:1 square, marca de agua con `public/images/homesteadservices.png`)
- `published/` reservado

## SQLite

Tablas: `content_jobs`, `content_assets`, `content_versions`, `content_telegram_updates`, `content_usage`, `content_counters`.

Misma DB que solicitudes. No se borran solicitudes ni fotos HS-*.

## Workflows n8n

| Nombre | Función |
| --- | --- |
| HOMESTEAD — Nueva solicitud → Telegram | Notificaciones de solicitudes |
| HOMESTEAD — Content Studio | Inbound Telegram → Homestead |

## AI

- Texto: `OPENAI_TEXT_MODEL` (default `gpt-4o`)
- Imagen: `OPENAI_IMAGE_MODEL` (default `gpt-image-1`)
- Si el edit de imagen falla: mejora determinista con `sharp` (iluminación/color). Los originales no se tocan.

## Secretos (nombres)

Homestead `.env` (VPS, nunca Git):

```text
OPENAI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS
CONTENT_STUDIO_ENABLED
N8N_HOMESTEAD_WEBHOOK_SECRET
```

n8n Variables: `TELEGRAM_BOT_TOKEN`, `HOMESTEAD_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `HOMESTEAD_TELEGRAM_CHAT_ID`.

## Desactivar Content Studio sin apagar solicitudes

`CONTENT_STUDIO_ENABLED=false` y recrear `homestead_web`.

O desactivar solo el workflow `HOMESTEAD — Content Studio` y dejar el de solicitudes activo.

## Backups / rollback

Pre-implementación:

- Git tag `pre-content-studio-v1-20260820-1916` (SHA `64b6f8c`)
- `/opt/backups/pre-homestead-content-studio-20260820-191833/`

Rollback Homestead: checkout de ese tag, rebuild `homestead_web`, **no** borrar el volumen `data`.

Rollback n8n: restaurar `n8n.dump` de ese backup y/o reimportar `n8n/homestead-n8n-telegram-workflow.json`. No hace falta borrar Content Studio tables para que las solicitudes vuelvan a funcionar.

## Meta (futuro)

Estados reservados: `PUBLISHED`. No hay credenciales Meta. Aprobar **no** publica.

## Troubleshooting

- `/publicar` no responde: allowlist, workflow Content Studio activo, webhook de Telegram apuntando a `https://n8n.autonomousflow.lat/webhook/homestead-content-studio`.
- Solicitudes dejaron de llegar a Telegram: verificar que el workflow de solicitudes siga **active** y su webhook `homestead-service-request` exista. Content Studio no debe usar esa ruta.
- OpenAI falla: originales intactos, botón Reintentar, status `FAILED`.
