# HOMESTEAD — Smart SLA

Commercial first-response SLA for **NEW** service requests. This is not a system-error alert.

## Config (not scattered)

| Env | Default | Meaning |
| --- | --- | --- |
| `SLA_FIRST_RESPONSE_MINUTES` | 15 | First warning |
| `SLA_ESCALATION_MINUTES` | 30 | One escalation after first alert |
| `LEAD_RESCUE_AFTER_MINUTES` | 15 | Rescue inactivity (separate engine) |
| `DAILY_BRIEF_HOUR` | 8 | Daily brief, America/Panama |
| `OPS_QUIET_START_HOUR` / `OPS_QUIET_END_HOUR` | 22 / 7 | Defers INFO only |

## When SLA applies

Only `service_requests.status = 'NEW'` and snooze expired.

Stops when the request is marked CONTACTED / IN_PROGRESS / COMPLETED / CANCELLED, or snoozed.

## Alerts

1. First: `⏱ SOLICITUD PENDIENTE` — outbox key `sla.first:<publicId>`
2. Escalation: `⚠️ SOLICITUD REQUIERE ATENCIÓN` — `sla.escalation:<publicId>`

Each SQL update is `WHERE column IS NULL`. A second scheduler tick cannot duplicate. There is no repeating every 10 minutes.

Columns: `sla_first_alerted_at`, `sla_escalated_at`, `snoozed_until`.

## Daily brief

At `DAILY_BRIEF_HOUR` America/Panama the ops engine enqueues `daily.brief:<YYYY-MM-DD>` once. Quiet hours delay INFO until 07:00. Counts match Command Center (live, `is_test=0`).

Force canary: `POST /api/internal/ops/action` `{ "action": "brief" }` still cannot send twice for the same Panama date.

## Priority

- Daily brief = INFO
- Lead rescue = ACTION
- SLA = WARNING
- Telegram webhook drift = CRITICAL (existing integrity check)
