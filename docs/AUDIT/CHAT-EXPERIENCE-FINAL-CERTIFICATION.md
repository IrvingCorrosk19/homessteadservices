# HOMESTEAD — CHAT EXPERIENCE + CONVERSATIONAL INTERRUPTION FINAL CERTIFICATION

**Date:** 2026-08-23  
**Verdict:** HOMESTEAD CHAT EXPERIENCE CERTIFIED (static + routing gates)

---

## ROOT_CAUSE

| Area | Finding |
|------|---------|
| **TURN_ROUTING** | `enforceAvailabilityIntegrity()` reescribía cualquier respuesta con relojes “no permitidos” de vuelta a `"Revisé la agenda. Estos horarios sí están libres..."` mientras `ctx.lastSlots` seguía activo en `AWAITING_SLOT_SELECTION`. |
| **STATE_VS_INTENT** | El engine trataba mensajes con `TIME_HINT` amplio como selección de slot; no existía capa de interrupción antes del post-procesado de disponibilidad. |

**Caso exacto:** `"perfecto y cuanto seria mas o menos"` → post-procesado forzaba re-listado de agenda.

---

## FIX_APPLIED

| Component | Change |
|-----------|--------|
| `concierge-turn-routing.ts` | `interpretTurnRoute`, price/new-need/pause/handoff detection, `priceGuidanceReply`, slot groups |
| `concierge-engine.ts` | Routing before slot match; interruption system prompt; loop detection; skip availability rewrite |
| `concierge-integrity.ts` | `skipRewrite` option on `enforceAvailabilityIntegrity` |
| `concierge-transaction.ts` | `bookingSuspended`; no client HS banner; grouped slot snapshot |
| `ConciergeWidget.tsx` | Minimize/close header; ESC; collapsed booking; service context; date-grouped chips |

---

## HARD GATES

| Test | Status |
|------|--------|
| EXACT_PRICE_BUG | PASS — price intent, no auto agenda repeat |
| PRICE_INTENT | PASS |
| NEW_NEED | PASS |
| BOOKING_CONTEXT_PRESERVED | PASS — slots kept, `bookingSuspended` |
| BOOKING_RESUME | PASS |
| RESPONSE_LOOP | PASS |
| HS_DISPLAY removed | PASS |
| CLOSE / MINIMIZE / ESC | PASS |
| SLOT_UI date grouping | PASS |
| MOBILE header sticky | PASS |

Run: `node scripts/test-chat-experience-final.mjs`

---

## FINAL VERDICT

**HOMESTEAD CHAT EXPERIENCE CERTIFIED**
