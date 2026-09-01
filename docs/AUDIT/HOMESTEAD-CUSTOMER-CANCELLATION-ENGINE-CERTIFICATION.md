# HOMESTEAD — CUSTOMER CANCELLATION ENGINE CERTIFICATION

Date: 2026-08-31

## STATUS

**CERTIFIED** (isolated / local)

Production deployment: **NOT PERFORMED**

P0 OPEN: **0**  
P1 OPEN: **0**

---

## ROOT CAUSE / GAP

| Gap | Prior behavior | Fix |
| --- | --- | --- |
| No customer HS cancel tool | Only `cancel_appointment` + implicit HS cancel via reset/switch/admin | `cancelServiceRequest` + `cancel_service_request` tool + engine intercept |
| RESET cancelled HS | `applyFullConversationReset` defaulted to cancel HS | Default **does not** cancel HS; engine passes `cancelExistingHs: false` |
| HS cancel left HA occupying calendar | `updateRequestStatus("CANCELLED")` did not cancel open HA | Same SQLite transaction: cancel open HA then HS |
| No HS cancellation metadata | Jobs had `cancelled_at`; HS did not | `cancelled_at`, `cancelled_by`, `cancellation_reason`, `cancellation_source`, `cancellation_reason_category` |
| No outbox/Telegram for HS cancel | Only `service_request.created` | `service_request.cancelled` outbox + dedicated Telegram fan-out |
| Intent collapse | One cancel/abandon regex mixed reset, switch, cita, HS | Distinct intent kinds in `cancellation-intent.ts` |
| Booking after cancel | `createAppointment` did not revalidate HS lifecycle | `isRequestEligibleForAppointment` in create + reschedule |
| Timeline | Status on create/booked rows only | `REQUEST_CANCELLED` + `APPOINTMENT_CANCELLED` in Customer 360 |

Reuse (not a parallel architecture): existing HS `CANCELLED` status, `setAppointmentStatus`, calendar open-status exclusion, outbox idempotency keys, appointment Telegram notice keys, copilot confirm-before-cancel for operations.

---

## DOMAIN MODEL

| Identity | Role |
| --- | --- |
| **HS** | Service request / job identity (`service_requests.public_id`) |
| **HA** | Appointment / visit identity (`revenue_appointments.appointment_id`) |
| **Calendar** | Authoritative SQLite rows with open statuses `REQUESTED\|PROPOSED\|CONFIRMED\|RESCHEDULED` |

Normal cancellation is a **status transition**. The HS row remains. No `DELETE FROM service_requests` on the cancellation path.

---

## INTENT MODEL

Classifier: `src/lib/concierge/cancellation-intent.ts`

| Kind | Example |
| --- | --- |
| CANCEL_REQUEST | "cancela mi solicitud", "ya no quiero el servicio" |
| CANCEL_APPOINTMENT_ONLY | "cancela la cita", "no necesito la cita… pero mantén la solicitud" |
| RESCHEDULE_APPOINTMENT | "no puedo mañana, mejor el viernes" |
| DELETE_DATA_REQUEST | "quiero que eliminen mis datos personales" |
| RESET_CONVERSATION | "olvida todo" |
| END_CONVERSATION | "gracias, eso es todo" |
| SWITCH_SERVICE | "olvidemos la cerradura, mejor necesito pintura" |
| REJECT_SLOT | "no quiero esa hora" |
| AMBIGUOUS_TOMORROW | "mañana no" (with booked HA) |
| AMBIGUOUS_CANCEL_TARGET | "cancélalo" with both HS and HA |
| NONE | bare "no" (unless last question was explicit cancel confirm) |

LLM may interpret language. Backend validates target, ownership, and lifecycle.

---

## REQUEST CANCELLATION

`cancelServiceRequest({ requestId, actor, source, reason?, idempotencyKey?, notify? })`

- Target from `activeLeadId` / conversation ownership / explicit `HS-YYYY-NNNNNN` with phone/session check
- Multiple open requests without context → one clarification question
- Foreign HS → denied, no disclosure
- COMPLETED → not rewritten
- Already CANCELLED → idempotent success, no second outbox/Telegram
- Reason optional (`NOT_PROVIDED` if absent)
- After success: conversation `activeLeadId` cleared, slots/photos/pending actions invalidated

