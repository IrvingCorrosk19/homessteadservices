# HOMESTEAD CONTENT STUDIO V3

Evoluciona el Content Studio existente. **No crea otro bot ni otro n8n.**

## Backup

- Git tag: `pre-content-studio-v3-20260823-1727` (SHA `0f4a52e`)
- Workflow n8n: `n8n/homestead-n8n-content-studio.json` (sin cambios de ruta)

## Arquitectura (reutilizada)

```text
Telegram (mismo bot)
   ↓
n8n HOMESTEAD — Content Studio  (/webhook/homestead-content-studio)
   ↓
POST /api/internal/content/telegram-update
   ↓
SQLite content_* + /data/content/...
   ↓
Preview Telegram → aprobación humana → repository
```

## Modos

| Modo | Cómo | Notas |
|------|------|-------|
| **A REAL_WORK** | `/publicar` o álbum de fotos + `✨ PROCESAR` | Fotos reales; enhance sin falsificar obra |
| **B AI_CAMPAIGN** | NL: «Crea una publicidad de cerrajería» | 1 visual + copy; `content_type=AI_CAMPAIGN` |
| **C IDEATION** | «¿Qué podemos publicar?» / `/recomendar` | Ideas textuales primero; **sin** generación cara |

## Aprobación

- Callbacks versionados: `cs:HC-…:approve:v3`
- Botón de V1 no aprueba V3
- Revisar / otra versión → limpia `approved_at`
- Silencio ≠ aprobación
- LLM no decide publicación; `tryApproveContentJob` es determinístico
- Meta: **NOT CONFIGURED** → DRY RUN / `APPROVED` sin publicación real

## Origen

Preview etiquetado:

- Fotos de trabajo real
- Creatividad AI (no es evidencia de trabajo real)

## Research

Web research externo: **NO CONFIGURADO**. No se inventan tendencias.

## Rollback

```bash
git checkout pre-content-studio-v3-20260823-1727
# rebuild homestead_web; no borrar volumen data
```
