# HOMESTEAD — Conversational State Engine P0 Certification

**Date (UTC):** 2026-08-27  
**Scope:** P0 remediation — repetitive questions, lost data, location/unit loops, slot loss, non-deterministic flow

---

## ROOT_CAUSE_LOCATION_LOOP

1. **`extractLocation()` missed lowercase / multi-word zones** (`packed-extraction.ts`) — `"Panama centro edison park"` did not match Title-case regexes or district whitelist (Edison Park absent).
2. **`isLocationSufficient()` required PH building+unit** while zone was never stored → perpetual `missing: ["location"]`.
3. **Unrelated bare replies** (e.g. `"betania"` after unit ask) could be misclassified as location without `lastAskedField` gating.

**Fix:** Case-insensitive known-zone map, Panamá Centro + Edison Park composite, bare-zone capture only when bot asked location, safe merge that never overwrites confirmed location.

---

## ROOT_CAUSE_UNIT_LOOP

1. **LLM / regex could set `unit=3000`** from `"PH El Mare 3000"` without unit keyword.
2. **Readiness required unit for PH** while building was inferred incorrectly → repeated unit/location asks.

**Fix:** `sanitizeInferredUnit()` + PH trailing-digit parser stores `addressText` + `inferredUnitCandidate` but **does not** set `unit` unless explicit (`apto/unidad`) or bare unit reply when asked.

---

## ROOT_CAUSE_SLOT_LOSS

1. **`parseClock("2:00 p.m.")` returned `02:00` not `14:00`** → slot readiness failed (`concierge-datetime.ts`).
2. **`resolveSlotFromMessage()` did not match** `"Me sirve 2:00 p.m."` → `pendingSlot` never set.
3. **`reconcileTransactionState()` cleared offers when `awaitingSlotSelection=false`** after slot lock → **wiped `pendingSlot` and offered slots** (`concierge-transaction.ts` L145-147).
4. **`activateOfferedSlots()` always nulled `pendingSlot`** on calendar re-query.

**Fix:** Colon+AM/PM parsing, time-based slot resolution, `lockSelectedSlot()`, `isSlotConfirmed()` guard in reconcile/activate/merge/calendar paths.

---

## ROOT_CAUSE_REPEATED_AVAILABILITY

After failed slot binding, readiness re-entered `ASK_SLOT_SELECTION` / engine re-ran `check_availability` while `bookingIntent` remained true.

**Fix:** `isSlotConfirmed()` blocks re-offer; `check_availability` tool returns early with instruction not to re-list; `shouldQueryCalendar` skips when slot locked unless reschedule signal.

---

## FILES_CHANGED

| File | Change |
|------|--------|
| `src/lib/concierge/canonical-state.ts` | **NEW** — safe merge, slot lifecycle, duplicate-ask guard |
| `src/lib/concierge-datetime.ts` | `parseClock` colon+AM/PM → 24h |
| `src/lib/concierge/packed-extraction.ts` | Location zones, bare replies, PH 3000 guard, mergeConfirmedFacts |
| `src/lib/concierge-transaction.ts` | Slot lock, resolveSlotFromMessage, reconcile guard |
| `src/lib/concierge/appointment-readiness.ts` | Slot confirmed awareness |
| `src/lib/concierge/conversation-next-action.ts` | Slot lock in next action, DUPLICATE_QUESTION_BLOCKED |
| `src/lib/concierge/turn-intelligence.ts` | LLM fact merge null-protection, unit sanitize |
| `src/lib/concierge/playbook-engine.ts` | Expanded explicit correction patterns |
| `src/lib/concierge-engine.ts` | lockSelectedSlot, calendar guard, state transition logs |
| `src/lib/concierge-tools.ts` | mergeParsedWhen slot-safe, check_availability guard |
| `scripts/test-concierge-state-machine.mjs` | AC P0 regression + null merge tests |

---

## CANONICAL_STATE

Single structured state in `ConversationState` + `facts` map. New lifecycle helpers in `canonical-state.ts`:

