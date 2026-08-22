# HOMESTEAD AUTOMATION ENGINE — Premium Architecture V2

STATUS: **PROPOSAL ONLY** — do not implement until `HOMESTEAD AUTOMATION V2 — IMPLEMENTATION`.  
SOURCE: `docs/AUDIT/HOMESTEAD-N8N-MASTER-AUTOMATION-AUDIT.md` (2026-08-22).

Principle:

```text
HOMESTEAD / SQLite  =  source of truth
n8n                 =  orchestration (webhooks, timers, Telegram proxy)
Telegram            =  mobile Command Center (one bot, admin allowlist)
OpenAI              =  conversation + content when a human or tool asked
```

Premium means: fast, true, few steps, little noise, recoverable. Not 40 workflows.

---

## CURRENT STATE

```text
                    HOMESTEAD SQLite
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
     Form/Chat          Appointments      Content jobs
        │                  │                  │
        ▼                  ▼                  ▼
   n8n request WF    Homestead Bot API    n8n Content Studio
   🔔 solicitud      📅 cita / reminder   (Telegram inbound)
        │                  │                  │
        └──────────── Telegram bot ───────────┘
                           ▲
                           │
              n8n scheduler 10 min (clock for reminders)
```

Gaps: no outbox, inbound Telegram dies with n8n, BrokerPro telegramTrigger latent conflict, marketing ticks with no Meta.

---

## PREMIUM TARGET STATE

```text
                         HOMESTEAD
                      SOURCE OF TRUTH
                     (SQLite + files)
                            │
                    persist business row
                            │
                    automation_outbox
                     (event envelope)
                            │
                            ▼
                   dispatcher (Homestead)
                      retry / replay
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
            n8n           email         Telegram
         (optional)                    (direct OK)
              │
              ▼
     HOMESTEAD AUTOMATION
            ENGINE
              n8n
              │
    ┌─────────┼──────────┐
    ▼         ▼          ▼
 timers    proxy      future
 10 min   Telegram    events
    │
    ▼
 COMMAND CENTER  /homestead
    │
 ┌──┼────┬──────┬─────────┐
 ▼  ▼    ▼      ▼         ▼
LEADS AGENDA JOBS CONTENT STATUS
```

n8n stays. Homestead may send Telegram **directly** for ACTION alerts so `n8n down ≠ operator blind` for citas (already true) and, after Wave A, for solicitudes.

---

## Event envelope (do not implement yet)

```json
{
  "eventId": "uuid",
  "eventType": "service_request.created",
  "version": 1,
  "occurredAt": "2026-08-22T12:47:45.746Z",
  "correlationId": "HS-2026-000031",
  "idempotencyKey": "service_request.created:HS-2026-000031",
  "data": {}
}
```

Keep existing webhook path `/webhook/homestead-service-request` as **v1**. Add `/webhook/homestead/v2` later; do not break v1.

Security compatible with n8n 2.3.6: continue `$vars` shared secret + timestamp; add HMAC verification when a node can do it, **and** always verify HMAC on Homestead inbound. Replay window 300s + idempotency key in SQLite (not static data).

Webhook versioning: v1 frozen; new event types get v2 path or `eventType` discriminator on the same secret.

---

## Telegram Command Center (`/homestead`)

**Do not create a second bot.** Extend `content-handler.ts` behind the existing webhook.

Security: `isTelegramAdmin` only. Never list phones to a non-allowlisted chat. Paginate. Mobile-first: 8–12 lines + buttons, not 200 lines.

```text
HOMESTEAD
Command Center

Solicitudes nuevas: N
Citas hoy: N
Leads pendientes: N
Trabajos activos: N
Contenido pendiente: N

[Solicitudes] [Agenda]
[Leads]       [Trabajos]
[Marketing]   [Resumen]
```

Drill-down reuses existing formatters (`formatHoy`, `formatLeads`, appointment keyboards). `/status` is a separate compact health card (no OpenAI).

Callback security: keep prefixes `cs:` `rv:` `hs:` parsed server-side; ignore forged job IDs; re-check admin on every callback.

