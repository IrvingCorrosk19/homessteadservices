# HOMESTEAD AUTOMATION ENGINE V2 — WAVE A CERTIFICATION

DATE: 2026-08-22 America/Panama  
SCOPE: Reliability foundation only. Wave B was not implemented.

Production + live code win over docs. Discrepancies recorded below.

```text
==================================================
HOMESTEAD AUTOMATION ENGINE V2
WAVE A CERTIFICATION
==================================================

PRE-IMPLEMENTATION

GIT BACKUP: PASS
  tag pre-automation-v2-wave-a-20260822-0308
  PRE SHA ab8fdfb28d54007f44ca83a6b3c2cb01f8068eab
SQLITE BACKUP: PASS
  /opt/backups/pre-automation-v2-wave-a-20260822-0308/homestead/homestead.sqlite
  471040 bytes
  SHA256 ccf011f222120fcc1b02dae76d4bd904792d8151e1380df35425f4fa5a860a00
SQLITE INTEGRITY: PASS (ok)
N8N BACKUP: PASS
  /opt/backups/pre-automation-v2-wave-a-20260822-0308/n8n/n8n.dump
  pg_restore -l = 359
  16 workflows exported
TELEGRAM WEBHOOK: PASS
  https://n8n.autonomousflow.lat/webhook/homestead-content-studio
  pending_update_count 0
  last_error none
HOMESTEAD HEALTH: PASS (200)
N8N HEALTH: PASS (/healthz 200)
SAFE TO CONTINUE: YES

ARCHITECTURE

SQLITE SOURCE OF TRUTH: PASS
AUTOMATION OUTBOX: PASS  table automation_outbox + unique idempotency_key
EVENT ENVELOPE: PASS  v1 stored in payload_json; dispatcher posts inner data to existing webhook
DISPATCHER: PASS  drainAutomationOutbox claim+lease 45s
RETRY: PASS  backoff 0 / 30s / 2m / 5m / 15m, max 8
DEAD LETTER: PASS  status FAILED + AutomationDeadLettered
REPLAY: PASS  POST /api/admin/automation/replay  (does not create HS/HA)
IDEMPOTENCY: PASS  Homestead unique key + n8n staticData.seen kept

REQUEST FLOW

FORM → SQLITE: PASS  HS-2026-000032
FORM → OUTBOX: PASS  event 2909a047-efbf-4a13-9a36-90e11cea576f
OUTBOX → N8N: PASS  N8nNotificationSucceeded HTTP 200  durationMs 801
N8N → TELEGRAM: PASS  TELEGRAM SENT once
EMAIL: PASS  EmailNotificationSucceeded (no EMAIL row in messages table; see P3)
DUPLICATE TELEGRAM: PASS  one SENT row per HS for solicitud

FAILURE TEST

N8N DOWN: PASS  AUTOMATION_N8N_FAIL=true (dispatcher only)
REQUEST STILL SAVED: PASS  HS-2026-000033 HTTP 200
OUTBOX PENDING: PASS  forced_n8n_fail attempts=1  no Telegram
N8N RESTORED: PASS  AUTOMATION_N8N_FAIL=false  homestead_web recreated
RETRY: PASS  scheduler-tick after 30s backoff
TELEGRAM DELIVERED: PASS  DELIVERED attempts=2
TELEGRAM COUNT: PASS  1 SENT

CONTENT STUDIO

FAIL-CLOSED: PASS  continueOnFail false + Responder 503 on upstream error
  workflow x9PZMUr4NNvvlv8i active
  webhookPath homestead-content-studio POST
UPDATE IDEMPOTENCY: PASS  canary D same update_id → second duplicate:true  rows=1
TELEGRAM RETRY COMPATIBLE: PASS  Homestead 500 forgets update_id; n8n does not ACK 200 if Homestead fails

TELEGRAM

BOT COUNT: 1  (@HomesteadServicesNotifyBot)
WEBHOOK URL: https://n8n.autonomousflow.lat/webhook/homestead-content-studio
WEBHOOK DRIFT: PASS  match true  pending 0
9TG_GATEWAY: INACTIVE (not activated)
ADMIN ALLOWLIST: PASS  non-admin callback denied (canary D + isTelegramAdmin)

APPOINTMENTS

CHAT BOOKING: PASS  HS-2026-000034 / HA-67734e96  2026-08-23 16:00
HA PERSISTENCE: PASS
CALENDAR: PASS  /api/admin/appointments contains HA-67734e96
SLOT CONCURRENCY: PASS  two inserts same open slot → 1 winner (HA-wavea1)  open_slots duplicates=0
APPOINTMENT TELEGRAM: PASS  notices CONFIRMED then RESCHEDULED for HA-67734e96 (independent of solicitud Telegram)

SECURITY

HMAC: Homestead→n8n SIGNED PASS. n8n→Homestead HMAC NOT VERIFIED (n8n 2.3.6 cannot HMAC live payload). Secret + timestamp ±300s only. NOT a fake inbound HMAC PASS.
TIMESTAMP: PASS  ±300s  expired/future rejected 401
REPLAY PROTECTION: PASS  timestamp skew
SECRETS EXPOSED: PASS  not in Git / not in structured logs
FORGED CALLBACK: PASS  forged telegram-update 401  non-admin denied

OBSERVABILITY

PENDING EVENTS: 0
FAILED EVENTS: 0
OLDEST PENDING: none
LAST DISPATCH: DELIVERED HS-2026-000034
SCHEDULER FRESHNESS: last tick during canary C  HTTP 200

QUALITY

BUILD: PASS  next build 16.3.1
TESTS: PASS  npm test including test-automation-wave-a.mjs
E2E: PASS  canaries A–E (B after second attempt)
REGRESSION: PASS  form, chat, n8n request webhook v1, Content Studio path, reminders tick
SECURITY TESTS: PASS  missing/wrong secret, expired/future timestamp, forged update
SQLITE FINAL INTEGRITY: PASS  ok
  unique index idx_rev_appt_open_slot present

PERFORMANCE

CONTACT BEFORE: not re-sampled this wave (prior audit n8n leg 281 ms on HS-2026-000031)
CONTACT AFTER: 5163 ms client  HS-2026-000032 (await email; outbox drain is async)
OUTBOX OVERHEAD: n8n dispatch 801 ms after HTTP; SQLite outbox insert is in the persist transaction

DEFECTS

P0: none
P1: none
P2: first chat canary did not book 24 Aug 16:00; model only offered 23 Aug slots. Booking succeeded on offered 16:00 Sunday.
P3: HA-67734e96 ended RESCHEDULED after a second confirm of the same slot (still one open slot). Email success is logged but not stored as EMAIL channel row. eslint warnings in unrelated files.

GIT

PRE SHA: ab8fdfb28d54007f44ca83a6b3c2cb01f8068eab
CODE SHA: 0140c15ef89a1b1932fb0d1f71a39efe33b191f1
COMMITS: ab8fdfb safety · 0140c15 feat outbox
TAG: pre-automation-v2-wave-a-20260822-0308

ROLLBACK:
1. Set AUTOMATION_DISPATCH_ENABLED=false on homestead_web and recreate only that container.
2. Outbox table may remain unused. Do not DROP it.
3. Restore Homestead image/source from tag pre-automation-v2-wave-a-20260822-0308 if code rollback is required.
4. SQLite: keep current DB (requests/appointments/photos/content). Restore the 0308 sqlite copy ONLY if this wave corrupted data (integrity is ok; do not restore unless needed).
5. n8n: restore Content Studio from the 0308 dump/export only if webhook path drifted. Do not restart n8n postgres unless restoring n8n.
6. Confirm Telegram getWebhookInfo still equals https://n8n.autonomousflow.lat/webhook/homestead-content-studio
7. Do not activate 9TG_GATEWAY_V1.

FINAL VERDICT:

WAVE A CERTIFIED

==================================================
```

