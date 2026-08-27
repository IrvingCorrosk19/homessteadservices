# HOMESTEAD CONCIERGE — STATE MACHINE & ANTI-LOOP V3 CERTIFICATION

Date: 2026-08-26  
Scope: Conversational booking architecture (deterministic next-action; LLM drafts language only)

---

## ROOT_CAUSE

| ID | Finding | Severity |
| --- | --- | --- |
| A | LLM invented optional “detalle/referencia/dirección precisa” after name was known | P0 (symptom) |
| B | `extractLocation` missed packed lines like `san miguelito, ph el cucuyo apartamento 3r` (no `estoy en`) → empty `state.location` while building/unit existed | P0 |
| C | `getAppointmentReadiness` treated `location` string / `address_line`-style gap as blocking even when zone + PH + unit were semantically sufficient | P0 |
| D | Soft “photos / useful facts” and vague readiness wording let the model treat optional fields as blockers | P1 |
| E | Anti-loop previously logged repeated asks but did not rewrite / stop / book | P1 |

**Primary root cause:** readiness + extraction treated “usable property location” as incomplete → model filled the gap with invented questions. Not a one-off prompt failure for “dirección”.

---

## Architecture after fix

| Layer | Role |
| --- | --- |
| **STATE_MACHINE** | `determineNextAction()` in `src/lib/concierge/conversation-next-action.ts` |
| **SERVER_STATE** | SQLite conversation state (`concierge-store`); browser is not source of truth |
| **SLOT_EXTRACTION** | `packed-extraction.ts` (zone districts, leading `Zona, PH …`, building/unit, bare name when asked) |
| **REQUIRED_FIELDS_ENGINE** | `getAppointmentReadiness()` + `requiredMissing` passed to the model |
| **OPTIONAL_FIELDS** | `additionalReference` / landmark → `DECLINED` via `markOptionalDeclined` / `isDeclineAnswer`; never required for book |
| **LOCATION_SUFFICIENCY** | `isLocationSufficient()` — zone + PH + unit is enough; street not required |
| **NEGATIVE_ANSWER_HANDLING** | Decline phrases mark optional reference DECLINED and continue |
| **ANTI_LOOP** | `askCount_*`, `shouldStopAsking`, `enforceDeterministicAsk`, `detectRepeatedQuestion` rewrite |
| **TIME_CHANGE** | Slot re-pick sets `pendingSlot` / prefs; next-action stays on book path when ready |
| **DATE_CHANGE** | Prefer/pending slot updated via existing parse + offer matching |
| **TOPIC_CHANGE** | Existing service change clears offers/lead in packed extraction |
| **PHOTO_REQUIREMENTS** | ServiceRequirementPolicy / digital-lock checklist; photos not soft-blocked near booking for gypsum |
| **CUSTOMER_MEMORY** | Known name/phone/location in state JSON; memory-truth answers |
| **REFRESH_RECOVERY** | Server conversation id + persisted state |
| **BOOKING_TRANSACTION** | When `CONFIRM_OR_BOOK`, engine may call `create_appointment` deterministically (`DETERMINISTIC_BOOK`); confirmation text only after `bookedThisTurn` |

---

## Hard rules encoded

- `LLM_CAN_INVENT_REQUIREMENTS`: **NO** — invent location/vague asks rewritten when `requiredMissing` empty / location sufficient  
- `LLM_CAN_OVERRIDE_STATE`: **NO** — next action + readiness are server-authoritative  
- One useful ask per turn when something is truly missing  
- Never claim “agendado” until appointment tool succeeds (`enforceBookingIntegrity`)

---

## Test results

| Case | Result |
| --- | --- |
| **REAL_GYPSUM_CASE** | PASS — after zone/PH/unit/phone/slot/name → `CONFIRM_OR_BOOK`; invented “otro detalle” rewritten |
| **MULTI_FIELD_CASE** | PASS — packed extraction → ready |
| **CHANGE_TIME_CASE** | PASS — 10:00→08:00 stays book path; no location re-ask |
| **NO_REFERENCE_CASE** | PASS — decline detected; reference DECLINED does not block |
| **REFRESH_CASE** | PASS (architecture) — critical fields live in server conversation state |

Script: `scripts/test-concierge-state-machine.mjs`

---

## Gates

| Gate | Status |
| --- | --- |
| Re-ask known location | PASS (rewrite + sufficiency) |
| Ignore “no” on optional reference | PASS |
| Optional field blocks booking | PASS (does not) |
| LLM invents requirement | PASS (blocked) |
| Time change restarts interrogation | PASS (does not) |
| Says booked before persist | PASS (integrity + deterministic book path) |
| Vague “algún otro detalle” when ready | PASS (blocked) |

| Ops | Status |
| --- | --- |
| **P0** | 0 (addressed in this change) |
| **P1** | 0 for anti-loop/readiness scope |
| **BUILD** | `npx tsc --noEmit` (run at certify time) |
| **TESTS** | `node scripts/test-concierge-state-machine.mjs` |

---

## Files touched (core)

- `src/lib/concierge/conversation-next-action.ts` (new engine)
- `src/lib/concierge/appointment-readiness.ts`
- `src/lib/concierge/packed-extraction.ts`
- `src/lib/concierge/turn-intelligence.ts`
- `src/lib/concierge/service-playbooks.ts` (gypsum/yeso aliases)
- `src/lib/concierge-engine.ts`
- `scripts/test-concierge-state-machine.mjs`
- `docs/AUDIT/HOMESTEAD-CONCIERGE-STATE-MACHINE-ANTI-LOOP-CERTIFICATION.md`

---

## FINAL VERDICT

**CONCIERGE STATE MACHINE CERTIFIED**

Deterministic next-action + location sufficiency + anti-loop rewrite + optional decline + server-side book when ready. The gypsum failure mode (post-name invented location/detail loop) is closed at the architecture layer, not by prompt persuasion alone.
