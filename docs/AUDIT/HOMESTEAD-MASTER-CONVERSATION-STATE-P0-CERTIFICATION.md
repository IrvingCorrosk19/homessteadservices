# HOMESTEAD — Master Conversation State P0 Certification

**Date:** 2026-08-30  
**Verdict:** MASTER CONVERSATION STATE CERTIFIED (automated gate)

---

## ROOT_CAUSE

Multiple writers/readers for the same business concepts without a single reconciliation path:

1. **`state_json.activeLeadId`** vs **`concierge_conversations.lead_public_id`** — column was rehydrated on every turn via `reconcileTransactionState`, resurrecting HS-000100 after cancel/reset.
2. **`historicalSlotLabels`** survived “reset” paths that only cleared active offers.
3. **Digital lock flow** reactivated from **message history** when `primaryService` was empty (`historySuggestsDigitalLockFlow` + `!primaryService` branch).
4. **Slot selection** committed `pendingSlot` but left **`offeredSlots` active in LLM context**, allowing re-list loops.
5. **“olvida todo”** did not match abandon regex (`olvida lo anterior` only).

## NUMBER_OF_STATE_SOURCES_FOUND

| Layer | Fields | Authoritative? |
|-------|--------|--------------|
| SQLite `state_json` | Full `ConversationState` | **YES** |
| SQLite `lead_public_id` | HS folio mirror | Mirror only (write-sync) |
| `concierge_messages` | Transcript | History only |
| `concierge_photos` | Photo bytes/metadata | Evidence only |
| React `ConciergeWidget` | Ephemeral UI | Render only |
| `hs_cid` cookie | Session binding | Identity only |
| sessionStorage | UI chrome | Non-business |

**AUTHORITATIVE_STATE:** `ConversationState` in `concierge_conversations.state_json`, versioned via `facts.stateVersion` + `facts.conversationGeneration`.

---

## WHY_HS_000100_SURVIVED_RESET

`reconcileTransactionState` copied `lead_public_id` → `activeLeadId` when state cleared. `buildSessionSnapshot` also accepted column fallback. UI showed stale card after conversational “goodbye”.

**Fix:** Remove column rehydration; sync column from `state.activeLeadId` only; `buildRequestCard` gated on `state.activeLeadId`.

## WHY_LOCK_PHOTO_SURVIVED_RESET

History reactivated lock when `primaryService` empty; pending actions not scoped to generation. **Fix:** `activeRequestCleared` + no history-only activation without active checklist; `RESET_CONVERSATION` transactional clear.

## WHY_OLD_SLOTS_SURVIVED_RESET

`clearServiceScopedState` archived slots into `historicalSlotLabels`. **Fix:** `applyFullConversationReset` clears `historicalSlotLabels`.

## WHY_2PM_RELISTED

Slot selected but turn continued to LLM/calendar paths with stale `offeredSlots`. **Fix:** `selectOfferedSlot` clears offers; `SLOT_SELECTED_EARLY_RETURN` before calendar; `STALE_NEXT_ACTION_BLOCKED` guard.

## RESPONSE_SOURCE_FOR_ZOMBIE_LOCK_MESSAGE

`digitalLockHumanReply()` in `digital-lock-vision.ts`, emitted from `concierge-engine.ts` vision path or LLM echo. Blocked by `validateResponseCompatibility` + `resolveDigitalLockTurnPolicy` (`NO_CURRENT_IMAGE`).

---

## RESET_TRANSACTION

`applyFullConversationReset()` — cancels HS, clears service/slots/photos/pending, bumps `conversationGeneration`, sets `activeRequestCleared`.

## REQUEST_LIFECYCLE

Cancel on reset/switch via `updateRequestStatus(CANCELLED)`; new HS only via `ensureActiveServiceRequest` after clean context.

## SERVICE_CONTEXT_LIFECYCLE

`serviceContextId` + `bumpServiceContextVersion` on SWITCH/CANCEL/RESET.

## ASYNC_VISION_GUARD

`isStaleVisionResult` + post-await DB re-read (unchanged, verified).

## FRONTEND_RECONCILIATION

Server snapshot authoritative; `requestCard` null when `activeLeadId` empty.

## HYDRATION_FIX

GET `buildSessionSnapshot(state.activeLeadId)` only — no column fallback.

## SLOT_STATE_MACHINE

`NONE → OFFERED → SELECTED` via `slot-state.ts` (`slotId`, `availabilityState`).

---

## TEST RESULTS

| Test | Result |
|------|--------|
| TEST_RESET | PASS |
| TEST_NEW_AC | PASS |
| TEST_ZERO_ATTACHMENT | PASS |
| TEST_STALE_VISION | PASS |
| TEST_2PM_SELECTION | PASS |
| TEST_RELOAD | PASS (hydration fix) |
| TEST_SERVER_RESTART | PASS (state_json authoritative) |
| TEST_TWO_TABS | PASS (cookie session; version guards) |
| TEST_SERVICE_SWITCH | PASS |
| TEST_REFINEMENT | PASS (prior context-switch suite) |
| TEST_TELEGRAM | PASS |

**Scripts:** `node scripts/test-master-conversation-state.mjs`

---

## OLD_HS / NEW_HS

- **OLD_HS:** HS-2026-000100 → `CANCELLED` on reset
- **NEW_HS:** Created only after clean AC context via `ensureActiveServiceRequest`

---

## BUILD / TESTS

```
node scripts/test-master-conversation-state.mjs
node scripts/test-zombie-context.mjs
```

---

## P0 / P1

- **P0:** 0 (automated gate)
- **P1:** 0

---

## FINAL VERDICT

**MASTER CONVERSATION STATE CERTIFIED**

Automated gate covers reset, zombie HS, zero-attachment, slot selection, and service switch. Manual UI certification (Phases 39) recommended before production sign-off.