Alert taxonomy:

| Level | Examples | Interrupt? |
| --- | --- | --- |
| INFO | weekly report, marketing shadow | quiet hours |
| ACTION | new request, unbooked hot lead, cita 2h | yes |
| WARNING | n8n retry exhausted, OpenAI content fail | yes |
| CRITICAL | webhook stolen, Homestead 5xx, DB integrity | yes always |

Quiet hours: configurable; ACTION solicitudes still notify; INFO deferred to `/homestead` morning card.

---

## Lead rescue (no spam)

Already computed: `listUnattendedHotLeads` + `HOT_LEAD_ATTENTION_MINUTES=30` + `runHotLeadReminders` on the 10-min tick.

Design: one ACTION message per lead per window; buttons Contactar / WhatsApp / Atendido; skip `is_test`, `doNotContact`, dry-run. Do **not** message the customer automatically (`AUTO_FOLLOW_UP` stays false until consent/channel exists).

Detection: conversation or request with phone + service, no CONFIRMED appointment, stage not WON/LOST.

---

## SLA engine

Do not poll SQLite every 10s. Use the existing 10-min tick **or** `setTimeout` is wrong across processes — use due timestamps:

`NEW` after X minutes → ACTION reminder. `CONTACTED` → cancel (`claim` row / `hot_reminded_at` already exists). Config env, not hardcoded 10/30 without reason. Default start: 15 / 45 minutes, operator-editable later.

---

## Appointment reminders

**Already implemented.** Offsets `24h,2h`. Internal Telegram only. Do not add customer SMS/WhatsApp. Do not add a second n8n reminder workflow.

Wave B work is **certify + Homestead fallback clock**, not a new product.

Conflict: add a unique open-slot guard in `createAppointment` (all leads), matching `checkAvailability`.

Technician `appointment.assigned`: column already sketched (`assigned_to`); do not build dispatch UI now.

---

## Daily / end-of-day brief

`/hoy` already pulls SQLite. n8n daily-briefing JSON should **not** be imported while `REVENUE_BRIEFING_SEND=false`.

Optional Wave C: one scheduled `/homestead` morning card from Homestead dispatcher (not a new n8n WF) if operators want push vs pull. End-of-day: useful only if someone closes the day in Telegram; otherwise `/hoy` suffices.

---

## Follow-up / reviews / content loop

```text
JOB COMPLETED → thank-you (only if consented channel)
             → wait reasonable period
             → ask satisfaction internally first
             → if positive AND review URL configured → facilitate (never fake)
             → if photos → Telegram "¿Crear contenido?" → Content Studio PROCESAR
```

Blockers today: `AUTO_FOLLOW_UP=false`, no review URL, revenue dry-run, few/no WON jobs in evidence. **Do not build customer spam.** Content loop is Wave D after job completion is a real operator action.

---

## Customer 360 / sales / conversation intelligence

Match on **phone E.164** or `hs_cid` / `lead_id`, never name-only fuzzy.

Funnel: leads / contacted / booked / completed / lost from SQLite + `concierge_intelligence` (no chain-of-thought). Lost-lead weekly summary only if `drop_off_stage` / objections are populated enough; otherwise say unknown.

Marketing attribution CONTENT → LEADS: only with `hs_ref=HC-…` already on the form. Do not invent.

---

## Health monitor / dead letter / observability

Health workflow: HTTP GET Homestead `/`, n8n `/healthz`, Telegram `getWebhookInfo` (URL must remain content-studio), SMTP optional connect, SQLite integrity. **No OpenAI ping.**

Dead letter = outbox `status=FAILED` after N attempts. Replay command: resend notification **without** creating a second HS/HA/HC row.

Correlation: `correlationId = folio | appointmentId | contentId`. Logs already have `requestId` / `contentJobId`. Add `eventId` when outbox exists.

Audit trail (business, not n8n noise): created, contacted, booked, rescheduled, cancelled, completed, content approved. Revenue events table already stores many of these.

---

## AI routing / cost

