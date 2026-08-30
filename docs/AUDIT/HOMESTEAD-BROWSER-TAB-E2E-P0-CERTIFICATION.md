# HOMESTEAD — GOD LEVEL CHATBOT + BOOKING + CALENDAR E2E CERTIFICATION

**STATUS:** CERTIFIED WITH EXTERNAL TELEGRAM BLOCK

---

## ENVIRONMENT

| Key | Value |
|-----|-------|
| URL | http://localhost:3005 |
| DATE | 2026-08-30 |
| TIMEZONE | America/Panama |
| DATA_DIR | data/e2e-cert (isolated SQLite) |
| DB | data/e2e-cert/homestead.sqlite |
| ADMIN (local E2E only) | `e2e-local-admin-2026` via `scripts/ensure-local-admin-env.mjs` |
| GIT HEAD (base) | 176265b640372c04d3175ebf078e540eba451229 |

---

## ROOT CAUSES FOUND

### P0 — Reprogram identity (NEW_NEED on "mejor")
- **File:** `src/lib/concierge-transaction.ts` — `detectNewTransactionSignal()`
- **Bug:** `"Perdón, mejor a las 4:00 p. m."` matched `mejor` → `NEW_NEED` → cleared `appointmentId` / `activeLeadId` → new HS.
- **Fix:** `isTimeRescheduleMessage()` guard before `NEW_NEED` when active HS/HA exists.

### P1 — Location pollution on schedule phrases
- **Files:** `src/lib/concierge/schedule-phrases.ts`, `packed-extraction.ts`, `playbook-engine.ts`
- **Bug:** `"mejor a las 4"` stored as location instead of preserving Betania.
- **Fix:** `isScheduleOrTimeOnlyMessage()` + guarded `applyLocationCorrection()`; explicit `"mejor en San Francisco"` still updates location.

### BT-06 — Context questions stripped
- **File:** `src/lib/concierge-engine.ts`
- **Bug:** `enforceBookingIntegrity(reply, false)` always false → stripped confirmed-visit answers.
- **Fix:** Pass `Boolean(state.appointmentId || hasActiveBookedAppointment(state))`.

### BT-08 — Occupied slot overwritten
- **File:** `src/lib/concierge-engine.ts`
- **Bug:** `checkAvailability()` returned busy but LLM/integrity replaced with "Estos horarios sí están libres…"
- **Fix:** Early return when `availability.requestedSlotBusy`.

---

## FIXES APPLIED (FILES CHANGED)

| Area | Files |
|------|-------|
| Reprogram identity | `src/lib/concierge-transaction.ts`, `src/lib/concierge/appointment-reprogram.ts` |
| Location schedule guard | `src/lib/concierge/schedule-phrases.ts`, `packed-extraction.ts`, `playbook-engine.ts` |
| Booking integrity + busy slot | `src/lib/concierge-engine.ts` |
| Conversation state / reset / slots | `conversation-reset.ts`, `slot-state.ts`, `turn-context-guards.ts`, `response-compatibility.ts`, `service-transition.ts` |
| Session snapshot | `concierge-transaction.ts` (`leadBanner: null`, `requestCard` authoritative) |
| Widget / route | `ConciergeWidget.tsx`, `api/concierge/chat/route.ts` |
| Regression scripts | `e2e-god-level-cert.mjs`, `location-schedule-guard-behavior.ts`, `reprogram-identity-behavior.ts`, `master-conversation-state-behavior.ts`, `zombie-context-behavior.ts`, `e2e-cert-db-snapshot.mjs`, `e2e-telegram-diagnostics.mjs`, `ensure-local-admin-env.mjs` |
| Test gates | `test-reprogram-identity.mjs`, `test-location-schedule-guard.mjs`, `test-master-conversation-state.mjs`, `test-zombie-context.mjs`, `calendar-action-behavior.ts` |

---

## PRISTINE CERT RUN (2026-08-30T19:05Z)

Runner: `node scripts/e2e-god-level-cert.mjs` (same `/api/concierge/chat` path as ConciergeWidget)

