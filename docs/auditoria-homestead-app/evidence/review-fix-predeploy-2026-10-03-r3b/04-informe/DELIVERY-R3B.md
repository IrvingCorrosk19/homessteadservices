# Homestead Control — cierre pendientes r3 (r3b)

Fecha: 2026-10-03  
Producción: intacta (sin deploy, sin Meta real, sin mensajes reales al cliente)

## Commits / artefacto probado

| Ítem | Valor |
|------|--------|
| Backend commit | `57246ec47f4f93c4a588488a40a0a14cc7fb4f28` |
| APK instalado en A06 | `1.1.8+10` |
| SHA256 APK debug probado | `33C57CCC1561CE9D730CF1B3DCB7C2B42E479BA53922782DDBA7F896C2C96148` |
| Ruta APK | `apps/homestead_control_mobile/dist/homestead-control-1.1.8+10-isolated-debug.apk` |

## Pendientes cerrados

### 1. Reprocess respeta selección/orden

`reprocessControlBrand` solo reprocesa ORIGINALes vinculados a la selección actual (`mediaOrderJson`), en ese orden, con filenames `branded-vN-III-<batch>-feed.jpg` (no sobrescribe históricos).

Prueba simulada: A/B/C → C/A/B → quitar A → reprocess → quedan C/B (índices 3,2), assets nuevos, A no revive.

Evidencia: `CAROUSEL-R3B-REPROCESS.txt` — PASS `reprocess only selected C/B with new assets, no revive A`.

### 2. Conflicto sin sobrescribir estado ajeno

Claim en `pending_input` + actualización condicional. Si pierde propiedad/revisión: `conflict_during_regen` **sin** restaurar status/caption/order/aprobación ajenos.

Prueba: `holdSimulatedReprocess` pausa mid-process → edición concurrente → release → estado concurrente intacto (`NEEDS_REVIEW`, caption, order).

Evidencia: PASS `reprocess conflict during pause leaves concurrent state intact`.

### 3. Física seguridad (activación ≠ consulta)

Solicitud ficticia con `securityReviewRequired=false` (`seed-fisica-security-request.mjs`). Motivo único por corrida.

Corrida verificada:

- Request: `HS-2026-000035`
- Motivo: `sec-fisica-r3b-eb7efafad8`
- Consulta previa: PASS (`securityReviewRequired=false`, phase=lookup)
- Activación A06: PASS — marca true, motivo exacto, audit `SECURITY_REVIEW_SET` at `2026-10-03T21:26:41.488Z` (> testStart)

**No** se cuenta marca preexistente como acción.

### 4. Meta simulado ≠ “dry-run”

Publicación aislada: `dryRun=false` + permalinks `https://example.invalid/sim`. Es **transporte Meta simulado**, no dry-run. Llamarla “dry-run” es impreciso.

## Regresión ejecutada

- `npm run control:test:carousel` (incluye reprocess selección + conflicto con pausa)
- `scripts/run-fisica-ui-a06.ps1` (seguridad dirigida + regresión contenido)

Nota: en esta corrida r3b el rechazo UI tras seguridad falló por inestabilidad Flutter al reabrir lista (`onDetail=false`). El rechazo ya estaba PASS en r3; no forma parte de los 4 pendientes de este cierre.

## Código afectado (solo este cierre)

- `src/lib/control-intake.ts` — selección + claim
- `src/lib/control-isolation.ts` — hold/release reprocess
- `src/lib/content-edit-guard.ts` — `pendingInput` en jobPatch
- `scripts/control-carousel-disposition-behavior.mjs`
- `scripts/run-fisica-ui-a06.ps1`
- `scripts/seed-fisica-security-request.mjs`

## No hechos

- No deploy / no Meta live / no SMTP real al cliente
