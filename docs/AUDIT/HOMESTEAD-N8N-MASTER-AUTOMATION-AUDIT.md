# HOMESTEAD SERVICES — n8n Master Automation Audit

DATE: 2026-08-22 America/Panama  
PHASE: 1 — AUDIT ONLY  
CHANGES MADE: NONE (no workflow create/edit/activate/delete, no Homestead deploy, no Telegram webhook change)

```text
N8N BACKUP: PASS
BACKUP LOCATION: /opt/backups/n8n/master-audit-20260822-0241/
BACKUP VERIFIED: PASS
RESTORE PROCEDURE KNOWN: YES
```

```text
HOMESTEAD SHA: 30b751938a328f108dc9ef0fe27cad07ce4b5ec9
BRANCH: main
WORKTREE: dirty (untracked local canaries/media only; tracked tree clean vs origin/main)
```

---

## Sources of truth used

| Document | Status |
| --- | --- |
| `docs/HOMESTEAD-N8N-TELEGRAM.md` | EXISTS — used |
| `docs/HOMESTEAD-CONTENT-STUDIO.md` | EXISTS — used |
| `docs/AUDIT/HOMESTEAD-CHATBOT-LEAD-BOOKING-CALENDAR-AUDIT.md` | EXISTS — used |
| `docs/HOMESTEAD-CONVERSATIONAL-AI-V2.md` | EXISTS — used |
| `docs/AUDIT/HOMESTEAD-CONVERSATIONAL-AI-V2-CERTIFICATION.md` | EXISTS — used |
| `docs/REVENUE-ENGINE-CURRENT-STATE.md` | EXISTS — used |
| `BACKUP-MANIFEST.md` | EXISTS — used |
| Live n8n Postgres `workflow_entity` / `execution_entity` / `webhook_entity` | USED |
| Live Telegram `getWebhookInfo` | USED |
| Live Homestead SQLite + container flags | USED |

Git JSON exports under `n8n/*.json` were compared with production. `active: false` in those files is an **export artifact** and is **not** the production flag.

---

## 1. Infrastructure (live)

| Item | Evidence |
| --- | --- |
| Version | n8n **2.3.6** (`n8nio/n8n:2.3.6`, CLI 2.3.6) |
| URL | https://n8n.autonomousflow.lat |
| Health | container healthy 29h+; `/healthz` `{"status":"ok"}`; public HTTP 200 |
| Deployment | Docker Compose project `n8n` at `/opt/apps/n8n` |
| Containers | `n8n_n8n` + `n8n_postgres` (postgres:15-alpine) |
| Database | PostgreSQL database `n8n`, user `n8nuser` |
| Volumes | `n8n_postgres_data`, `n8n_data` |
| Host ports | Postgres `5434:5432`, n8n UI/API `8083:5678` (Nginx fronts HTTPS) |
| Timezone | `America/Panama` (`TZ`, `GENERIC_TIMEZONE`) |
| Execution mode | default (in-process). No Redis/queue workers in compose |
| Pruning | `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (7 days) |
| Encryption | `N8N_ENCRYPTION_KEY` SET (value not exported) |
| Secure cookie | `N8N_SECURE_COOKIE=false` (TLS terminates at Nginx) |
| Credentials store | **empty** `credentials_entity` |
| Variables (names only) | `HOMESTEAD_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `HOMESTEAD_TELEGRAM_CHAT_ID` |
| Folders / tags | none |
| Projects | 1 personal n8n project (owner). No Homestead folder |
| Env-in-Code | Homestead workflows use `$vars`. BrokerPro JSON uses `$env` (blocked on this instance per prior docs) |

n8n is **shared** with inactive BrokerPro / test workflows. Homestead is not an isolated automation engine yet.

---

## 2. Backup verification

Location: `/opt/backups/n8n/master-audit-20260822-0241/`