| Task | Model | Rule |
| --- | --- | --- |
| Chat | gpt-4o (keep) | env `OPENAI_CONCIERGE_MODEL` |
| Content copy | gpt-4o | only on PROCESAR |
| Images | gpt-image-1 | only on PROCESAR / reimage |
| Classification / dates | **code** | already concierge-datetime |
| Health | **code** | never LLM |

Guardrails: Content Studio already waits for PROCESAR. Chat is the cost center; rate limit already required by V2. Do not add n8n OpenAI nodes.

---

## Naming / tags / folders (n8n 2.3.6)

n8n 2.3 has `folder` + `tag_entity` + `project`. Currently unused.

Propose (rename later, not now):

```text
HS — EVT — Service Request Created
HS — TG — Telegram Inbound Proxy
HS — SYS — Scheduler Tick
HS — MKT — Analytics Collect
HS — MKT — Weekly Report
```

Tags: `homestead` `production` `telegram` `marketing` `system`.

BrokerPro: tag `brokerpro` `inactive` — never mix in Homestead folder.

Subworkflows only if reused twice: Send Telegram is **already split** (n8n HTTP vs Homestead helper). Do not wrap everything.

Workflow size: request WF 12 nodes + large Code — candidate to shrink by moving validation to Homestead. Others are 2–5 nodes: leave them.

---

## Database load

Do not add n8n polling every minute. 10-min tick is enough. Prefer outbox drain on request path (event) plus the existing tick.

---

## Premium customer journey × automation

| Stage | Opportunity | Trigger | Data | Action | Value |
| --- | --- | --- | --- | --- | --- |
| Discovery | none extra | — | — | site | — |
| Chat | keep V2 | message | state | understand | high |
| Lead | progressive capture | phone+need | HS folio | persist first | high |
| Request | n8n Telegram + outbox | insert | HS-* | ACTION notify | high |
| Book | tools + calendar | confirm | HA-* | cita Telegram | high |
| Reminder | existing 24h/2h | tick | appointment | ACTION internal | high |
| Service | job complete (future) | operator | job | state only | medium |
| Follow-up | consented only | completed+delay | channel | later | medium |
| Review | URL required | satisfaction | — | later | medium |
| Content | ask, don’t auto | photos | HC-* | PROCESAR | medium |
| Repeat | 360 by phone | new request | history | context | medium |

---

## Priority / impact scores (proposals)

| Automation | Impact | Complexity | Risk | Usage | Priority |
| --- | --- | --- | --- | --- | --- |
| Outbox + replay | 9 | 5 | 3 | 9 | P0 |
| Webhook pin + 9TG guard | 9 | 2 | 2 | 9 | P0 |
| Fail-closed Content Studio | 8 | 2 | 3 | 8 | P0 |
| HMAC / slot uniqueness | 7 | 3 | 2 | 8 | P0 |
| `/homestead` UX | 8 | 4 | 2 | 9 | P1 |
| Lead rescue ACTION | 8 | 3 | 4 | 8 | P1 |
| Homestead reminder fallback clock | 8 | 4 | 3 | 8 | P1 |
| Quiet hours + taxonomy | 6 | 3 | 2 | 8 | P2 |
| Health `/status` | 6 | 3 | 2 | 6 | P2 |
| Event envelope v1 | 7 | 5 | 3 | 7 | P1 |
| Job → content prompt | 5 | 4 | 3 | 4 | P3 |
| Customer WhatsApp follow-up | 4 | 5 | 8 | 3 | P3 |
| n8n daily briefing import | 2 | 1 | 4 | 3 | P3 |
| Kafka / Redis / vector | 1 | 9 | 6 | 1 | DO NOT |

---

## Recommended TOP 6 (evidence, not the brochure list)

1. **Automation outbox + replay** — stop losing solicitud Telegram; keep folio source of truth.  
2. **Telegram webhook integrity** — never let 9TG_GATEWAY or a second trigger steal Content Studio.  
3. **Content Studio fail-closed** — non-200 to Telegram if Homestead fails.  
4. **`/homestead` Command Center** — unify commands already in Homestead.  
5. **Lead rescue ACTION cards** — extend hot-lead engine; no customer spam.  
6. **Reminder clock fallback in Homestead** — n8n down ≠ missed 2h cita.