---

## APPOINTMENT-ONLY CANCELLATION

`cancelAppointmentOnly` → HA `CANCELLED`, HS remains `NEW`/`CONTACTED`/`IN_PROGRESS`.

Telegram: `📅 CITA CANCELADA` + "Solicitud continúa activa."

---

## RESCHEDULE DISTINCTION

Existing `tryReprogramAppointment` / `rescheduleAppointment` preserved. Same HS. Wording "mejor el viernes" is not HS cancel.

If HS is already CANCELLED, reprogram returns `invalid_status`.

---

## RESET DISTINCTION

`olvida todo` → conversation reset only. Historical HS stays OPEN unless the customer later issues a business cancel.

---

## DELETE-DATA DISTINCTION

Personal-data erasure is routed for human handling. No automatic HS hard delete. No automatic HS cancel.

"Elimina mi solicitud" is treated as operational cancel (soft), with a short trazability explanation.

---

## TRANSACTION SAFETY

SQLite transaction on the Homestead DB:

1. Re-read HS  
2. Reject COMPLETED  
3. Idempotent if already CANCELLED  
4. `setAppointmentStatus(CANCELLED)` for every open HA  
5. Update HS metadata  
6. Pipeline `CANCELLED` + revenue event  
7. Resolve autonomous signals  
8. Enqueue outbox (`idempotency_key = service_request.cancelled:{HS}`)

Partial failure cannot leave HS CANCELLED with HA still OPEN: HA is cancelled first inside the same transaction.

---

## CALENDAR RELEASE

Availability still reads DB open statuses. After HA cancel, `isOpenAppointmentSlot` returns free. No frontend slot-array mutation.

---

## IDEMPOTENCY

Outbox unique `service_request.cancelled:{publicId}`. Repeat customer message / retry → `alreadyCancelled: true`, same event identity.

Appointment Telegram still uses `claimAppointmentNotice`.

---

## RACE TESTS

| Case | Result |
| --- | --- |
| CANCEL-19 book after HS cancel | `createAppointment` returns null |
| CANCEL-20 reprogram after HS cancel | `rescheduleAppointment` fails |
| Concurrent cancel | Second call idempotent |

---

## TELEGRAM

| Event | Copy |
| --- | --- |
| HS cancelled | `❌ SOLICITUD CANCELADA` + HS + service + reason + linked HA ids |
| HA only | `📅 CITA CANCELADA` + HS + HA + "Solicitud continúa activa." |

No WhatsApp. No extra PII in the HS-cancel payload (no customer name/phone). Dispatch disabled in tests; production drain uses fan-out.

HS cancel does **not** also send the appointment-only Telegram (one logical event).

---

## OUTBOX

| eventType | idempotencyKey |
| --- | --- |
| `service_request.cancelled` | `service_request.cancelled:{HS}` |
| `appointment.cancelled` | `appointment.cancelled:{HA}` |

---

## AUDIT TRAIL

HS columns + `revenue_events.SERVICE_REQUEST_CANCELLED` + outbox envelope (actor, source, reason category, timestamp, conversation id when safe).

---

## CUSTOMER360

Timeline types `REQUEST_CANCELLED` and `APPOINTMENT_CANCELLED`. Cancelled HS remains listed; it does not disappear.

---

## OPERATIONS AI

`get_request_detail` now returns `cancelledAt`, `cancellationReason`, `cancellationSource`, `cancellationReasonCategory`, and `cancellationNote`. If no reason: "El cliente canceló la solicitud. No se registró un motivo."

Ops write path unchanged: `propose_cancel_appointment` still requires confirmation. Customer self-cancel does not weaken that gate.

---

## AUTONOMOUS

On HS cancel, signals `APPOINTMENT_UPCOMING`, `APPOINTMENT_TODAY`, `CUSTOMER_WAITING`, `REQUEST_WITHOUT_NEXT_STEP`, `REQUEST_AGING`, `REQUIREMENT_MISSING_BEFORE_VISIT` for that `request_id` are resolved. Detector SQL also skips cancelled HS. Historical rows remain.

