# HOMESTEAD AUTOMATION ENGINE V2 — WAVE B CERTIFICATION

DATE: 2026-08-22 America/Panama  
SCOPE: Telegram Command Center, Lead Rescue, Smart SLA, Daily Brief. Wave C was not implemented.

Production + live code win over docs. n8n 2.3.6 still cannot HMAC inbound payloads; that limitation is documented, not faked.

No new n8n workflow. Ops alerts use Wave A outbox → Homestead Telegram Bot API. `service_request.created` still posts the existing n8n request webhook.

```text
========================================================
HOMESTEAD AUTOMATION ENGINE V2
WAVE B — FINAL CERTIFICATION
========================================================

WAVE A

WAVE_A_PUSH: PASS
LOCAL_SHA: d962c8294af61b3d7509dd424583aa19001df841
ORIGIN_SHA: d962c8294af61b3d7509dd424583aa19001df841
WAVE_A_REGRESSION: PASS (unit suite including outbox, replay, slot unique, CS fail-closed, update_id)

BACKUPS

GIT: PASS  tag pre-automation-v2-wave-b-20260822-0825 at d962c82
SQLITE: PASS  /opt/backups/pre-automation-v2-wave-b-20260822-0825/homestead/homestead.sqlite
  524288 bytes
  SHA256 d846a39794a185027a7ff2f6943b97dc09baab929eefee1314c935a6f2838f2f
N8N: PASS  pg_dump -Fc 242515 bytes  pg_restore -l = 359  16 workflows exported
SQLITE INTEGRITY: PASS (ok) before and after deploy

TELEGRAM

BOT COUNT: 1  (@HomesteadServicesNotifyBot)
INBOUND WEBHOOK: https://n8n.autonomousflow.lat/webhook/homestead-content-studio
WEBHOOK DRIFT: PASS  match true  pending_update_count 0  last_error none
AUTHORIZED ADMINS: HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS allowlist (chat_id + user_id)
UNAUTHORIZED ACCESS TEST: PASS
  /homestead non-admin → denied true, body "No autorizado.", no PII
  forged callback cc:d:HS-… → denied true
  forged mark-contacted API → 401

COMMAND CENTER

/homestead: PASS  authorized update → ok true (live Telegram send)
SUMMARY COUNTS: live pendingRequests=24 rescue=22 appointmentsToday=0 overdueFollowups=3 contentPending=0
COUNTS MATCH DB: PASS  pendingRequests API 24 = SQLite NEW non-test 24
  appointmentsToday 0 matches DB (open appointments are 2026-08-23 x3 and 2026-12-31 x1, not 2026-08-22)
SOLICITUDES: PASS  list API + mark contacted HS-2026-000036 → CONTACTED, stale second call already_updated
LEADS: PASS  /leads routes to rescue list; rescue canary HS-2026-006936 delivered
AGENDA: PASS  /hoy and /agenda use America/Panama; API ymd 2026-08-22 count 0 = DB
MARKETING: PASS  Command Center button reuses Content Studio pending statuses; no Meta publish
RESUMEN: PASS  todayMetrics; conversion % hidden unless denominator ≥ 3; no invented $
MOBILE UX: PASS  inline keyboard, pager size 5, editMessageText, no OpenAI

LEAD RESCUE

ELIGIBILITY: PASS  deterministic isRescueEligible (phone + commercial intent + not booked + inactive ≥ LEAD_RESCUE_AFTER_MINUTES + within LEAD_RESCUE_LOOKBACK_HOURS)
DURABLE STATE: PASS  revenue_leads rescue_alerted_at, rescue_cycle, snoozed_until, dismissed_at, rescued_to_booking
OUTBOX: PASS  lead.rescue_eligible:<leadId>:<cycle>
IDEMPOTENCY: PASS  unique key + SQL guard; second tick rescue=0
TELEGRAM ALERT: PASS  HS-2026-006936 DELIVERED after tel: keyboard removed
CONTACT: PASS  phone in body; Ficha HTTPS admin; opening URL does not mark contacted
WHATSAPP LINK: PASS  wa.me only when phone valid
MARK CONTACTED: PASS  CONTACTED + first_human_action_at + audit REQUEST_MARKED_CONTACTED
SNOOZE: PASS  snoozed_until persisted, rescue_alerted_at cleared
DISMISS: PASS  dismissed_at + LOST; row not deleted
NO DUPLICATE ALERT: PASS
RESCUE → BOOKING: WIRED (createAppointment → markRescuedToBooking / LEAD_RESCUE_BOOKED)
  LIVE CHAT PATH: NOT RE-RUN this wave (unit conversational suite PASS). Do not claim a new HA-* from this session.

SMART SLA

FIRST RESPONSE: PASS  sla.first:HS-2026-006936 DELIVERED
ESCALATION: PASS  sla.escalation:HS-2026-006470 DELIVERED; second tick no extra row
CONFIGURABLE: PASS  SLA_FIRST_RESPONSE_MINUTES / SLA_ESCALATION_MINUTES / SLA_LOOKBACK_HOURS
OUTBOX: PASS
MARK CONTACTED STOPS SLA: PASS  HS-2026-000036 status CONTACTED; SLA_RECOVERED event
NO ALERT STORM: PASS after mitigation
  First tick without lookback enqueued historic NEW requests.
  14 sla.escalation already DELIVERED to the admin chat, then 71 pending historic ops events SKIPPED
  (wave_b_historic_backlog_suppressed). Lookback 24h now gates new alerts.

DAILY BRIEF

SCHEDULE: PASS  DAILY_BRIEF_HOUR default 8 America/Panama
PANAMA TIMEZONE: PASS
COUNTS MATCH DB: PASS  uses commandCenterSummary(false) / todayMetrics(false)
OUTBOX: PASS  daily.brief:2026-08-22
IDEMPOTENCY: PASS  second force-brief does not insert a second row
DUPLICATE SEND: PASS  DELIVERED attempts=1

AGENDA

DB: PASS  2026-08-23 x3 CONFIRMED/RESCHEDULED; HA-wavea1 2026-12-31
TELEGRAM: PASS  /hoy /agenda / Command Center
TIMEZONE: PASS  America/Panama, no UTC shown to user
DETAIL: PASS  HA-* callback, no cancel/reschedule from Telegram
CONTACT ACTIONS: PASS  WhatsApp + admin calendar HTTPS

SECURITY

ADMIN ALLOWLIST: PASS
CALLBACK AUTH: PASS  isTelegramAdmin before cc:
STALE CALLBACK: PASS  already_updated
FORGED CALLBACK: PASS  denied / 401
PII: PASS  no phone/name in callback_data; unauthorized gets "No autorizado."
SECRETS EXPOSED: PASS  none in git
HMAC inbound n8n→Homestead: NOT CLAIMED (n8n 2.3.6 secret+timestamp ±300s only)

RELIABILITY

N8N DOWN: PASS  AUTOMATION_N8N_FAIL=true  HS-2026-006999
EVENT PERSISTED: PASS  sla.first PENDING attempts=1 last_error forced_n8n_fail
RETRY: PASS  second fail-mode tick COUNT=1 (backoff, no duplicate)
DELIVERED: PASS  after restore DELIVERED attempts=2
DELIVERY COUNT: PASS  one outbox row

REGRESSION

FORM: PASS  HS-2026-000036 created
EMAIL: PASS  Wave A path unchanged; not re-asserted in this wave’s Telegram canary
CHATBOT: UNIT PASS  live abandon→book path not re-run this wave
OPENAI: UNIT PASS  Command Center/Rescue/SLA/Brief do not call OpenAI
BOOKING: UNIT PASS  live new HA-* not created this wave
CALENDAR: PASS  DB dates vs Telegram ymd
REQUEST TELEGRAM: PASS  service_request.created still n8n; Wave A HS-2026-000036 DELIVERED
APPOINTMENT TELEGRAM: NOT RE-RUN live this wave
CONTENT STUDIO: PASS  one webhook, CS workflows still active, fail-closed JSON unchanged
WAVE A OUTBOX: PASS
WAVE A REPLAY: UNIT PASS
SLOT CONCURRENCY: UNIT PASS  unique open-slot index still present

QUALITY

BUILD: PASS  next build 0 errors
TESTS: PASS  npm test including Wave A + Wave B
E2E: PASS  homestead command, unauthorized, SLA, rescue send, snooze, n8n-down, daily brief, counts vs DB
SECURITY TESTS: PASS
SQLITE FINAL INTEGRITY: PASS (ok)
LINT: 0 errors; 2 pre-existing warnings (scripts/test-revenue-engine.mjs unused cold; opengraph-image no-img-element)
TSC: PASS

METRICS

LEAD RESCUE EVENTS: LEAD_RESCUE_ELIGIBLE / CONTACTED / BOOKED / DISMISSED in revenue_events + ops_audit
SLA EVENTS: SLA_BREACHED / SLA_ESCALATED / SLA_RECOVERED
POST-RESCUE BOOKINGS: column rescued_to_booking + event LEAD_RESCUE_BOOKED (attribution, not causality)
  Live post-rescue booking count this wave: not increased via a new chat HA-*

DEFECTS

P0: none open
P1: Historic first-run SLA/rescue enqueue — MITIGATED
  14 escalation messages were delivered before suppress+lookback. Remaining historic PENDING skipped. New alerts limited to 24h lookback.
P1: tel: inline URL made Telegram reject the entire sendMessage (telegram_zero) — FIXED
  Phone stays in message body; WhatsApp wa.me; admin HTTPS ficha.
P2: Live chat rescue → booking canary not executed this wave
P2: n8n 2.3.6 cannot HMAC inbound Homestead requests (unchanged from Wave A)
P3: /api/admin/automation/health now returns unauthorized without admin session (not used as public ops API)

GIT

PRE_WAVE_B_SHA: d962c8294af61b3d7509dd424583aa19001df841
FINAL_SHA: b7eb4455de2f2ca391d79dff8cc123f3e06bdf4e
COMMITS:
  2bd5386 feat(ops): add Telegram Command Center, lead rescue, and smart SLA
  d56740f fix(ops): bound rescue and SLA lookback to prevent historic alert storms
  b7eb445 fix(telegram): drop unsupported tel: inline URLs so ops alerts can send
  (plus this certification commit)
PUSH: pending at certification write
LOCAL_EQUALS_ORIGIN: pending push

FINAL VERDICT:

WAVE B CERTIFIED

========================================================
```

## Architecture decision (n8n)

Zero new Homestead workflows. Five existing HOMESTEAD workflows remain active. Ops Telegram is dispatcher-owned.

## Quiet hours

INFO (daily brief) deferred 22:00–07:00 America/Panama. ACTION/WARNING (rescue, SLA) and CRITICAL webhook drift are not deferred.

## Rollback

Tag `pre-automation-v2-wave-b-20260822-0825` + SQLite copy under `/opt/backups/pre-automation-v2-wave-b-20260822-0825/`. Disable ops by not calling `runOpsEngine`. Do not DROP new columns.