| Artifact | Size / check |
| --- | --- |
| `n8n.dump` (custom format `pg_dump -Fc`) | 231 KB · `pg_restore -l` = **359** entries · chmod 600 |
| `workflow-export/all-workflows.json` | 16 workflows · chmod 600 · **not Git** |
| `homestead/homestead.sqlite` | integrity **ok** · chmod 600 |
| `config/docker-compose.yml` | copy of `/opt/apps/n8n/docker-compose.yml` |
| `config/n8n-env-keys.txt` / `homestead-env-keys.txt` | key names only |

**Restore (known, not executed):**

1. Preserve `/opt/apps/n8n/.env` and volume `n8n_data` (encryption key). Without the key, credential/variable ciphertext is useless.
2. `docker cp` dump into `n8n_postgres` → `pg_restore --clean --if-exists -U n8nuser -d n8n`.
3. Optionally `n8n import:workflow --input=all-workflows.json`.
4. Restart **only** `n8n_n8n` so production webhooks re-register.
5. Homestead SQLite: stop `homestead_web`, replace `/opt/apps/homestead/data/homestead.sqlite`, start. Photos/content files live beside the DB.

**DR gap:** this backup is on the **same VPS** as production. Losing the disk loses both. Off-box copies are not evidenced in this audit.

---

## 3. Workflow inventory (ALL workflows)

Live query `workflow_entity` 2026-08-22 02:41–02:47 America/Panama.

Executions retained ~2026-08-19 05:33 → 2026-08-22 02:40. Status in window: **227 success, 0 error**.

| Workflow | ID | Active | Trigger | Purpose | Last execution | Exec / errors | Homestead |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HOMESTEAD — Nueva solicitud → Telegram | i4t4Bw8JTQB8A2KE | yes | webhook `homestead-service-request` | Solicitud → Telegram | 2026-08-22 02:47 (canary HS-2026-000031) | 18 / 0 | yes |
| HOMESTEAD — Content Studio | l10Rh1i8NDrdkfUa | yes | webhook `homestead-content-studio` | Telegram inbound → Homestead | 2026-08-20 22:50 | 25 / 0 | yes |
| HOMESTEAD — Content Scheduler | nGiCm9Yt3PzPzDP9 | yes | schedule 10 min | Tick: publish due + **hot leads** + **appointment reminders** | 2026-08-22 02:40 | 181 / 0 | yes |
| HOMESTEAD — Marketing Analytics Collector | ZiQfUIPtEq3RsqVW | yes | schedule 12 h | POST analytics-collect (Meta not configured) | 2026-08-22 00:00 | 3 / 0 | yes |
| HOMESTEAD — Weekly Marketing Report | aSGBqm6D5SjSsYGL | yes | schedule 7 d | POST weekly-report | 2026-08-21 00:00 | 1 / 0 | yes |
| 1BP_ERROR_LOGGER_V1 | LI7K… | no | errorTrigger | BrokerPro errors | never | 0 | no |
| 2BP_LEAD_INGEST_V1 | OsoN… | no | webhook | BrokerPro ingest | never | 0 | no |
| 3BP_LEAD_SCORE_V1 | V07l… | no | webhook | BrokerPro score | never | 0 | no |
| 4BP_FOLLOWUP_IMMEDIATE_V1 | 8URR… | no | webhook | BrokerPro follow-up | never | 0 | no |
| 5BP_FOLLOWUP_24H_V1 | Yp8a… | no | webhook + wait | BrokerPro 24h | never | 0 | no |
| 6BP_FOLLOWUP_72H_V1 | KlWS… | no | webhook + wait | BrokerPro 72h | never | 0 | no |
| 7BP_FOLLOWUP_CANCEL_V1 | N9FW… | no | webhook | BrokerPro cancel | never | 0 | no |
| 9TG_GATEWAY_V1 | lZo2… | no | **telegramTrigger** | BrokerPro Telegram gateway | never | 0 | no |
| PT Bot Mentor v2 | 2x6h… | no | webhook | Unrelated mentor bot → :8082 | never | 0 | no |
| My workflow | H5IB… | no | none | empty | never | 0 | no |
| test1 | mmq-… | no | manual | sandbox | never | 0 | no |

**In Git, not imported to live n8n:**

- `HOMESTEAD — Daily Business Briefing`
- `HOMESTEAD — Weekly Revenue Report`

