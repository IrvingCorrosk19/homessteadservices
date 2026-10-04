# Control Push — activación FCM (2026-10-03 / 2026-10-04 UTC)

## Versiones

| Componente | Valor |
| --- | --- |
| APK A06 | `1.2.1` / versionCode `16` |
| APK SHA-256 | `E2C36A1AA31A78DB1984F2797A12C28B66B318BFF82D0C3468F249021F3BC0F8` |
| applicationId | `lat.homestead.control` |
| Firebase project | `homestead-control-a413c` |
| Device | SM-A065M `R8YYA17KR3V` (install -r, datos conservados) |
| Backend env | `CONTROL_PUSH_ENABLED=true`, `CONTROL_PUSH_SUBJECT_ID=op:2`, `N8N_CONTROL_PUSH_WEBHOOK_URL=http://n8n:5678/webhook/homestead-control-push` |
| n8n workflow | `nUmjwWOtfUOb4d6h` **HOMESTEAD — Control Push FCM** active |
| n8n credential | `hsfcmdbc4693c2964` googleApi (Homestead FCM Service Account) |
| `FCM_PROJECT_ID` | `homestead-control-a413c` |

## Cuenta de servicio

- Identificada por `type=service_account`, proyecto `homestead-control-a413c`.
- Movida a `C:\Homestead-Secrets\firebase-service-account.json` (sin sobrescribir ciegamente; destino ya existía y coincidía).
- No rastreda por Git, sin `BEGIN PRIVATE KEY` en historial JSON, sin apariciones en ZIPs de evidencia por nombre.
- `google-services.json` (cliente Android) es archivo distinto; integrado en `android/app/` (gitignored); sin placeholders `YOUR_`.

## Recepción física A06 (no FCM-accept alone)

| Caso | Resultado |
| --- | --- |
| App abierta (FG) | **PASS** — bandeja: `Nueva solicitud` / `Homestead · TECH-FG-A06`, canal `homestead_control_alerts` |
| Segundo plano (HOME) | **PASS** — `TECH-BG-A06` en dumpsys notification |
| Cerrada normal (`am kill`, no force-stop) | **PASS** — `TECH-KILLED-A06` en bandeja |
| Tocar aviso | **PASS** — abre destino solicitud; UI: `TECH-KILLED-A06` + `invalid_id` (fixture inexistente) + `Reintentar`. Evidencia: `phone/06-after-tap-killed.png` |
| Recordatorio (copy cita) | **PASS** — `Recordatorio de cita` / `Homestead · tech rem2 (Panamá)` |

Registro dispositivo `op:2`: activo, `token_hash` prefijo `db721756c0e3`, `token_len=142`, actualizado post-install (sin imprimir token).

## Fixtures aislados

| Caso | Resultado |
| --- | --- |
| `npm run control:test:push` (outbox, dedupe, assign, 30m, reschedule, cancel) | **PASS** |
| VPS tablas push only schedule→reschedule→cancel (`HA-FIXTURE-*`) | **PASS** — sin tocar citas reales ni mensajes a clientes |

Backlog pre-activación: outbox PENDING/PROCESSING = 0; reminders PENDING/CLAIMED = 0.

## Rollback

`00-informe/ROLLBACK-PUSH.md` corregido: rollback normal = código/imagen + DB viva; restaurar backup antiguo encima puede perder datos posteriores.

## Cierre verificación (2026-10-03 noche)

| Caso | Resultado |
| --- | --- |
| Abrir aviso → `HS-2026-000123` (app cerrada) | **PASS** — detalle Juan Alvarez / painting NEW; sin `invalid_id` |
| Recordatorio E2E completo (calendario→…→FCM) | **PASS** — `HA-PUSH-E2E-*`, `n8n_accepted`, FCM message id |
| Cancel/reprogramar invalida pending | **PASS** — métricas E2E |
| Tocar recordatorio → Agenda | **PASS** (app en segundo plano) — snackbar `Cita HA-PUSH-E2E-*` |
| TLS `n8n.autonomousflow.lat` | **PASS** — notAfter **2027-01-02**; `certbot.timer` active; dry-run OK |
| Tocar recordatorio tras `force-stop` | **NO PROBADO** |

## Pendientes

Ninguno bloqueante para push operativo. Homestead sigue usando webhook **interno** `http://n8n:5678/...`. Meta/WhatsApp a clientes no se usó.