Evaluated brochure items:

| Idea | Verdict |
| --- | --- |
| Telegram Command Center | **WINNER** — 80% exists |
| Lead Rescue | **WINNER** — detector exists |
| SLA Response Engine | merge with lead rescue; don’t new WF |
| Appointment Reminder Engine | **already live** — certify, don’t rebuild |
| Post-service follow-up | **NOT YET** — no consent/jobs |
| Job → Content Studio | **NOT YET** — no completed-job spine |

---

## If only 3 next month

1. **Outbox + fail-closed Telegram proxy + webhook pin** (reliability).  
2. **`/homestead` Command Center** (operator speed).  
3. **Lead rescue ACTION** (conversion, no spam).

Why: (1) protects money already earned in the funnel; (2) uses the bot they already open; (3) uses data already in SQLite. Reminders already exist.

---

## DO NOT BUILD YET

- Kafka, RabbitMQ, Redis, Kubernetes, vector DB, full event sourcing  
- Second Telegram bot or n8n conversational agent  
- Import daily/weekly revenue n8n JSON (duplicates `/hoy`)  
- Customer WhatsApp/SMS follow-up or review solicitation without URL + consent  
- Meta auto-publish (`CONTENT_DRY_RUN` must stay true until credentials + policy)  
- Activating BrokerPro / 9TG_GATEWAY on this instance  
- Technician dispatch product  
- Polling SQLite every minute from n8n  
- Auto-rewrite of prompts from analytics  

---

## Roadmap

### WAVE A — Foundation (reliability / security)

Objective: n8n down does not lose notifications forever; Telegram webhook cannot be stolen silently; proxy does not ACK bad updates.

Workflows: **modify existing three Homestead WFs only if required**; prefer Homestead code. No new BrokerPro work.

Dependencies: SQLite migration `automation_outbox`; backup gate.

Risks: double Telegram if outbox + live n8n both send without idempotency key.

Tests: form canary, duplicate POST, n8n stop simulation (notify retry), `getWebhookInfo` still content-studio.

Rollback: drop outbox drain flag; keep v1 webhook.

Homestead: yes. DB: yes (outbox). n8n: maybe fail-closed node. Telegram: webhook unchanged. AI: none.

### WAVE B — Conversion

Objective: operator sees and acts on leads/citas from the phone.

Workflows: none new required; handler + keyboards.

Dependencies: Wave A idempotency so extra alerts don’t duplicate.

Risks: alert fatigue — taxonomy required.

Tests: `/homestead` allowlist deny; hot lead one-shot; no customer messages.

### WAVE C — Operations

Objective: reminder fallback clock; `/status`; quiet hours.

Workflows: optional tiny health WF **or** Homestead cron equivalent. Prefer Homestead if a tick already exists.

### WAVE D — Growth

Objective: job complete → optional content ask; marketing only with Meta + `hs_ref`.

---

## Gates (every wave)

```text
BACKUP → IMPLEMENT → BUILD → TEST → E2E → REGRESSION → CERTIFY → DEPLOY
```

Do not touch BrokerPro, WESTMONT, Madison, Asambleas, n8n postgres restart unless restoring n8n itself.

---

## Reliability target (this scale)

- Form persist success: 100% independent of n8n  
- Request Telegram delivered or in outbox: ≥ 99% within 5 minutes  
- Scheduler tick freshness: ≤ 15 minutes (10 min nominal + one miss)  
- Telegram webhook URL drift: 0  
- No customer auto-messages until consent flag exists  

Not an enterprise 99.99% promise.

---

## Future backup policy (proposal)

- n8n: `pg_dump` + workflow export nightly **off-VPS**  
- Homestead: SQLite backup + `photos/` + `content/`  
- Keep encryption key in a second secret store  
- This audit dump is on-box only — not sufficient DR  

Container loss: volumes + `.env` recover n8n. Homestead container loss: data volume `/opt/apps/homestead/data` survives if not deleted. VPS loss: only if off-box copies exist (not evidenced).