Homestead already implements `/hoy` and `POST /api/internal/revenue/daily-briefing` (`REVENUE_BRIEFING_SEND=false`). Importing those JSON files would duplicate an on-demand brief.

---

## 4. Dependency map (current, evidence)

```text
HOMESTEAD SQLite  (SOURCE OF TRUTH)
   │
   ├── POST /api/contact  AND  chatbot persistServiceRequest
   │      ↓ persist HS-YYYY-NNNNNN
   │      ├── SMTP email          (Homestead, not n8n)
   │      └── POST webhook homestead-service-request
   │             ↓
   │           n8n  HOMESTEAD — Nueva solicitud → Telegram
   │             ↓ Bot API sendMessage/sendPhoto/sendMediaGroup
   │           Telegram  🔔 NUEVA SOLICITUD
   │
   ├── chatbot createAppointment()
   │      ↓ revenue_appointments
   │      ├── GET /api/admin/appointments  →  /admin/citas
   │      └── notifyAppointmentEvent()     (Homestead Bot API, NOT n8n)
   │             ↓
   │           Telegram  📅 NUEVA CITA
   │
   ├── Telegram Bot webhook
   │      ↓ https://n8n.autonomousflow.lat/webhook/homestead-content-studio
   │           n8n  HOMESTEAD — Content Studio  (proxy)
   │      ↓ POST /api/internal/content/telegram-update
   │           Homestead content-handler
   │             ├── /publicar  Content Studio
   │             ├── /hoy /leads /calientes /agenda …  Revenue Command Center
   │             └── callbacks cs:* rv:* mi:*
   │
   ├── n8n  HOMESTEAD — Content Scheduler  every 10 min
   │      ↓ POST /api/internal/content/scheduler-tick
   │           runContentScheduler()
   │           runHotLeadReminders()
   │           runAppointmentReminders()
   │
   ├── n8n  Marketing Analytics Collector  12h  → collect (Meta absent)
   └── n8n  Weekly Marketing Report  7d     → report endpoint
```

**Where n8n actually sits today:** outbound request Telegram, inbound Telegram proxy, and three timers. Chat, booking, calendar, email, OpenAI, and appointment Telegram **do not** go through n8n.

---

## 5. Telegram — special audit

```text
TELEGRAM BOT COUNT: 1 reused (@HomesteadServicesNotifyBot) — token SET on Homestead and n8n Variables
TELEGRAM TRIGGERS:
  - Live webhook (Bot API): https://n8n.autonomousflow.lat/webhook/homestead-content-studio
  - pending_update_count: 0
  - last_error: none
  - n8n telegramTrigger nodes: 1 (9TG_GATEWAY_V1) INACTIVE
  - Homestead outbound: Bot API from n8n request workflow + Homestead Node (citas, alerts, content preview)
WEBHOOK CONFLICT RISK: YES — latent. Activating 9TG_GATEWAY_V1 would register a Telegram Trigger on some bot credential and can steal the webhook from Content Studio.
COMMAND ROUTING: Homestead `content-handler.ts` (commands listed below). n8n does not parse commands.
CALLBACK ROUTING: same handler; prefixes cs: (content), rv: (revenue), mi: (marketing shadow)
AUTHORIZATION: PARTIAL/PASS for Homestead paths — isTelegramAdmin(chatId, userId) against HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS (count=1). Callbacks denied if not admin. Job callbacks also require job.telegramChatId === chatId.
```

Homestead commands already present (not `/homestead`): `/publicar`, `/pendientes`, `/programadas`, `/publicadas`, `/proxima`, `/estado`, `/pausa`, `/reanudar`, `/hoy`, `/leads`, `/calientes`, `/seguimientos`, `/cotizaciones`, `/agenda`, `/trabajos`, `/clientes`, `/reseñas`, `/mantenimientos`, plus natural-language shortcuts for “qué hago hoy”.

**Polling:** not used. Webhook only.

---

## 6. Solicitudes (live test this audit)

```text
Website → POST /api/contact → SQLite HS-2026-000031 → email log success → n8n 200 in 281 ms → TELEGRAM SENT
```

