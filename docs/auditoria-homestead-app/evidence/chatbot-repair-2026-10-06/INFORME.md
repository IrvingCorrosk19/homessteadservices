# Chatbot repair — 2026-10-06

| Caso | Fallo | Causa | Corrección | Folio | Persistencia | Push | Resultado |
|---|---|---|---|---|---|---|---|
| A-goteras | prod EARLY_RETURN + goteras no accionable | SLOT_SELECTED_EARLY_RETURN en origin; goteras ausente en intent | CONTINUE_BOOK + goteras aliases + symptom→ACTIONABLE | HS-2026-000279 | PASS | NO PROBADO (dry_run/local) | PASS |
| B-ac-precio | pérdida de contexto / no crea | intent + early return | stateful create + CONTINUE_BOOK | HS-2026-000280 | PASS | NO PROBADO | PASS |
| C-dual | cambio silencioso de servicio | contexto mid-booking | service-transition + create continuity | HS-2026-000281,HS-2026-000282 | PASS | NO PROBADO | PASS |
| D-cancel | no cancela / no confirma | flujo confirmación + ownership | engine cancel path | HS-2026-000283 | FAIL | N/A | FAIL |
| PUSH-outbox | aviso no llega A06 | si no hay HS no hay evento; FCM físico requiere dispositivo | create HS on symptom + CONTINUE_BOOK deploy | HS-2026-000284 | PASS | OUTBOX PASS / físico NO PROBADO (A06 desconectado) | PASS parcial |

## Entorno
- Local HEAD (pre-deploy): chatbot fixes + CONTINUE_BOOK
- Prod VPS BUILD_ID Ak4QNYJY (2026-10-04) aún con SLOT_SELECTED_EARLY_RETURN en origin
- A06: dispositivo no conectado → push físico NO PROBADO
