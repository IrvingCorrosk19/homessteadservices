# HOMESTEAD — REQUEST CLOSURE + CALENDAR BOOKING CERTIFICATION

Date: 2026-08-26

## ROOT_CAUSE_REQUEST_NOT_CREATED

| Finding | Detail |
| --- | --- |
| **Prior behavior** | HS-* created only when `canHandoffLead()` (valid phone + problem) — often after availability/booking |
| **Client gap** | `leadId` in API response was always `null` (`shouldShowLeadBanner()` returned null) |
| **Calendar gap** | Saturated exact slot returned empty or vague message; no automatic same-day / next-day alternatives |
| **Race gap** | `create_appointment` did not re-check DB slot before insert |

---

## Architecture (after)

| Component | Implementation |
| --- | --- |
| **REQUEST_CREATION_TRIGGER** | `hasValidServiceIntent()` → `ensureActiveServiceRequest()` early in turn |
| **REQUEST_IDEMPOTENCY** | Reuse `activeLeadId` / `leadPublicId`; service change → new HS via existing mismatch rule |
| **REQUEST_FOLIO** | Real `HS-YYYY-NNNNNN` from `saveServiceRequest()` transaction |
| **CLIENT_VISIBLE_FOLIO** | API `leadId`, `requestCard`; widget status card; one-time `requestFolioIntro` message |
| **REQUEST_ONLY_FLOW** | HS persists without HA; `funnelStage=HANDOFF` while collecting |
| **REQUEST_PERSISTS_WITHOUT_APPOINTMENT** | Yes — outbox on INSERT; sync updates without new folio |

| Calendar | Implementation |
| --- | --- |
| **CALENDAR_SOURCE_OF_TRUTH** | `checkAvailability()` + `isOpenAppointmentSlot()` / SQLite |
| **EXACT_SLOT_QUERY** | `requestedAvailable`, `requestedSlotBusy` |
| **TIME_RANGE_QUERY** | `parseMinTimeFromText`, morning/afternoon window filter |
| **SATURATION** | Same-day alternatives when exact time busy |
| **ALTERNATIVE_SEARCH** | Up to 7 days forward when day full |
| **NEAREST_ALTERNATIVES** | Same-day slots before next-day jump |
| **SLOT_REVALIDATION** | `isSlotStillOpen()` before `create_appointment` |
| **DOUBLE_BOOKING_PROTECTION** | DB unique index + revalidation + `createAppointment` null on conflict |
| **DATE/TIMEZONE** | `America/Panama` via existing datetime module |

| Linking | Status |
| --- | --- |
| **APPOINTMENT_READINESS** | Unchanged deterministic gate |
| **REQUEST_TO_APPOINTMENT_LINK** | `revenue_appointments.lead_id` = HS |
| **HS / HA** | HS first; HA only after confirmed booking tool success |

---

## Failure modes

| Scenario | Behavior |
| --- | --- |
| **CALENDAR_DOWN** | Request still created; calendar uses same DB |
| **N8N_DOWN** | HS persists; outbox retries (existing) |
| **TELEGRAM_DOWN** | HS persists; notification retry (existing) |
| **RACE_CONDITION** | `slot_taken` → clear offers → instruct re-query |

---

## Golden cases (automated static + behavioral mirrors)

| Case | Result |
| --- | --- |
| **GOLDEN_REQUEST_ONLY** | PASS |
| **GOLDEN_EXACT_FREE** | PASS |
| **GOLDEN_EXACT_BUSY** | PASS |
| **GOLDEN_FULL_DAY** | PASS |
| **GOLDEN_ABANDON** | PASS |
| **GOLDEN_CHANGE_DATE** | PASS |
| **GOLDEN_DOUBLE_CONFIRM** | PASS |

---

## Gates

| Gate | Status |
| --- | --- |
| Valid service → HS persisted | PASS |
| Folio shown to client | PASS |
| Folio is real DB id | PASS |
| Request survives no appointment | PASS |
| Exact time queried | PASS |
| Busy slot → alternatives | PASS |
| No auto-book without user | PASS |
| Revalidation before HA | PASS |
| **P0** | 0 |
| **P1** | 0 |

| Ops | Status |
| --- | --- |
| **BUILD** | clean |
| **TESTS** | `test-request-closure-calendar-booking.mjs`, `test-concierge-state-machine.mjs` |

---

## FINAL VERDICT

**REQUEST + CALENDAR BOOKING CERTIFIED**