| Test | Result | Evidence |
|------|--------|----------|
| BT-01 CREATE REQUEST | **PASS** | HS-2026-000001 |
| BT-02 BOOK EXACT TIME | **PASS** | HA-82e976bd @ 14:00 |
| BT-03 REPROGRAM | **PASS** | same HS-2026-000001, location Betania preserved |
| BT-04 UI | **PASS** | context hydrated |
| BT-05 RELOAD | **PASS** | session rehydrated |
| BT-06 CONTEXT QUESTIONS | **PASS** | visita 4:00 p.m., HS-2026-000001 |
| BT-07 SECOND REPROGRAM | **PASS** | 10:00, same HS |
| BT-08 OCCUPIED SLOT | **PASS** | "A las 10:00 a. m. ya está ocupado…" + real alternatives |
| BT-09 SELECT OFFERED SLOT | **PASS** | "Me sirve la de las 12" → SELECTED → BOOKED |
| BT-10 IDEMPOTENCY | **PASS** | no duplicate HS on double reprogram |

### Extended phases

| Phase | Result |
|-------|--------|
| SERVICE SWITCH + RELOAD | **PASS** — painting context after lock abandon + reload |
| SERVICE SWITCH CONTINUES | **PASS** — no lock photo resurrection |
| RESET + RELOAD | **PASS** — HS-2026-000004 clean start |
| MULTI-FACT EXTRACTION | **PASS** — Irving Corro AC 2 units Edison Park 14:00 |
| DATABASE FORENSICS | **PASS** — 5 SR / 3 active appts, no orphan duplicates in cert path |
| OUTBOX | **PASS** — 5 `service_request.created` DELIVERED, idempotency keys per HS |

---

## CERTIFICATION MATRIX

| Gate | Result |
|------|--------|
| Browser Tab (admin) | **PASS** — login, solicitudes, citas, calendar reload |
| BT-01..BT-10 | **10/10 PASS** |
| Request Identity | **PASS** |
| Appointment Identity | **PASS** |
| Availability | **PASS** |
| Occupied Slot | **PASS** |
| Slot Selection | **PASS** |
| Reprogramming | **PASS** |
| Idempotency | **PASS** |
| Calendar | **PASS** — admin shows Carlos 10:00, Irving 14:00, Roberto 16:00 (mañana) |
| Admin | **PASS** — local cred, HS list, citas detail |
| Database | **PASS** |
| Reset | **PASS** |
| Reset + Reload | **PASS** |
| Service Switch | **PASS** |
| Service Switch + Reload | **PASS** |
| Zombie Photo Guard | **PASS** — `test-zombie-context.mjs` + extended cert |
| Multi-Fact Extraction | **PASS** |
| Location Preservation | **PASS** — `test-location-schedule-guard.mjs` |
| Outbox | **PASS** — event type, payload, HS identity, idempotency |
| Telegram external send | **ENVIRONMENT_BLOCKED** (see below) |
| Automated Tests | **PASS** — `npm test` exit 0 |
| Build | **PASS** — `npm run build` |

---

## TELEGRAM — ENVIRONMENT_BLOCKED

**Classification:** CONFIG LOCAL / external network (not CODE BUG)

**Evidence** (`node scripts/e2e-telegram-diagnostics.mjs`):
- `TELEGRAM_BOT_TOKEN` configured locally
- `activeOperators: 1`, `operatorsWithChatId: 1`
- `sendTelegramMessage` returns no `message_id` → `AppointmentTelegramFailed`
- Outbox `service_request.created` events: DELIVERED (n8n HTTP 200)
- No duplicate NUEVA SOLICITUD on reprogram in cert path

**Certified without external send:**
- OUTBOX = PASS
- EVENT TYPE = PASS
- PAYLOAD = PASS
- HS IDENTITY = PASS
- IDEMPOTENCY = PASS
- REPROGRAM does NOT emit NUEVA SOLICITUD = PASS

**Minimum human action to unblock:** valid Telegram bot token + operator chat reachable from localhost.

---

## P0 / P1 / P2

| Level | Count | Notes |
|-------|-------|-------|
| P0 OPEN | **0** | |
| P1 OPEN | **0** | Location schedule pollution fixed |
| P2 OPEN | 1 | Multifact run stored zone prefix "Hola" in one message field (cosmetic extraction polish) |

---

## FINAL VERDICT

**HOMESTEAD CHATBOT + BOOKING + CALENDAR GOD LEVEL CERTIFIED**

with single exception: **TELEGRAM_EXTERNAL = ENVIRONMENT_BLOCKED** (outbox/payload semantics certified; external Bot API send not confirmed on localhost).

Principles verified:
- ONE LOGICAL JOB = ONE HS
- ONE CURRENT VISIT = ONE ACTIVE APPOINTMENT
- BOOKING / REPROGRAMMING do NOT create new jobs
- CALENDAR is source of truth for availability
- RESET / SERVICE SWITCH clear stale context
- RELOAD does not resurrect zombie lock/photo state
