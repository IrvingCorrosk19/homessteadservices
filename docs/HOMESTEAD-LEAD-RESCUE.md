# HOMESTEAD — Lead Rescue

Detect commercial conversations that have enough data to follow up, then went silent without a booking.

## Source of truth

State lives on `revenue_leads` (Wave B columns, no separate CRM table):

- `snoozed_until`
- `dismissed_at` (lead is **not** deleted)
- `rescue_cycle`
- `rescue_alerted_at`
- `rescued_to_booking`
- existing `first_human_action_at`, `pipeline_stage`, appointments

n8n static data is not used for contacted / dismissed / snoozed / booked.

## Eligibility (deterministic, no extra OpenAI)

`isRescueEligible` in `src/lib/ops-store.ts`:

1. Valid reachable phone
2. Commercial intent: temperature HOT/WARM **or** a real service **or** problem ≥ 20 characters
3. Not booked (no open appointment, stage not SCHEDULED/WON/…)
4. `first_human_action_at` is null
5. Not dismissed, not DNC
6. Last activity older than `LEAD_RESCUE_AFTER_MINUTES` (default 15) **and** within `LEAD_RESCUE_LOOKBACK_HOURS` (default 24). Ancient backlog is not blasted in one tick.
7. Snooze expired
8. `rescue_alerted_at` empty for this cycle

Not eligible: “hola”, “gracias”, FAQ without contact, spam, already converted, already contacted, discarded.

OpenAI may already have filled intent/service on the conversation. Rescue **does not** call OpenAI again.

## Outbox

When a lead becomes rescue-eligible:

1. Persist `rescue_alerted_at` + increment `rescue_cycle` (atomic; second tick loses)
2. Event `LEAD_RESCUE_ELIGIBLE`
3. Outbox `lead.rescue_eligible:<leadId>:<cycle>`
4. Dispatcher → Telegram (TEST banner if `is_test=1`)

Idempotency is the outbox unique key plus the SQL guard on `rescue_alerted_at`.

## Admin actions

| Button | Effect |
| --- | --- |
| Contactar / WhatsApp | URL only. Does not change state. |
| ✅ Atendido | `CONTACTED` + `first_human_action_at` + audit. Idempotent if already done. Stops rescue and SLA. |
| 🕒 15 / 30 / 60 min | Persist `snoozed_until`, clear `rescue_alerted_at` so **one** later cycle can fire after expiry |
| ❌ Descartar | `dismissed_at` + pipeline LOST. Row kept. No more rescue/SLA this cycle |

## Attribution

If `rescue_alerted_at` is set and an appointment is later created, `rescued_to_booking=1` and event `LEAD_RESCUE_BOOKED`. This is **post-rescue booking**, not claimed causality.

## Scheduler

Content scheduler tick (`/api/internal/content/scheduler-tick`) runs `runOpsEngine()` then `drainAutomationOutbox()`. The old hot-lead Telegram sender no longer fires; rescue replaced it to avoid duplicate alerts.

## Health

`GET /api/admin/automation/health` exposes `lastOpsEngineAt` / `lastDailyBriefAt` / scheduler freshness.
