# HOMESTEAD — P0 Conversational Transaction Engine Certification

**Date (UTC):** 2026-08-27  
**Scope:** Opportunity → HS Request → HA Appointment remediation (not a feature add)

---

## ROOT_CAUSE

Reproduced with `scripts/repro-p0-tx.ts` against real modules **before** fixing.

### ROOT_CAUSE_MULTI_FACT_LOSS

1. **`parseNaturalDateTime` truncated input to 120 chars before parsing.**  
   Case B message lost `"para mañana a las 2 pm"` → `preferredDate`/`preferredTime` empty.
2. **Trailing name not extracted** without `soy` / `me llamo`.
3. **`apartamento 3 a`** only captured unit `"3"` (space broke letter suffix).
4. **`resolvePrimaryFromMessage` preferred generic `repairs`** over `ac` when text contained “reparación … aire acondicionado”.

### ROOT_CAUSE_LOCATION_LOOP

1. After `PH El Mare` without unit, `isLocationSufficient=false` put **`location` in missing** even when zone was already known → canned question became “¿En qué zona…?” while true ask was unit (`firstMissingQuestion` used `missingFields[0]` not `askField`).
2. Zone known + PH incomplete must ask **unit only**, not re-ask zone.

### ROOT_CAUSE_SLOT_LOOP

1. Exact user datetime was treated as **missing slot** until `offeredSlots` existed → “¿Qué día y hora te quedan mejor?”
2. Selecting a slot then collecting name could re-enter availability UX (prior path); fixed with `lockSelectedSlot` + `isSlotConfirmed` + no re-offer.

### ROOT_CAUSE_HS_NOT_RETURNED

Lifecycle `ensureActiveServiceRequest` already exists (request-first). Failure to complete booking made HS feel “missing” to the client when conversation looped. After fix, Case B reaches `CHECK_AVAILABILITY` with HS creatable on actionable intent.

### ROOT_CAUSE_TELEGRAM_PARTIAL

Telegram showed **💬 WhatsApp** via `customerWhatsAppUrl` even though public WhatsApp is disabled (`NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED`). Gated with `isPublicWhatsAppEnabled()`.

---

## OPPORTUNITY_MODEL / REQUEST_MODEL / APPOINTMENT_MODEL

| Concept | Meaning | Persistence |
|---------|---------|-------------|
| OPPORTUNITY | Soft commercial interest | revenue lead / marketing (existing) |
| REQUEST (HS) | Actionable service need | `service_requests` via `ensureActiveServiceRequest` |
| APPOINTMENT (HA) | Calendar-confirmed visit | `revenue_appointments` after revalidation |

**Invariant:** HS does not require HA. HA requires HS + real slot.

---

## HS_CREATION / HS_IDEMPOTENCY / HS_CLIENT_DISPLAY

- `hasValidServiceIntent` + `ensureActiveServiceRequest` (existing)
- Same `activeLeadId` updated in place
- Folio announced once; memory Q&A can return real HS from state/DB

---

## MULTI_FACT_EXTRACTION

Packed extraction + `mergeParsedWhen` on **full** message:

- service AC, Edison Park, apt 3A, mañana→date, 14:00, Irving Corro, phone VALID

## CANONICAL_MAPPING

- `location` / `facts.location` = zone  
- `facts.building` / `facts.ph` = building  
- `facts.unit` / `facts.apartment` = unit  
- `preferredDate` + `preferredTime` = requested when  
- `pendingSlot` + `facts.slotConfirmed` = selected slot  

## SAFE_STATE_MERGE

`mergeConfirmedFacts` / null-safe LLM merge (prior P0) retained.

## READINESS_ENGINE

- `hasRequestedExactWhen()` → slot not missing for **asking** date/time again  
- Zone known → do not put `location` in missing when only unit/building incomplete  
- Apartment: zone + unit enough without building name  

## NEXT_ACTION_ENGINE

- Exact when complete → `CHECK_AVAILABILITY` (not “qué día y hora”)  
- Slot locked → `CONFIRM_OR_BOOK`  
- `firstMissingQuestion(askField)` aligns canned text with true ask  

---

## DATE_RESOLUTION / TIME_RESOLUTION

- Full-text parse (2000 chars)  
- `mañana` → next Panama business day  
- `2 pm` / `2:00 p. m.` → `14:00`  

## EXACT_SLOT_QUERY / SLOT_SELECTION / SLOT_PERSISTENCE / REVALIDATION / BOOKING

- Engine queries exact when; if free → `EXACT_SLOT_LOCKED`  
- Text “Me sirve 10/12/2:00” → `lockSelectedSlot`  
- Survives subsequent name/unit turns  
- Booking only via `create_appointment` + calendar revalidation  

---

## TELEGRAM_OPEN_REQUEST / TELEGRAM_BOOKED_APPOINTMENT / WHATSAPP_ACTION_REMOVED

- Existing outbox/lifecycle for HS vs HA preserved  
- WhatsApp button hidden unless `NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED=true`  

---

## TESTS

| Test | Result |
|------|--------|
| TEST_SINGLE_MESSAGE (Case B) | PASS → CHECK_AVAILABILITY, no date/time ask |
| TEST_LOCATION_PERSISTENCE | PASS |
| TEST_SLOT_10 / 12 / 14 | PASS |
| TEST_COMPLETE_BOOKING (unit+name after slot) | PASS |
| Prior state-machine suite | PASS |

Commands:

```bash
npx tsc --noEmit
node scripts/test-p0-conversational-transaction.mjs
node scripts/test-concierge-state-machine.mjs
npm run build
```

All PASS.

---

## FILES_CHANGED

- `src/lib/concierge-datetime.ts` — full-text datetime parse  
- `src/lib/concierge/packed-extraction.ts` — name trailing, unit `3 a`  
- `src/lib/concierge/appointment-readiness.ts` — exact when, zone-known, apartment gate  
- `src/lib/concierge/conversation-next-action.ts` — CHECK_AVAILABILITY path, canned by askField  
- `src/lib/concierge/service-intent.ts` — AC over generic repairs  
- `src/lib/concierge-engine.ts` — exact slot lock + TURN_EXTRACT logs  
- `src/lib/ops-telegram.ts` / `revenue-telegram.ts` — WhatsApp gated  
- `scripts/repro-p0-tx.ts`, `p0-tx-behavior.ts`, `test-p0-conversational-transaction.mjs`  

---

## P0 / P1

| Severity | Count |
|----------|-------|
| P0 | 0 |
| P1 | 0 |

---

## FINAL VERDICT

# CONVERSATIONAL TRANSACTION ENGINE CERTIFIED

- Concrete need → HS (request-first preserved)  
- Exact date/time → calendar query, **not** re-ask  
- Slot selection survives follow-up facts  
- Known zone not re-asked when only unit missing  
- LLM is not the state machine  

**Deploy note:** Changes are local until deployed to VPS.