| Check | Result |
| --- | --- |
| Webhook | `POST /webhook/homestead-service-request` |
| Auth | shared secret header + timestamp ±300s; HMAC generated by Homestead **not verified** in n8n (documented limitation: no `crypto` in task runner) |
| Timeout | Homestead 25s |
| Retry | none (fire-and-forget `void notifyN8n`) |
| Idempotency | `service_request.created:{folio}` in **workflow static data**, 7 days (901 bytes live) |
| Client | 200 even if n8n fails — request already persisted |

Canary: `HS-2026-000031`, phone `60001111`, marker `N8N-MASTER-AUDIT-TEST`. Appointments remained 2.

---

## 7. Chatbot

```text
Visitor → POST /api/concierge/chat → OpenAI gpt-4o tools
  → persistServiceRequest → same n8n solicitud webhook
  → createAppointment (after confirm) → SQLite + calendar API
  → notifyAppointmentEvent → Telegram cita (Homestead, not n8n)
```

n8n **does not** generate dialogue. Escalate-only path still calls `sendNewLeadAlert` **in addition** to n8n (`concierge-handoff.ts`).

Not re-run this session (avoid extra OpenAI + extra test appointments). Prior cert: `HS-2026-000030` / `HA-7306eb00` still in DB.

---

## 8. Calendar and appointments

| Automation | Exists? | Where |
| --- | --- | --- |
| Real booking | YES | Homestead concierge tools + `revenue_appointments` |
| Calendar UI | YES | `/admin/citas` ← same table |
| Google Calendar | NO | documented missing |
| Reminders 24h / 2h | YES | `runAppointmentReminders` on **scheduler-tick** (n8n timer only) |
| Reschedule / cancel notify | YES | Homestead `notifyAppointmentEvent` |
| n8n reminder workflow | NO | do not duplicate |
| Overlap prevention | PARTIAL | chat `checkAvailability` blocks date\|time globally; `createAppointment` only dedupes **same lead + same slot** |

Live appointments (unchanged by form canary):

| ID | When | Status | Source |
| --- | --- | --- | --- |
| HA-7306eb00 | 2026-08-23 10:00 | CONFIRMED | CHAT |
| HA-32eea0ba | 2026-08-23 15:00 | CONFIRMED | CHAT |

Overlapping open slots in DB: **0**.

---

## 9. Content Studio

```text
Telegram /publicar + photos
  → webhook homestead-content-studio
  → Homestead telegram-update
  → SQLite content_* + disk /app/data/content
  → PROCESAR callback → OpenAI + sharp
  → Telegram preview → approve / regenerate
```

| Check | Evidence |
| --- | --- |
| Photo received auto-AI? | **NO** — waits `cs:{id}:process` |
| CONTENT_DRY_RUN | **true** |
| CONTENT_MODE | ASSISTED |
| Meta | not configured; collect returns `meta_not_configured` |
| Jobs | HC-2026-000001 REJECTED, 000002 APPROVED, 000003 REJECTED, 000004 APPROVED, **000005 PUBLISHED** (dry-run path; no Instagram/Facebook credentials) |
| Fresh /publicar this audit | **not executed** (would cost AI / not required) |

n8n Content Studio uses `continueOnFail: true` then always HTTP 200 to Telegram. If Homestead is down, Telegram considers the update delivered and **will not retry**.

---

## 10. OpenAI (all call sites)

| Feature | Model | Location | n8n / Homestead | Purpose | Cost risk | Failure |
| --- | --- | --- | --- | --- | --- | --- |
| Chat advisor | `OPENAI_TEXT_MODEL` default gpt-4o (`OPENAI_CONCIERGE_MODEL` empty) | `concierge-engine.ts` | Homestead | conversation + tools | high (every visitor turn) | human fallback; lead already persisted if captured |
| Content analysis/copy | gpt-4o | `content-openai.ts` | Homestead | captions | medium, on PROCESAR | originals kept; retry button |
| Content image edit | gpt-image-1 | `content-openai.ts` | Homestead | enhance | high per image | sharp fallback |
| n8n OpenAI nodes | — | none live | — | — | — | — |

