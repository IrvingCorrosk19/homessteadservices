# HOMESTEAD — Context Switch / Service Switch P0 Certification

**Date:** 2026-08-26  
**Scope:** Invalidate stale pending actions when user switches intent (digital lock → painting)  
**Verdict:** CONTEXT SWITCH ENGINE CERTIFIED

---

## ROOT_CAUSE

**Primary (STALE_PENDING_ACTION_FOUND: YES):**  
In `concierge-engine.ts`, while `digitalLockChecklist.active`, pending/unanalyzed photos (or history reactivation via `historySuggestsDigitalLockFlow`) caused an **early return** with `digitalLockHumanReply` — e.g. “Solo me falta una foto del canto” — **before** the user’s new message intent was applied.

**Secondary:**  
`NEW_NEED` routing did not recognize `olvidemos` / `mejor ayudame con…`. Digital lock flow was reactivated from chat history even after the user abandoned it. No transition layer distinguished **REFINEMENT** (same HS) from **SWITCH** (cancel old job → new HS).

**ASYNC_RACE_FOUND: YES (guarded):**  
Photo vision can finish after a later switch turn. Without a service-context check, a stale vision reply could overwrite the new intent. Added `STALE_ASYNC_RESULT_DISCARDED` + `serviceContextId` / `digitalLockAbandoned` guards.

---

## FIXES

| Component | Change |
|-----------|--------|
| `service-transition.ts` | `detectConversationTransition` + `applyConversationTransition` (REFINE / SWITCH / ADD / CANCEL) |
| `concierge-engine.ts` | Transition **before** lock photo early-return; abandon flag; stale async + stale reply guards |
| Lock photos | Deactivated and archived on SWITCH; not part of painting readiness |
| Customer facts | Name / phone / location / unit preserved |
| Slots | Cleared to historical on SWITCH |
| HS lifecycle | SWITCH → old HS `CANCELLED`, new painting HS via ensure; REFINEMENT → same HS |
| Turn routing | `olvidemos` / switch phrases in NEW_NEED signals |

---

## CERTIFICATION MATRIX

| Gate | Result |
|------|--------|
| TRANSITION_ENGINE | PASS |
| REFINEMENT | PASS (repairs → pintura = same HS) |
| SWITCH | PASS (lock → pintura) |
| ADD_SERVICE | PASS (también → clarify, no cancel) |
| CANCEL | PASS |
| CUSTOMER_FACT_PRESERVATION | PASS |
| SERVICE_FACT_RESET | PASS |
| PHOTO_SCOPE | PASS (lock checklist inactive) |
| SLOT_SCOPE | PASS |
| OLD_HS_STATUS | CANCELLED on switch |
| NEW_HS | Created on actionable painting switch |
| STALE_ASYNC_GUARD | PASS |
| PENDING_ACTION_GUARD | PASS |
| RESPONSE_GUARD | PASS (`STALE_ASSISTANT_RESPONSE_BLOCKED`) |
| TEST_LOCK_TO_PAINT | PASS |
| TEST_AC_TO_PLUMBING | PASS |
| TEST_REPAIR_TO_PAINT_REFINEMENT | PASS |
| TEST_ADD_SERVICE | PASS |
| TEST_CANCEL | PASS |
| TEST_ASYNC_PHOTO_RACE | PASS (zombie reply blocked) |
| TEST_CUSTOMER_FACTS | PASS |
| TEST_OLD_SLOTS | PASS |
| BUILD | PASS (`tsc --noEmit`) |
| TESTS | PASS (`test-context-switch.mjs`, request-identity) |
| P0 | 0 |
| P1 | 0 |

---

## FINAL VERDICT

**CONTEXT SWITCH ENGINE CERTIFIED**

Most recent customer intent wins. Pending lock photo questions are invalidated on SWITCH. Refinement still keeps one HS.
