# HOMESTEAD — Calendar Action Execution P0 Certification

**Date:** 2026-08-26  
**Scope:** Affirmation/direct request must execute real calendar query (no permission loops)  
**Verdict:** CALENDAR ACTION EXECUTION CERTIFIED

---

## ROOT_CAUSE

1. `enforceBookingIntegrity()` replaced false “agendada” claims with:  
   *“Si te parece, reviso horarios reales…”*  
   but **never persisted** `pendingAction = QUERY_AVAILABILITY`.

2. `shouldQueryCalendar` required booking-signal regex (`horario`, etc.).  
   - `"si por favor"` did not match.  
   - `"horarios"` (plural) did not match `\bhorario\b`.

3. After acceptance, LLM/integrity could emit the **same offer again** → infinite loop.

---

## FIXES

| Piece | Behavior |
|-------|----------|
| `calendar-action.ts` | Pending action, affirmation, direct request, loop guard |
| Engine | On affirm/direct → `checkAvailability` → reply with **real** slots (early return) |
| No date | Ask once: “¿Qué día te gustaría la visita?” |
| Integrity strip | Sets `pendingAction`; if slots already known, show them instead of re-asking |
| Last-assistant offer | Affirmation works even if pending wasn’t stored (live loop recovery) |
| HS | Calendar query does not create a new HS |

---

## CERTIFICATION MATRIX

| Gate | Result |
|------|--------|
| PENDING_ACTION_MODEL | PASS |
| AFFIRMATION_RESOLUTION | PASS (`si por favor`, `dale`, `ok`) |
| DIRECT_ACTION_RESOLUTION | PASS (`muéstrame los horarios`) |
| EXACT_TEST_YES_PLEASE | PASS |
| EXACT_TEST_SHOW_TIMES | PASS |
| TEST_DALE / TEST_OK | PASS |
| TEST_NO_DATE | PASS (ask date once) |
| TEST_DATE_KNOWN | PASS |
| TEST_EXACT_TIME | PASS (`revisa si tienen` → direct) |
| FAKE_AVAILABILITY_GUARD | PASS (slots from `checkAvailability` / format only) |
| LOOP_GUARD | PASS (`ACTION_OFFER_LOOP_BLOCKED`) |
| HS_MATCH | PASS (no create on query) |
| Prior P0 suites | request-identity + context-switch PASS |
| BUILD | Engine typecheck clean |
| TESTS | `test-calendar-action.mjs` PASS |
| P0 | 0 |
| P1 | 0 |

---

## FINAL VERDICT

**CALENDAR ACTION EXECUTION CERTIFIED**

ASK → ACCEPT → EXECUTE. Direct request → EXECUTE. No permission loops.
