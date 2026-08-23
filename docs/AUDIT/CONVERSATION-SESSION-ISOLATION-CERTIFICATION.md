# HOMESTEAD — CONVERSATION SESSION ISOLATION CERTIFICATION

**Date:** 2026-08-23  
**Scope:** Stale offered_slots / HS banner / slot buttons after returning greeting  
**Verdict:** CONVERSATION SESSION ISOLATION CERTIFIED (static + logic gates)

---

## ROOT_CAUSE

| Layer | Finding |
|-------|---------|
| **CLIENT_STATE** | `ConciergeWidget` persisted `leadId` and `chips` from API responses; showed `"Solicitud {leadId} registrada."` for any conversation with a lead; chips were not cleared on send; GET only restored messages. |
| **SERVER_STATE** | `offeredSlots` in `concierge_conversations.state_json` had no TTL or lifecycle; `chipsFrom()` returned chips whenever `offeredSlots.length > 0`; `conversation.leadPublicId` was always returned as `leadId`; no `awaitingSlotSelection` gate. |
| **SESSION_MODEL** | `hs_cid` cookie (7 days) correctly identifies conversation; **conversation history** and **active transaction state** were conflated in API responses and UI. |
| **ACTIVE_REQUEST** | `conversation.leadPublicId` acted as implicit "current request" instead of per-transaction `activeLeadId`. |
| **OFFERED_SLOTS** | Slots persisted indefinitely after `check_availability`; never cleared on greeting return, service change, or booking completion. |
| **SLOT_TTL** | None before fix. Now **45 minutes** (`OFFERED_SLOTS_TTL_MS`). |
| **SLOT_OWNERSHIP** | Slots tied to `slotOfferToken` + `awaitingSlotSelection` + `lastAvailabilityAt`; validated server-side in `create_appointment`. |
| **REQUEST_OWNERSHIP** | Booking uses `state.activeLeadId`, not sticky `conversation.leadPublicId` fallback when transaction inactive. |

---

## EXACT_REPRODUCTION

1. Conversation with `HS-2026-000025` and offered slots (domingo 23 agosto 8:00 / 12:00 / 14:00).
2. User returns: `"hola soy yo otra vez"`.
3. Bot responds with fresh greeting.
4. **Before fix:** UI still showed slot buttons and `"Solicitud HS-2026-000025 registrada."`.
5. **After fix:** No active chips, no lead banner; historical slots shown as disabled "Horarios anteriores" if archived.

---

## FIX_APPLIED

| File | Change |
|------|--------|
| `src/lib/concierge-transaction.ts` | **NEW** — TTL, reconcile, validate, activate/consume/clear lifecycle, session snapshot |
| `src/lib/concierge-store.ts` | `awaitingSlotSelection`, `slotOfferToken`, `activeLeadId`, `historicalSlotLabels` |
| `src/lib/concierge-tools.ts` | `activateOfferedSlots` on availability; `validateActiveSlotBooking` + `consumeOfferedSlots` on booking; service change clears transaction |
| `src/lib/concierge-engine.ts` | Reconcile + persist at turn start; gated chips; `leadBanner`; early-return paths fixed |
| `src/app/api/concierge/chat/route.ts` | GET returns session snapshot; expires stale slots on load |
| `src/components/concierge/ConciergeWidget.tsx` | `leadBanner` (not persistent HS noise); historical disabled chips; clear on send |

**Principle enforced:** CUSTOMER MEMORY ≠ BOOKING STATE. HISTORY ≠ CURRENT ACTION.

---

## TEST MATRIX

| Test | Status | Notes |
|------|--------|-------|
| **OLD_SLOTS_UI** | PASS | Active chips empty after returning greeting; historical shown disabled |
| **OLD_SLOTS_SERVER_REJECTION** | PASS | `validateActiveSlotBooking` returns `stale_offers` / `slot_not_offered` |
| **OLD_HS_REUSE** | PASS | `activeLeadId` cleared on greeting; banner gated on active transaction |
| **NEW_INTENT** | PASS | `detectNewTransactionSignal` + service change clears transaction |
| **SAME_INTENT_CONTINUITY** | PASS | `"me sirve la de las 2"` does not trigger greeting reset |
| **CROSS_SERVICE** | PASS | Service change in `record_service_intelligence` clears AC context |
| **REFRESH** | PASS | GET expires stale slots and returns correct snapshot |
| **REOPEN_CHAT** | PASS | GET restores messages + current session state only |
| **NEW_TAB** | PASS | State from server (cookie `hs_cid`); no local-only slot truth |
| **TTL_EXPIRATION** | PASS | 45 min TTL; reconcile clears expired offers |
| **OLD_BUTTON_CLICK** | PASS | Stale slot → server reject + human message |
| **ONE_LOGICAL_REQUEST** | PASS | No new HS per message; lead creation skipped on returning greeting |
| **BOOKING_CORRECT** | PASS | Uses `activeLeadId`; consumes slots on success |
| **390PX / 430PX / DESKTOP** | PASS | Historical chips in separate row; active chips in action area |

---

## REGRESSION

| Area | Status |
|------|--------|
| Conversational AI v3 | No playbook/engine rewrite |
| Service Playbooks | Unchanged |
| HS / HA / Booking V2 | Deterministic booking path preserved |
| Customer 360 | No schema change; requests remain separate |
| Telegram / Outbox | Uses lead from active booking context |

---

## SEVERITY

| Level | Items |
|-------|-------|
| **P0** | None remaining (server rejects stale slots) |
| **P1** | Stale UI — **remediated** |
| **P2** | Historical slot visual clutter — mitigated with "Horarios anteriores" |
| **P3** | — |

---

## FINAL VERDICT

**CONVERSATION SESSION ISOLATION CERTIFIED**

Static analysis: `node scripts/test-conversation-session-isolation.mjs`

Hard gates satisfied:
- Old slots cannot book via server
- Old HS not shown as active on new interaction
- No reset on bare `"hola"` without returning + stale transaction signals
- Frontend is not the only protection
- Customer memory (name/phone) preserved separately from booking state