No OpenAI health-check calls. Marketing collector does not call OpenAI.

---

## 11. Duplications

| Item | Class | Note |
| --- | --- | --- |
| Request Telegram (n8n) vs appointment Telegram (Homestead) | SAFE | different templates (solicitud vs cita) |
| Chat escalate `sendNewLeadAlert` + n8n solicitud | REDUNDANT | only on `escalate=true` |
| `/hoy` vs Git daily-briefing workflow | REDUNDANT | JSON not live; `REVENUE_BRIEFING_SEND=false` |
| Hot-lead reminders vs future “SLA engine” | REDUNDANT if rebuilt in n8n | already in scheduler-tick |
| 24h/2h reminders vs future n8n reminder WF | REDUNDANT if rebuilt | already Homestead |
| BrokerPro Telegram gateway vs Homestead webhook | CRITICAL if activated | same class of resource: bot webhook |
| Shared n8n instance for Homestead + BrokerPro + PT Bot | RISKY | blast radius, UI confusion |
| Internal secret as both n8n auth and photo URL HMAC | SAFE-ish | one secret, many uses |
| Fire-and-forget n8n + no outbox | RISKY | lost notification ≠ lost request (good) but no replay |

---

## 12. Homestead workflow quality

Scores are for **live Homestead** workflows only.

### Nueva solicitud → Telegram (12 nodes, 4065 chars Code)

RELIABILITY 8 · SECURITY 7 · OBSERVABILITY 6 · MAINTAINABILITY 6 · IDEMPOTENCY 7 · ERROR HANDLING 6 · BUSINESS VALUE 9

Low: HMAC not verified; idempotency in static data; no retry; Code node is the whole policy engine.

### Content Studio (5 nodes)

RELIABILITY 7 · SECURITY 8 · OBSERVABILITY 5 · MAINTAINABILITY 8 · IDEMPOTENCY 8 · ERROR HANDLING 5 · BUSINESS VALUE 8

Low: always-200 to Telegram hides Homestead failures; last inbound 2026-08-20.

### Content Scheduler (2 nodes)

RELIABILITY 8 · SECURITY 6 · OBSERVABILITY 6 · MAINTAINABILITY 9 · IDEMPOTENCY 7 · ERROR HANDLING 5 · BUSINESS VALUE 9

Low: internal auth may skip HMAC; `continueOnFail`; this timer is a **silent SPOF** for reminders.

### Marketing Analytics Collector (2 nodes)

RELIABILITY 8 · SECURITY 6 · OBSERVABILITY 5 · MAINTAINABILITY 9 · IDEMPOTENCY 8 · ERROR HANDLING 5 · BUSINESS VALUE 3

Low: Meta absent; executions succeed with `collected: 0`. Noise, not value.

### Weekly Marketing Report (2 nodes)

Same shape. BUSINESS VALUE 4 until Meta/content metrics exist.

**Fleet averages (Homestead, weighted by value):** Reliability 8 · Security 6.5 · Observability 5.5 · Maintainability 7.5 · Idempotency 7 · Error handling 5.5.

---

## 13. Failure modes (current)

| Failure | What happens today |
| --- | --- |
| Telegram API down | Request: n8n may 200 after failed send depending on node; Homestead already saved. Cita notify: `AppointmentTelegramFailed`, appointment stays CONFIRMED (good: business ≠ automation). |
| Email down | Logged `EmailNotificationFailed`; request saved; n8n still runs. Outbound email is **not** row in `service_request_messages` (only Telegram notify + later admin replies). |
| OpenAI down | Chat fallback; Content PROCESAR → FAILED + retry; originals kept. |
| Homestead down | n8n scheduler/content proxy fail or 200-empty; SQLite/files unreachable; form/chat down. n8n still “up”. |
| n8n restart | Docker `restart: always`; webhooks re-bind; in-flight execution lost; no queue. |
| Webhook twice | Request workflow static-data duplicate → `{duplicate:true}` no second Telegram (7 days). Content: `seenTelegramUpdate`. |
| Hung execution | not observed; prune 7d; no wait-nodes on Homestead WFs. |
| 429 / 500 | Homestead n8n client: no retry. Scheduler continueOnFail. |

