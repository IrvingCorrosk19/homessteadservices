# Homestead Control Push — informe (actualizado 2026-10-03 / cierre verificación)

> Este informe **no** debe leerse como “push bloqueado”. La activación FCM quedó documentada en  
> `ACTIVACION-FCM-2026-10-03.md`. Aquí queda la matriz de cierre.

## Destinatario

| Clave | Valor |
| --- | --- |
| `CONTROL_PUSH_SUBJECT_ID` | `op:2` |
| Origen | `telegram_operators` id=2 role=ADMIN display_name=`Irving CORRO` |
| Aliases assignee | `Irving CORRO`, `Irvin`, `op:2` |
| Anticipación | `30m` (sin cambiar en producción; E2E fuerza `fire_at`) |
| Zona | `America/Panama` |

## Estado operativo (actual)

| Ítem | Valor |
| --- | --- |
| FCM | **ACTIVADO** — proyecto `homestead-control-a413c` |
| Webhook | `http://n8n:5678/webhook/homestead-control-push` (red Docker `n8n_net`) |
| Workflow n8n | `nUmjwWOtfUOb4d6h` activo |
| Credential | `hsfcmdbc4693c2964` googleApi (SA fuera del repo: `C:\Homestead-Secrets\…`) |
| APK A06 | `1.2.1` / versionCode `16` · `lat.homestead.control` · URL `https://homestead.lat` |
| Device token | activo `op:2` · hash prefijo `db721756c0e3` |
| TLS `n8n.autonomousflow.lat` | renovado (válido hasta ~2027-01-02); `certbot.timer` activo; Homestead no depende del URL público |

## Eventos

1. **Nueva solicitud** (`!is_test`) → outbox → n8n → FCM.
2. **Recordatorio cita** asignada al sujeto, 30 min antes; cancel/reprogramar invalida pending previo.

## Matriz de cierre

| Caso | Resultado | Evidencia |
| --- | --- | --- |
| Push FG / BG / cerrada (aviso técnico) | **PASS** | `ACTIVACION-FCM` + `phone/06-*` |
| Abrir desde aviso → solicitud real `HS-2026-000123` | **PASS** | `phone/07-deeplink-HS-2026-000123.png`, `08-deeplink-detail-HS123.png` (sin `invalid_id`) |
| Recordatorio E2E calendario→scheduler→outbox→n8n→FCM | **PASS** | `ControlPushN8nAccepted` + outbox `n8n_accepted` · citas `HA-PUSH-E2E-*` |
| Cancel / reprogramar invalida aviso anterior | **PASS** | E2E: `pendingAfterCancel=0`, `cancelledAfterCancel=1`, un solo outbox DELIVERED post-reschedule |
| Tocar recordatorio → Agenda destino | **PASS** | snackbar `Cita HA-PUSH-E2E-*` · `phone/12-reminder-open-*.png` (app en segundo plano) |
| Tocar recordatorio con proceso muerto (`force-stop`) | **NO PROBADO** | FCM accept sí; bandeja Homestead no estable tras `force-stop` en esta sesión |
| Meta / WhatsApp clientes | **sin uso** | — |
| Exclusión fixtures desactivada globalmente | **no** | E2E con `dry_run=1` lead + cleanup |

## Archivos clave

- `src/lib/control-push.ts`
- `n8n/homestead-n8n-control-push.json`
- `apps/homestead_control_mobile/lib/push/push_service.dart`
- `scripts/control-push-behavior.mjs`
- `scripts/control-push-reminder-e2e.mjs`
- `deploy/vps/docker-compose.yml` (`CONTROL_PUSH_*`, `N8N_CONTROL_PUSH_WEBHOOK_URL`, `n8n_net`)
- `ROLLBACK-PUSH.md` · `ACTIVACION-FCM-2026-10-03.md`