- `mergeConfirmedFacts()` — patch merge, never null-overwrite
- `lockSelectedSlot()` — SELECTED slot with `slotConfirmed=1`
- `isSlotConfirmed()` — scheduling state sacred
- `shouldBlockDuplicateAsk()` — guard before ask generation

---

## SAFE_MERGE

`mergeConfirmedFacts()` + `mergeFactPatchSafe()` — empty/null/unknown from extractor **does not erase** prior confirmed values.

---

## NULL_PROTECTION

LLM `applyTurnIntelligence`: skip empty facts; skip location overwrite unless correction array present. Packed extraction uses mergeConfirmedFacts baseline.

---

## EXPLICIT_CORRECTION

`detectExplicitCorrection()` + expanded `applyLocationCorrection()` — `"me equivoqué"`, `"no es"`, `"cámbialo a"`, etc.

---

## LOCATION_READINESS

`isLocationSufficient()` unchanged policy: zone + (PH → building+unit). Improved extraction ensures zone actually stored for Panamá real addresses.

---

## REQUIRED_FIELDS

`getAppointmentReadiness()` + `determineNextAction()` share canonical missing-field list. Slot removed from missing when `isSlotConfirmed()`.

---

## NEXT_ACTION_ENGINE

Deterministic order preserved; slot-locked conversations skip `ASK_SLOT_SELECTION` and `CHECK_AVAILABILITY` unless reschedule.

---

## DUPLICATE_QUESTION_GUARD

`shouldBlockDuplicateAsk()` + `DUPLICATE_QUESTION_BLOCKED` log + existing `enforceDeterministicAsk()` rewrite.

---

## LOOP_DETECTOR

Existing `shouldStopAsking()` (2-ask cap) + duplicate guard + slot/location confirmed checks.

---

## REQUEST_PERSISTENCE

Existing `ensureActiveServiceRequest()` unchanged — HS created on valid service intent, updated same folio each turn.

---

## HS_IDEMPOTENCY

Same `activeLeadId` per conversation; service change clears lead (existing behavior).

---

## CALENDAR_REAL_QUERY

`check_availability` / engine path unchanged — only executes when not slot-locked. Guard prevents fake re-query instruction when slot already selected.

---

## OFFERED_SLOTS / SELECTED_SLOT_PERSISTENCE / REVALIDATION / BOOKING

- OFFERED: `offeredSlots` retained after selection for validation
- SELECTED: `lockSelectedSlot()` → `pendingSlot` + `slotConfirmed`
- REVALIDATION: `create_appointment` + `isSlotStillOpen()` (existing)
- BOOKING: deterministic `CONFIRM_OR_BOOK` path in engine (existing)

---

## REGRESSION TESTS

| Test | Result |
|------|--------|
| REGRESSION_ORIGINAL_CONVERSATION (AC Edison Park → 2pm → name) | PASS |
| NULL_MERGE_TEST | PASS |
| CORRECTION_TEST (gypsum + decline) | PASS |
| SLOT_MEMORY_TEST | PASS |
| DUPLICATE_QUESTION_TEST | PASS |
| parseClock 2:00 p.m. | PASS |
| PH El Mare 3000 no unit | PASS |

Command: `node scripts/test-concierge-state-machine.mjs` — **54 assertions PASS**

---

## BUILD / TESTS

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS |
| `node scripts/test-concierge-state-machine.mjs` | PASS (54) |
| `npm run build` | PASS |

---

## P0 / P1 / P2

| Severity | Count |
|----------|-------|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |

---

## FINAL_VERDICT

# CONVERSATIONAL STATE CERTIFIED

Architectural rule enforced: **LLM understands language; state engine remembers facts; readiness knows what's missing; calendar knows availability; booking creates HA.**

No prompt-only patch. Deterministic merge, slot lifecycle, and regression tests in place.

**Deploy note:** Changes are local — deploy to VPS when ready for production validation.