---

## 14. Idempotency keys that exist vs missing

| Event | Key today | Where |
| --- | --- | --- |
| `service_request.created:HS-…` | YES | n8n static data 7d |
| Telegram update_id | YES | SQLite `content_telegram_updates` |
| Appointment notice | YES | `claimAppointmentNotice` (versioned) |
| Lead alert | YES | `internalAlertAt` |
| `appointment.created:HA-…` → n8n | NO | n8n never receives this event |
| `content.approved:HC-…` | partial | job status in SQLite |
| Outbox / replay | NO | failed n8n POSTs are log-only |

Static data class: request workflow **SHOULD MOVE TO DB** if Homestead becomes the event bus. Scheduler staticData ~45–47 bytes (trigger cursor) **OK**.

---

## 15. Security

| Topic | Finding |
| --- | --- |
| Webhook auth | Shared secret header. Timestamp skew 300s. HMAC created, not consumed by n8n. |
| Internal APIs | `verifyInternalHomesteadRequest`: secret + timestamp required; **HMAC optional** if header omitted. |
| Replay | Possible within 300s if secret leaked. |
| Telegram callbacks | Server-side admin allowlist; do not trust button text. |
| Admin chat | 1 ID configured. Command Center must keep this gate. |
| n8n credentials | none stored in credentials_entity |
| OpenAI / SMTP | in Homestead `.env` only |
| Public endpoints | `/api/contact`, `/api/concierge/chat`, n8n webhooks |
| Host exposure | Postgres **5434** and n8n **8083** published on VPS |
| `N8N_SECURE_COOKIE` | false |
| HARDCODED SECRET FOUND | **NO** in live workflow node parameters (tokens via `$vars`) |
| COUNT | **0** bot tokens / API keys in workflow JSON |
| Extra | n8n compose contains BrokerPro `TG_ALLOWED_CHAT_IDS` (chat id, not token) |

Execution data: 227 rows, `binary_data` 0. Success executions likely contain request payloads (names, phones) for **7 days**. Retention exists; not anonymized.

---

## 16. Live tests this phase

| Flow | Result | Evidence |
| --- | --- | --- |
| FORM → REQUEST | PASS | HS-2026-000031 |
| REQUEST → EMAIL | PASS | `EmailNotificationSucceeded` (~4.9s) |
| REQUEST → N8N | PASS | `N8nNotificationSucceeded` HTTP 200 **281 ms** |
| N8N → TELEGRAM | PASS | `service_request_messages` TELEGRAM SENT; executions 17→18 |
| CHATBOT → LEAD | PASS | prior HS-2026-000028/000030 still in DB; not re-booked |
| BOOKING → DB | PASS | 2 CONFIRMED appointments |
| BOOKING → CALENDAR | PASS | same table as `/api/admin/appointments` (V2 cert) |
| CONTENT STUDIO → TELEGRAM | PASS* | webhook registered; 25 historic successes; no new `/publicar` / no social publish |

\*No AI content run and no network publish this audit.

---

## 17. Homestead flags (production container)

```text
AI_CONCIERGE_ENABLED=true
AI_CONCIERGE_DRY_RUN=false
AI_CONCIERGE_CREATE_LEADS=true
CONTENT_STUDIO_ENABLED=true
CONTENT_DRY_RUN=true
REVENUE_ENGINE_ENABLED=true
REVENUE_ENGINE_DRY_RUN=true
REVENUE_BRIEFING_SEND=false
AUTO_FOLLOW_UP=false
APPOINTMENT_REMINDER_ENABLED=true
APPOINTMENT_REMINDER_OFFSETS=24h,2h
HOT_LEAD_ATTENTION_MINUTES=30
MARKETING_INTELLIGENCE_SHADOW=true
```

---

## 18. n8n down ≠ Homestead down?