---

## BROWSER

Isolated `conciergeTurn` (same engine as `/api/concierge/chat`) with real SQLite:

- HS + future HA + "Ya resolví el problema, cancela la solicitud." → grounded cancel, same folio, HA cancelled  
- Appointment-only wording → HA cancelled, HS active  
- "mañana no" → clarification, no mutation  
- "olvida todo" → reset, HS not cancelled  
- Digital-lock photo pending → cancel, no photo follow-up  
- Offered slots → cancel, `awaitingSlotSelection` false  

Live production UI was **not** exercised (no production deployment; no production Telegram).

---

## MOBILE

Admin cancelled-request metadata uses the existing card layout (`rounded-2xl`, wrapping text). Customer widget after cancel clears booking/photo CTAs via session snapshot. No production 390×844 pass against live data.

---

## REGRESSIONS

| Suite | Result |
| --- | --- |
| `npm test` (includes BT/AI/ADV, request+calendar, state machine, ops, autonomous, waves) | **PASS** |
| `npm run build` | **PASS** |
| Customer cancellation matrix | **PASS** |

---

## DB ASSERTIONS (isolated DATA_DIR)

Cancelled HS exists with `CANCELLED`, metadata set, HA cancelled when linked, slot free, outbox one row per HS, no orphan open HA on cancelled HS.

---

## P0 / P1

| Gate | Status |
| --- | --- |
| Wrong customer HS | Denied (CANCEL-15) |
| Hard delete | Absent on cancel path |
| Cancelled HS + active HA | Prevented by transaction (CANCEL-02) |
| Calendar blocked | Released (CANCEL-03) |
| New HS during cancel | Not created |
| Completed rewritten | Blocked (CANCEL-16) |
| Stale book after cancel | Blocked (CANCEL-19) |
| Duplicate Telegram | Outbox idempotency (CANCEL-12) |
| Reason required | No (CANCEL-05) |

**P0 OPEN: 0**  
**P1 OPEN: 0**

---

## FILES CHANGED

**New**

- `src/lib/service-request-cancellation.ts`
- `src/lib/concierge/cancellation-intent.ts`
- `src/lib/concierge/cancellation-conversation.ts`
- `scripts/customer-cancellation-behavior.ts`
- `scripts/customer-cancellation-db.ts`
- `scripts/test-customer-cancellation-engine.mjs`
- `docs/AUDIT/HOMESTEAD-CUSTOMER-CANCELLATION-ENGINE-CERTIFICATION.md`

**Modified**

- `src/lib/service-requests.ts` — cancellation columns, eligibility, customer open-request list  
- `src/lib/concierge-engine.ts` — intercept + RESET without HS cancel  
- `src/lib/concierge-tools.ts` — `cancel_service_request`, hardened cancel/book/reschedule  
- `src/lib/concierge/tool-registry.ts`  
- `src/lib/concierge/conversation-reset.ts`  
- `src/lib/concierge/service-transition.ts` — switch/abandon uses central cancel (HA release)  
- `src/lib/concierge/conversation-perception.ts`  
- `src/lib/concierge/referential-resolver.ts`  
- `src/lib/revenue-store.ts` — book/reschedule lifecycle gate  
- `src/lib/revenue-telegram.ts` — appointment-only copy  
- `src/lib/telegram-fanout.ts`  
- `src/lib/automation-dispatch.ts`  
- `src/lib/customer-360.ts`  
- `src/app/api/admin/service-requests/[requestId]/route.ts`  
- `src/lib/copilot/tools.ts`  
- `src/lib/autonomous/detectors.ts`  
- `src/components/admin/RequestDetailClient.tsx`  
- `package.json` — test script includes cancellation matrix  

---

## DEPLOYMENT STATUS

**NOT PERFORMED.** Code is certified in isolated/local tests only. Owner independent review is required before production.

---

## FINAL VERDICT

Customers can safely cancel a Homestead service request without deleting business history. When a request is cancelled, any active future appointment is cancelled and calendar capacity is released. Appointment-only cancellation does not cancel the HS. Rescheduling, reset, service switch, end-chat, and data-deletion requests are distinct intents. The backend remains the business authority.
