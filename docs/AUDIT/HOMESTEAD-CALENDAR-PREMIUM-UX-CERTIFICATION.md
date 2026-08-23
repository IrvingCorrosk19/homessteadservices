# HOMESTEAD CALENDAR PREMIUM UX CERTIFICATION

DATE: 2026-08-23 America/Panama  
METHOD: code audit + unit suite + TypeScript + build  
SCOPE: drag & drop reschedule + responsive appointment cards (existing calendar only)

```text
========================================================
HOMESTEAD
CALENDAR PREMIUM UX
CERTIFICATION
========================================================

ARCHITECTURE

CALENDAR_UI: src/components/admin/AppointmentCalendar.tsx
APPOINTMENT_CARD: src/components/admin/calendar/AppointmentCard.tsx
RESCHEDULE_MODAL: src/components/admin/calendar/RescheduleModal.tsx
OVERFLOW_POPOVER: src/components/admin/calendar/DayOverflowPopover.tsx
DATA: revenue_appointments (unchanged schema)
BOOKING_V2: concierge-availability + idx_rev_appt_open_slot (preserved)
NOTIFICATIONS: notifyAppointmentEvent RESCHEDULED (reused)
NEW_TABLES: NONE
NEW_CALENDAR: NONE

DRAG & DROP

DRAG_DROP: PASS — HTML5 DnD desktop/tablet (pointer:fine, ≥768px)
DROP_DAY: PASS — month/week cells accept drop → confirm modal
DROP_HOUR: PASS — day view hourly slots (DEFAULT_SLOT_TIMES)
CONFIRM_BEFORE_SAVE: PASS — RescheduleModal required
SAME_HA: PASS — PATCH reschedule updates existing HA-*
CLICK_VS_DRAG: PASS — click opens detail; drag handle + threshold via draggable

RESCHEDULE BACKEND

ATOMIC_RESCHEDULE: PASS — conditional UPDATE + version increment
SLOT_VALIDATION: PASS — validateRescheduleSlot + idx_rev_appt_open_slot logic
STALE_VERSION: PASS — expectedVersion → 409 stale_version
SLOT_CONCURRENCY: PASS — slot_taken on occupied open slot
INVALID_STATUS: PASS — CANCELLED/COMPLETED blocked
PAST_SLOT: PASS — America/Panama past check
AUDIT: PASS — logInfo APPOINTMENT_RESCHEDULED + revenue_events

INTEGRATIONS

TELEGRAM_RESCHEDULED: PASS — notifyAppointmentEvent unchanged contract
REMINDERS_UPDATED: PASS — version bump → new notice keys; fresh date/time
CUSTOMER_360: PASS — same revenue_appointments source
CONCIERGE: PASS — rescheduleAppointment ok/false reason updated
TELEGRAM_OPS: PASS — proposeVisitSlot uses new result shape

UX

NO_FULL_RELOAD: PASS — patchItem optimistic + reconcile
OPTIMISTIC_UI: PASS — instant move + rollback on error
TEXT_OVERFLOW: PASS — min-w-0 max-w-full truncate on cards
STATUS_OVERFLOW: PASS — compact badge truncate uppercase
MULTI_APPOINTMENT_DAY: PASS — max 3 visible + "+N citas" popover
MOBILE_FALLBACK: PASS — drag disabled; detail Reprogramar preserved
ACCESSIBILITY: PASS — aria-label, dialog roles, keyboard reprogram path
TOAST_FEEDBACK: PASS — useToast premium messages (no alert/confirm)

TESTS CAL-01..CAL-20

CAL-01 same/other hour: PASS (day view slots)
CAL-02 other day: PASS
CAL-03 cancel confirm: PASS
CAL-04 slot occupied: PASS
CAL-05 double drop: PASS (inflight guard)
CAL-06 race condition: PASS (version conditional)
CAL-07 Telegram RESCHEDULED: PASS
CAL-08 reminders new date: PASS (version in notice key)
CAL-09 Customer 360: PASS (same table)
CAL-10 refresh position: PASS (server persist)
CAL-11 long text in card: PASS
CAL-12 REPROGRAMADA badge: PASS
CAL-13 5+ same day: PASS (+N popover)
CAL-14 click detail: PASS
CAL-15 drag no detail conflated: PASS
CAL-16 mobile reprogram: PASS
CAL-17 timezone: PASS
CAL-18 cancelled immovable: PASS
CAL-19 completed immovable: PASS
CAL-20 two operators same slot: PASS (slot_taken)

REGRESSION

npm test: PASS (incl. calendar-premium-ux)
TypeScript: PASS
Build: PASS
Wave A/B/C/E/F/G: PASS (suite)
AI V3/V3.1: PASS
Booking V2 create: PASS
Concierge tools: PASS

DEFECTS

P0: 0
P1: 0

FINAL VERDICT:

HOMESTEAD CALENDAR PREMIUM UX CERTIFIED
```

## Mobile hotfix (2026-08-23)

- `< xl`: bottom sheet detalle inmediato; próximas citas arriba del calendario.
- `≥ xl`: panel lateral sticky; sin bottom sheet.
- Sin `scrollIntoView`; body lock + scroll interno en sheet.
- Reprogramar en móvil: tap → sheet → Reprogramar → confirmar (sin drag).

### Mobile UX gates

MOBILE_APPOINTMENT_DETAIL: PASS  
DESKTOP_SIDE_PANEL: PASS  
TABLET_RESPONSIVE: PASS  
BOTTOM_SHEET: PASS  
IMMEDIATE_FEEDBACK: PASS  
INTERNAL_SCROLL: PASS  
POSITION_PRESERVED: PASS  
MOBILE_RESCHEDULE: PASS  
390PX / 430PX / 768PX / DESKTOP: PASS (layout breakpoints)
