# HOMESTEAD — Telegram Command Center

Mobile operations for the existing Homestead bot. SQLite is the source of truth. n8n stays orchestration. Telegram is the authorized admin surface.

## One bot, one inbound webhook

- Bot: `@HomesteadServicesNotifyBot`
- Inbound webhook: `https://n8n.autonomousflow.lat/webhook/homestead-content-studio`
- Homestead handler: `POST /api/internal/content/telegram-update` → `handleTelegramUpdate`

Wave B does **not** register a second bot, a second Telegram Trigger, or a second webhook.

```text
Telegram Update
  → single webhook (Content Studio path)
  → Homestead authorization (chat_id + user_id allowlist)
  → update_id dedupe
  → command / callback router
  → Homestead SQLite APIs
  → editMessageText / compact reply
```

## Commands

| Command | Behavior |
| --- | --- |
| `/homestead` | Command Center home (counts from SQLite, `is_test=0` by default) |
| `/hoy` | Today's agenda (America/Panama) |
| `/leads` / `/calientes` | Rescue / opportunities list |
| `/agenda` | Same agenda view as `/hoy` |
| `/publicar` | Content Studio (unchanged) |

Natural language such as “qué tengo pendiente” still opens the Command Center.

## Callbacks

Compact, no PII in `callback_data` (Telegram 64-byte limit):

- `cc:h` home · `cc:h:1` include test canaries
- `cc:r:0` requests page · `cc:d:HS-…` request detail · `cc:c:HS-…` mark contacted
- `cc:l:0` rescue list · `cc:e:HS-…` rescue detail · `cc:x:HS-…` dismiss · `cc:z:HS-…:15` snooze
- `cc:a:0` agenda day offset · `cc:n` next 7 days · `cc:g:HA-…` appointment detail
- `cc:m` marketing pending · `cc:s` today summary

Opening `tel:` or `wa.me` does **not** mark contacted. That requires `✅ Atendido`.

Admin links use real routes: `/admin/solicitudes/HS-…` and `/admin/citas`. Appointments cannot be cancelled from Telegram in Wave B.

## Authorization

`HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS` is the allowlist. Both `chat.id` and `from.id` are checked server-side. Username is ignored. Unauthorized users receive `No autorizado.` with no customer data.

Command Center remains available even if Content Studio is disabled. Content Studio photo/job paths still require `CONTENT_STUDIO_ENABLED`.

## Data APIs (n8n must not query SQLite)

Protected by Wave A internal auth (shared secret + timestamp ±300s). HMAC is verified only if `X-Homestead-Signature` is present. n8n 2.3.6 cannot HMAC the live payload; that is not faked.

- `GET /api/internal/ops/summary`
- `GET /api/internal/ops/lists?kind=requests|rescue|appointments|upcoming`
- `POST /api/internal/ops/action` `{ action: contacted|snooze|dismiss|tick|brief, entityId?, minutes? }`

Default lists and `/homestead` **exclude** `is_test=1`. Use “Ver pruebas” or `?test=1` during E2E.

## n8n decision

**No new Homestead workflow in Wave B.** Ops alerts (`lead.rescue_eligible`, `sla.first_response`, `sla.escalation`, `daily.brief.ready`) go Wave A outbox → dispatcher → Homestead Telegram Bot API (`deliverOpsTelegram`). `service_request.created` still posts the v1 payload to the existing n8n request workflow.

`AUTOMATION_N8N_FAIL=true` still fails every dispatcher send so the “n8n down” canary remains valid.

## Quiet hours

Default 22:00–07:00 America/Panama (`OPS_QUIET_START_HOUR` / `OPS_QUIET_END_HOUR`). Only **INFO** (daily brief) is deferred via `next_attempt_at`. ACTION/WARNING (rescue, SLA) and CRITICAL webhook drift skip quiet hours.

## UX rules

- Counts come from Homestead/SQLite, not n8n static data.
- Pagination default 5. Drill-down + `editMessageText`.
- Operator-facing errors are Spanish and non-technical.
- No invented revenue. Conversion % only if today has at least 3 requests.