| Capability | Survives n8n down? |
| --- | --- |
| Website / form persist / folio | YES |
| Email | YES |
| Chat + SQLite lead | YES |
| createAppointment + calendar | YES |
| Appointment Telegram | YES (Homestead Bot API) |
| Request Telegram | NO |
| /publicar /hoy /callbacks | NO (inbound webhook is n8n) |
| Reminders / hot leads | NO (timer is n8n) |

**Violation of “n8n is only orchestration”:** inbound Telegram Command Center and reminder timers have **no Homestead-side scheduler**. If n8n is offline, operators lose the mobile command surface even though data is in SQLite.

---

## 19. Outbox — worth it at this scale?

YES, **small SQLite outbox**, not Kafka.

Volume is ~18 request webhooks lifetime + 10-min ticks. The cost of a missed **NUEVA SOLICITUD** Telegram is a lost operator signal, not a lost folio. A table `automation_outbox(event_id, type, payload, status, attempts)` drained by Homestead (retry to n8n or send Telegram directly) is proportional.

Do **not** put reminder polling in n8n cron if Homestead later gains its own clock; today the 10-min n8n tick is the clock.

---

## 20. TOP problems (7)

1. **Latent Telegram webhook steal** if `9TG_GATEWAY_V1` is activated.
2. **Content Studio returns 200 to Telegram even when Homestead fails.**
3. **No outbox / replay** for `service_request.created` notifications.
4. **Reminders and Command Center die if n8n dies** (timer + inbound proxy).
5. **Shared n8n + exposed 5434/8083** — Homestead coupled to BrokerPro blast radius.
6. **Idempotency and SLA state in n8n static data / optional HMAC.**
7. **`createAppointment` does not globally unique-slot** (chat availability does; admin/Telegram path may not).

Not padded to 10.

---

## 21. TOP opportunities (impact order)

1. SQLite automation outbox + replay UI/command.
2. `/homestead` Command Center on **existing** handler (not a new bot).
3. Pin/monitor Telegram webhook URL; refuse second trigger.
4. Surface existing hot-lead + SLA as ACTION alerts (already computed).
5. Quiet hours + INFO/ACTION/WARNING/CRITICAL taxonomy (before adding more pings).
6. Move request idempotency to Homestead DB.
7. Homestead-side scheduler fallback for reminders (so n8n down ≠ missed 2h reminder).
8. Tighten internal HMAC (n8n and `/api/internal/*`).
9. Event envelope v1 from Homestead for future n8n consumers.
10. Job-completed → “¿crear contenido?” only after real job completion exists.

---

## 22. Master table

| Automation | Exists | Health | Business value | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Request → n8n → Telegram | YES | healthy | high | medium | keep; add outbox |
| Content Studio proxy | YES | idle 1.5d, configured | high | medium | keep; fail closed to Telegram |
| Content Scheduler 10 min | YES | 181/181 | high (also reminders) | high SPOF | keep; add Homestead fallback |
| Marketing collector | YES | success empty | low | low | pause or keep as cheap no-op |
| Weekly marketing report | YES | 1 run | low | low | keep until Meta exists |
| Daily briefing n8n | JSON only | n/a | low | dup of /hoy | DO NOT IMPORT |
| Weekly revenue n8n | JSON only | n/a | low | dup | DO NOT IMPORT |
| Chat GPT advisor | YES Homestead | certified partial | high | cost | keep; not n8n |
| Appointment Telegram | YES Homestead | certified | high | low | keep off n8n |
| Hot lead 30 min | YES via tick | unproven volume | high | spam if noisy | extend, don’t rebuild |
| Appointment reminders | YES via tick | enabled | high | missed if n8n down | certify, don’t rebuild |
| Auto follow-up customers | FLAG false | n/a | high if abused | high | keep off |
| BrokerPro suite | YES inactive | unused | none for HS | **critical if on** | do not activate |
| Command Center /homestead | NO (pieces yes) | — | high | low | Wave B UX |
| Outbox | NO | — | high | low | Wave A |
| Health monitor WF | NO | — | medium | low | Wave A light |
| Review / Meta publish | NO / dry | — | later | high | DO NOT BUILD YET |

---

## STOP

No Wave A implementation. No new workflows. No webhook or Telegram changes.
