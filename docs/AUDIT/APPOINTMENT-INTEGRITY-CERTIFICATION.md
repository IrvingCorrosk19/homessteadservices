# HOMESTEAD — APPOINTMENT INTEGRITY CERTIFICATION

**Date:** 2026-08-24  
**Severity:** P1  
**Scope:** Date integrity + visit data completeness + conversational truthfulness

---

## INCIDENT_REPRODUCED

Manual conversation:

1. User: "el 27 de este mes" → Bot offered **martes 25 ago**  
2. User: "Me sirve 2:00 p. m." → Bot confirmed visit **without** name/location/PH  
3. User: "pero sabes como me llamo donde es si es ph" → Bot: **"Gracias por la información..."** (false)

---

## ROOT CAUSES

### ROOT_CAUSE_DATE_27_TO_25

`parseNaturalDateTime()` did **not** parse calendar days (`el 27`, `el 27 de este mes`).

`checkAvailability()` then fell back to:

```ts
parsed.date ? … : addYmd(today, 1)  // tomorrow = Aug 25 when today = Aug 24
```

and expanded to `[date, date+1, date+2]` — so **25** was offered as if it were the requested day.

**Not** timezone UTC drift for this incident; **parser gap + tomorrow fallback**.

### ROOT_CAUSE_MISSING_CUSTOMER_DATA

`create_appointment` only required:

- `customerConfirmed`
- active offered slot
- lead (phone + problem via `canHandoffLead`)

Name could be empty/"Cliente web"; location/propertyType optional. No deterministic visit readiness gate.

### ROOT_CAUSE_FALSE_ACKNOWLEDGEMENT

LLM generated "Gracias por la información" on a **question** turn. No deterministic memory Q&A path; no strip for false thank-you.

---

## FIX SUMMARY

| Area | Change |
|------|--------|
| `concierge-datetime.ts` | `parseExactCalendarDay` + `exactDay` flag (este mes / el N / mes name) |
| `concierge-availability.ts` | Exact day → only that date; unavailable message; no silent substitution |
| `concierge-tools.ts` | Stale slots cleared on date change; availability filter; **readiness gate** blocks create |
| `appointment-readiness.ts` | `getAppointmentReadiness()` — name, contact, location, service, slot, property_type, PH building/unit |
| `memory-truth.ts` | Deterministic answers to name/location/PH questions; strip false thank-you |
| `concierge-engine.ts` | Memory handler before LLM; readiness in system state; strip false thank-you |
| `packed-extraction.ts` | PH/building/tower/unit; `mejor no` abandons current service intent |
| `service-playbooks.ts` | decorar / renovación aliases |
| `concierge-handoff.ts` | Persist building/unit in request message |

---

## CERTIFICATION MATRIX

| Check | Status |
|-------|--------|
| DATE_TIMEZONE | America/Panama via `businessTimezone()` / `todayInPanama` |
| DATE_PARSER | **PASS** — `el 27 de este mes` → `2026-08-27` |
| STALE_SLOTS | **PASS** — date change clears `offeredSlots` |
| APPOINTMENT_READINESS_GATE | **PASS** — `missing_visit_data` |
| REQUIRED_FIELDS | name, contact, location (not weak city-only), service, slot, property_type; building+unit if PH/apartment |
| OPTIONAL_FIELDS | email, photos, enrichment facts |
| NAME_CAPTURE / CONTACT / LOCATION / PROPERTY / PH / UNIT | **PASS** (extraction + gate) |
| DIRECT_MEMORY_QUESTION | **PASS** (deterministic) |
| UNKNOWN_DATA_TRUTHFULNESS | **PASS** |
| NO_FALSE_THANK_YOU | **PASS** |
| SERVICE_CONTEXT / ABANDONED_INTENT | **PASS** (`mejor no` + decorar aliases) |
| FINAL_CONFIRMATION | Still required (`customerConfirmed`) **and** readiness |
| APPOINTMENT_CREATED_ONLY_WHEN_READY | **PASS** |
| EXACT_DATE_27 | **PASS** (static) |
| UNAVAILABLE_DATE | **PASS** (code path) |
| STALE_SLOT | **PASS** |
| MISSING_NAME / LOCATION / PH / HOUSE | **PASS** (static readiness) |
| BUILD | **PASS** |
| TESTS | `test-appointment-integrity.mjs` 20/20 **PASS** |

| Priority | Count |
|----------|-------|
| P0 | 0 |
| P1 | 0 (remediated) |
| P2 | Live E2E golden path on production recommended |
| P3 | 0 |

---

## FINAL VERDICT

### **APPOINTMENT INTEGRITY CERTIFIED**

(code + static gate; recommend one live golden E2E on staging/prod after deploy)

Hard gates for silent 27→25, confirm without visit data, and false thank-you on memory questions are closed.
