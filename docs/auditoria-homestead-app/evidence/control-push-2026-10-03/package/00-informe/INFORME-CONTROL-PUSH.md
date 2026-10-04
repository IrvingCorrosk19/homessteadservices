# Homestead Control Push — informe 2026-10-03

## Destinatario

| Clave | Valor |
| --- | --- |
| `CONTROL_PUSH_SUBJECT_ID` | `op:2` |
| Origen | `telegram_operators` id=2 role=ADMIN display_name=`Irving CORRO` |
| No usado | OWNER id=1 `Owner` (primer admin — excluido a propósito) |
| Aliases assignee | `Irving CORRO`, `Irvin`, `op:2` |
| Anticipación | `30m` |
| Zona | `America/Panama` |

## Commit / versiones

| Ítem | Valor |
| --- | --- |
| Commit | `32a36a2f8cfa83810430357fb3c4cf7f3256f05e` |
| Hotfix webhook URL | follow-up en árbol (no reutilizar webhook Telegram) |
| Backend desplegado | `32a36a2` · image `sha256:cd5d05c8…5124c` · `DEPLOY_OK` |
| Backup | `/opt/backups/homestead-pre-control-20261003-193144` |
| Rollback image | `homestead-homestead_web:pre-control-20261003-193144` |
| APK instalado A06 | `1.2.0` / versionCode `15` |
| APK SHA-256 | `CFDB9F1A6B616107697524F88A2C69C6C806CF1A85C37662407E81C4A7DC1382` |
| Certificado SHA-256 | `f6fcdc3e0ffb4980be253d9c110fdd2c207c40370ec117f09abef2b4838220c5` (Android Debug) |
| URL efectiva | `https://homestead.lat` |

## Eventos implementados

1. **Nueva solicitud** (`!is_test`) → outbox `control.push.new_request` → n8n FCM.
2. **Recordatorio cita** asignada al sujeto, 30 min antes (o inmediato si queda <30m y aún no empieza); invalida al reprogramar/cambiar responsable/cancelar/completar.

Textos sin PII en pantalla bloqueada.

## Matriz

| Caso | Resultado |
| --- | --- |
| Pruebas aisladas `control:test:push` | **PASS** |
| Dedup outbox / claim recordatorio | **PASS** |
| Permiso Android (diálogo → concedido) | **PASS** |
| Más muestra estado permiso/servidor/versión | **PASS** |
| Regresión lista→detalle→agenda | **PASS** |
| Push primer plano | **NO PROBADO** (Firebase placeholder) |
| Push segundo plano | **NO PROBADO** |
| Push cerrada | **NO PROBADO** |
| Deep link post-login | **NO PROBADO** (requiere FCM real) |
| Meta / cola / Telegram clientes | **sin cambios** |

## Bloqueo externo indispensable

Falta proyecto Firebase real para `lat.homestead.control`:

1. `google-services.json` real (reemplazar placeholder).
2. Service account FCM en n8n + var `FCM_PROJECT_ID`.
3. Importar/activar workflow `n8n/homestead-n8n-control-push.json`.
4. Set `N8N_CONTROL_PUSH_WEBHOOK_URL` en VPS (URL del webhook; **no** el de Telegram).

Evidencia del bloqueo en dispositivo:  
`register_failed: Please set a valid API key` (placeholder google-services).

## Archivos clave

- `src/lib/control-push.ts`
- `src/app/api/admin/control/push/device/route.ts`
- `n8n/homestead-n8n-control-push.json`
- `apps/homestead_control_mobile/lib/push/push_service.dart`
- `scripts/control-push-behavior.mjs`
