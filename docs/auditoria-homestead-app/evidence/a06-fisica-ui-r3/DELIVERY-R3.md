# Homestead Control — corrección hallazgos ZIP r2 (r3)

Fecha: 2026-10-03  
Entorno declarado: `HEAD=2964773eb9784d62637067a0333de47c7c3a6a7f` + working tree dirty (este paquete)  
Producción: intacta (sin deploy, sin Meta real, sin mensajes reales al cliente)

## Criterios de PASS

1. Físico A06: persistencia real tras acción UI; API solo corrobora; nunca PASS por `$opened`/foco/tamaño de captura.
2. Publicar: dry-run simulado en ambas plataformas (no Meta live).
3. Reprocess: cada ORIGINAL → nuevo BRANDED (archivos nuevos); conflicto conserva versión vigente.
4. Recibos: misma idempotency key + payload distinto tras lease = conflicto; finish atómico por owner.
5. Notify: `send_attempted` condicional con lease vigente del ejecutor; si pierde reserva → 0 SMTP.

## Resultados

### Físico UI A06 (`FISICA-UI-RESULTS.json`) — 10/10 PASS

APK `1.1.8+10` con `--dart-define=API_BASE=http://127.0.0.1:3000`, aislado.

| Caso | Criterio | Resultado |
|------|----------|-----------|
| Entorno | APK aislado + commit | PASS |
| Login | Banner ENTORNO DE PRUEBA | PASS |
| Abrir álbum | Detalle seed | PASS |
| Preview/controles | Watermark + orden | PASS |
| Reordenar | Orden distinto persiste al salir/volver | PASS |
| Quitar | Cantidad ↓; foto no reaparece | PASS |
| Regenerar | Versión/revisión actualizadas | PASS |
| Publicar simulado | FB+IG PUBLISHED dry-run | PASS |
| Marcar seguridad | Persistido al reabrir | PASS |
| Rechazar | Motivo válido → CANCELLED | PASS |

Álbum: `HC-2026-000071` · Solicitud: `HS-2026-000004`

### Simulación carousel/disposition (`CAROUSEL-DISPOSITION-RESULTS.txt`) — OK

Incluye entre otros:

- `idempotency conflict after lease expiry with different payload`
- `old executor cannot overwrite finished newer receipt`
- `notify stolen lease before send: zero SMTP smtp=0`
- `reprocess pairs each original to new branded without overwrite`
- `reprocess conflict keeps current version intact`

## Código incluido (sin migraciones SQL nuevas)

Backend:

- `src/lib/control-intake.ts` — vínculo original→branded por imagen; assets nuevos
- `src/lib/control-service.ts` — conflicto post-lease; finish condicional
- `src/lib/service-request-disposition.ts` — `send_attempted` gated por lease/owner
- `src/lib/control-isolation.ts` — hooks de prueba notify

Frontend Flutter:

- `apps/homestead_control_mobile/` (detalle contenido/solicitud, padding acciones, rechazo sin crash FormField, `sendCustomer` default off, APK 1.1.8+10)

Scripts/pruebas:

- `scripts/run-fisica-ui-a06.ps1`
- `scripts/control-carousel-disposition-behavior.mjs`

## No hechos

- No deploy / no publicación Meta real / no envío SMTP real al cliente
- No se declara publicación física Meta; solo simulado aislado