## Discrepancies (docs vs production)

| Topic | Docs/audit | Production + code after Wave A |
| --- | --- | --- |
| Content Studio ACK | continueOnFail true then HTTP 200 | continueOnFail false; 503 if Homestead fails; webhook responseNode |
| Chat escalate Telegram | sendNewLeadAlert + n8n | n8n via outbox only (one solicitud Telegram) |
| n8n inbound HMAC | sometimes described as signed | secret + timestamp only; HMAC generated Homestead→n8n |
| persist vs n8n | fire-and-forget notifyN8n | same SQLite transaction: service_requests + automation_outbox, then dispatcher |

## Live canary IDs (is_test=1)

| Canary | ID | Result |
| --- | --- | --- |
| A form | HS-2026-000032 / outbox 2909a047-… DELIVERED / TELEGRAM SENT | PASS |
| B chat book | HS-2026-000034 / HA-67734e96 2026-08-23 16:00 / admin citas yes | PASS |
| C n8n fail | HS-2026-000033 PENDING then DELIVERED attempts=2 / TELEGRAM SENT once | PASS |
| D update_id | 1687387260 first denied, second duplicate, 1 row | PASS |
| E slot race | HA-wavea1 wins 2026-12-31 11:00; second insert rejected | PASS |

## What was not done (Wave B+)

`/homestead` Command Center, Lead Rescue UX, SLA cards, quiet hours, job→content, reviews, customer follow-up, Meta publishing.

## Test map

| # | Result |
| --- | --- |
| 1 persist + outbox | PASS HS-32 |
| 2 unique idempotency | PASS unit + UNIQUE index |
| 3 n8n unavailable still saved | PASS HS-33 |
| 4 retry succeeds | PASS HS-33 after 30s |
| 5 delivered once | PASS attempts 1 or 2, one SENT |
| 6 concurrent dispatch | PASS conditional UPDATE claim unit |
| 7 FAILED replay | PASS code path; live used retry not dead-letter |
| 8 replay does not create HS | PASS dispatcher has no saveServiceRequest |
| 9 duplicate update_id | PASS canary D |
| 10 CS false ACK | PASS continueOnFail false + 503 node |
| 11 expected webhook URL | PASS |
| 12 non-admin callback denied | PASS canary D |
| 13 slot concurrency | PASS canary E |
| 14 chat still creates HA-* | PASS HA-67734e96 |
| 15 HA in /admin/citas | PASS |
| 16 form email | PASS log EmailNotificationSucceeded |
| 17 chat OpenAI | PASS canary B replies |
| 18 request Telegram once | PASS one SENT per HS |
| 19 appointment Telegram independent | PASS revenue_appointment_notices |
| 20 secrets absent | PASS |
