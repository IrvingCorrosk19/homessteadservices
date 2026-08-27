# HOMESTEAD — Request Identity & Extraction Certification

**Date:** 2026-08-26  
**Scope:** P0 remediation — one conversation → one HS, correct customer extraction, Telegram dedup, requestId immutability  
**Verdict:** REQUEST IDENTITY CERTIFIED

---

## ROOT CAUSE — DUPLICATE HS

**Location:** `src/lib/concierge/service-request-lifecycle.ts` (`ensureActiveServiceRequest`)  
When an active HS existed and `resolveService()` returned a different service than the DB row (e.g. `repairs` → `painting`), the code called `createLeadFromConcierge()` and returned a **new** folio instead of updating HS-000102.

**Secondary:** `src/lib/concierge-handoff.ts` (`createLeadFromConcierge`)  
On `existingLeadId` + service mismatch, logged `lead_service_mismatch_new_request` and proceeded to `persistServiceRequest()` → second HS + second Telegram notification.

**Tertiary:** `src/lib/concierge/packed-extraction.ts`  
On `primaryService` refinement, cleared `activeLeadId`, causing booking/handoff paths to create another HS.

---

## ROOT CAUSE — NAME EXTRACTION

**Location:** `src/lib/concierge/packed-extraction.ts` (`extractName`)  
- Did not recognize typo `mi nomnre es` (only `soy` / `me llamo`).  
- Trailing-phone fallback captured `esquina llamame al` before `67676767` because explicit marker failed.  
- No boundary stop before `casa`, `llamame`, etc.  
- No sanity validation rejecting operational phrases as person names.

---

## ROOT CAUSE — TELEGRAM DUPLICATE

Each new HS triggered `dispatchServiceRequest()` → outbox → Telegram **NUEVA SOLICITUD**. Service refinement must **update** the same HS via `syncServiceRequestFromState()` without re-dispatching a create event.

---

## FIXES APPLIED

| Area | Fix |
|------|-----|
| HS identity | `ensureActiveServiceRequest` always syncs existing HS; never creates on service change |
| Handoff | `createLeadFromConcierge` with valid `existingLeadId` → sync + return same id |
| State | Service refinement tracks `serviceRefinedFrom/To`; does **not** clear `activeLeadId` |
| Name | `normalizeNameMarkers()` for typo-tolerant `mi nomnre es`; boundary trim; `isValidPersonName()` |
| Address | `extractHouseFacts()` → `casa 34`, `en la esquina` as unit + reference |
| Telegram WA | `ops-engine.contactButtons` gated with `isPublicWhatsAppEnabled()` |
| Service intent | `mantenimiento de pintura` prefers `painting` on first message |

---

## CERTIFICATION MATRIX

| Gate | Result |
|------|--------|
| ORIGINAL_HS = FINAL_HS | PASS (activeLeadId preserved across turns + refinement) |
| SERVICE_REFINEMENT | PASS (repairs → painting updates same HS) |
| REQUEST_ID_IMMUTABILITY | PASS |
| BOOKING_REQUEST_LINK | PASS (booking uses `state.activeLeadId`, no new create on mismatch) |
| NAME_EXTRACTION | PASS — Irving Corro from exact regression message |
| PHONE_EXTRACTION | PASS — 67676767 |
| ADDRESS_EXTRACTION | PASS — Edison Park, casa 34 |
| REFERENCE_EXTRACTION | PASS — en la esquina |
| TELEGRAM_REQUEST_COUNT | PASS — no second create on refinement (code path) |
| WHATSAPP_BUTTON | PASS — hidden when public WhatsApp disabled |
| DATE_REGRESSION | PASS — mañana parsed |
| TIME_REGRESSION | PASS — 5 de la tarde → 17:00 |
| TEST_EXACT_MESSAGE | PASS |
| TEST_SERVICE_REFINEMENT | PASS |
| TEST_NAME_TYPO | PASS |
| TEST_NAME_BOUNDARY | PASS |
| TEST_BOOKING | PASS (datetime + activeLeadId preserved) |
| BUILD | PASS (`tsc --noEmit`) |
| TESTS | PASS (`test-request-identity.mjs`, `test-p0-conversational-transaction.mjs`) |

---

## P0 / P1

- **P0:** 0  
- **P1:** 0  

---

## FINAL VERDICT

**REQUEST IDENTITY CERTIFIED**

One customer need → one HS. Service classification may evolve; request ID must not.
