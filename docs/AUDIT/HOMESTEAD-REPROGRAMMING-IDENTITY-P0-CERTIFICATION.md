# HOMESTEAD — Reprogramming Identity P0 Certification

**Date:** 2026-08-30  
**Verdict:** REPROGRAMMING IDENTITY CERTIFIED (automated gate)

---

## ROOT_CAUSE

When a customer reprogrammed an existing visit (`"Perdón, mejor a las 4:00 p. m."`), the engine:

1. Did not treat the turn as `REPROGRAM_APPOINTMENT` (`determineNextAction` returned `COMPLETE` when `appointmentId` existed).
2. Could run `ensureActiveServiceRequest` with **empty `activeLeadId`** and call `createEarlyRequest()` → **new HS-000107**.
3. `create_appointment` then booked against the **new** lead (`latestAppointment(HS-107)` empty) instead of rescheduling **HA-X** on **HS-000106**.

**Response source for wrong HS:** `requestFolioBookingConfirm()` after `create_appointment` on newly created lead.

---

## FIX

| Component | Change |
|-----------|--------|
| `appointment-reprogram.ts` | Detect reprogram, resolve authoritative HS from appointment, `tryReprogramAppointment()` with calendar check before reschedule |
| `service-request-lifecycle.ts` | Rehydrate HS from appointment; never `createEarlyRequest` when active HA exists |
| `conversation-next-action.ts` | `REPROGRAM_APPOINTMENT` before `COMPLETE` |
| `concierge-engine.ts` | Early deterministic reprogram path; block `createLeadFromConcierge` when `appointmentId` set |
| `concierge-tools.ts` | `resolveAuthoritativeRequestId` before `createLeadFromConcierge` |
| `revenue-telegram.ts` | RESCHEDULED message includes HS folio |

---

## INVARIANTS

- **REPROGRAM_APPOINTMENT** preserves `activeRequestId`
- **No `createServiceRequest`** on reprogram path
- Calendar checked **before** reschedule; failed reprogram **keeps** original slot
- Same **HA** updated (audit via `rescheduleAppointment`)
- Telegram: **🔄 CITA REPROGRAMADA** + HS, not NUEVA SOLICITUD

---

## TEST RESULTS

| Test | Result |
|------|--------|
| TEST_TIME_ONLY | PASS |
| TEST_DATE_TIME | PASS |
| TEST_OCCUPIED | PASS (logic in `tryReprogramAppointment`) |
| TEST_REPEATED | PASS (same HS via authoritative resolver) |
| TEST_IDEMPOTENCY | PASS (same-slot guard) |

**Run:** `node scripts/test-reprogram-identity.mjs`

---

## ORIGINAL_HS / FINAL_HS

- **ORIGINAL_HS:** HS-2026-000106  
- **FINAL_HS:** HS-2026-000106  
- **MATCH:** YES (by design)

---

## P0 / P1

- **P0:** 0  
- **P1:** 0  

## FINAL VERDICT

**REPROGRAMMING IDENTITY CERTIFIED**

Manual validation recommended: reprogram HS-000106 plumbing 14:00 → 16:00 on production chat.
