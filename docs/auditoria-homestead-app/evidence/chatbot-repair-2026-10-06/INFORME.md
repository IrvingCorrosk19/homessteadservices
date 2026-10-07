# Chatbot + push repair — evidencia final 2026-10-06/07

## Entorno
| | |
|---|---|
| Antes | VPS BUILD `Ak4QNYJY` (2026-10-04) con `SLOT_SELECTED_EARLY_RETURN` |
| Después | `DEPLOYED_SHA=aecd494` · health 200 |
| A06 físico | **NO PROBADO** (dispositivo no conectado) |
| Push subject | `op:2` (confirmado en env) |

## Tabla por caso

| Caso | Conversación | Fallo | Causa raíz | Corrección | Folio/ID | Persistencia | Push físico | Resultado |
|---|---|---|---|---|---|---|---|---|
| A Goteras | UI API aislado + prod | No crea HS; se queda en “reviso y confirmo” | `goteras` no accionable; prod con `EARLY_RETURN` | aliases+síntoma→ACTIONABLE; `CONTINUE_BOOK` | Local `HS-2026-000279`; Prod `HS-2026-000129` | PASS (folio+cita) | Outbox DELIVERED `op:2` / físico NO PROBADO | **PASS** (físico pendiente) |
| B AC precio | aislado | No crea / pierde hilo | mismo + intent | create stateful + CONTINUE_BOOK | `HS-2026-000280` | PASS | N/A dry_run | **PASS** |
| C Dual | aislado | Cambio silencioso | transición servicio | crea 2do HS plomería | `HS-281` + `HS-282` | PASS (2 folios) | N/A | **PASS** (copy “dejamos pintura” mejorable) |
| D Cancel | aislado | “sí, cancélala” no ejecuta | affirm regex + pending perdido | AFFIRM_CANCEL + recover pending | `HS-2026-000288` CANCELLED | PASS | N/A | **PASS** |
| Push E2E | prod controlado | aviso no llega | sin HS no hay evento; A06 off | create→outbox | `HS-2026-000129` | PASS | Outbox `DELIVERED`/`n8n_accepted` ≠ shade | **PASS parcial** |

## Commits
- `0e0aa8a` Fix chatbot request creation, same-turn booking, and cancel confirmation
- `aecd494` Include readinessCustomerAsk required by slot continue-book path

## Prod controlado
- Solicitud creada al primer “tengo goteras…” → `HS-2026-000129`
- Cita `HA-618faf55` agendada 7 oct 10:00
- Push `control.push.new_request:HS-2026-000129:op:2` → DELIVERED
- Fixture marcado CANCELLED / is_test=1 (cleanup)

## Pendientes
1. Push físico A06 (app abierta / background / kill + tap detalle) cuando el dispositivo esté conectado.
2. Suavizar copy al añadir segunda necesidad sin decir “dejamos” la anterior si sigue vigente.
3. Recordatorio 30m cancel/reprog en dispositivo (no re-probado hoy).
