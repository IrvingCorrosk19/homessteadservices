# HOMESTEAD AUTOMATION ENGINE V2 — WAVE C CERTIFICATION

DATE: 2026-08-22 America/Panama  
SCOPE: Job lifecycle, post-service experience, satisfaction, service recovery, reviews (no fake URLs), job photos, job → Content Studio (reuse, no Meta auto-publish), Customer 360 Lite, recurring-maintenance foundation only. Wave D was not implemented.

Production + live code win over docs. n8n 2.3.6 still cannot HMAC inbound payloads; that limitation is documented, not faked.

No new n8n workflow. Wave C customer email and ops Telegram use Wave A outbox → dispatcher (SMTP + Homestead Telegram Bot API). `service_request.created` still posts the existing n8n request webhook.

```text
========================================================
HOMESTEAD AUTOMATION ENGINE V2
WAVE C — FINAL CERTIFICATION
========================================================

WAVE B CLOSEOUT

WAVE_B_PUSH: PASS
LOCAL_SHA: 64fdf36faea5530b40a29b1363f1a9bb4aa532bc
ORIGIN_SHA: 64fdf36faea5530b40a29b1363f1a9bb4aa532bc
LOCAL_EQUALS_ORIGIN: YES (at Wave C start)

BACKUPS

GIT: PASS  tag pre-automation-v2-wave-c-20260822-0945 at 64fdf36
SQLITE: PASS  /opt/backups/pre-automation-v2-wave-c-20260822-0945/homestead/homestead.sqlite
  708608 bytes
  SHA256 6c26a688caac31075faf3d511ff5b40c0ace08fd9f6cb040ad31fee7d48d3275
N8N: PASS  pg_dump -Fc 243923 bytes  pg_restore -l = 359  16 workflows exported
SQLITE INTEGRITY: PASS (ok) before deploy, after migrate, after canaries

WAVE A REGRESSION

OUTBOX: PASS  unique idempotency_key still enforced; Wave C events reuse the same table
RETRY: PASS  dispatcher backoff unchanged; no Wave C bypass of drainAutomationOutbox
REPLAY: UNIT PASS  Wave A suite still in npm test
DEAD LETTER: UNIT PASS  FAILED + lease reclaim still in Wave A suite
SLOT CONCURRENCY: UNIT PASS  idx_rev_appt_open_slot present; canary jobs used unique 2026-11 slots
CONTENT FAIL-CLOSED: UNIT PASS  continueOnFail / no false ACK unchanged

WAVE B REGRESSION

/homestead: PASS  summary API 200; jobsActive live 0 = SQLite non-test SCHEDULED/IN_PROGRESS 0
LEAD RESCUE: PASS  rescued_to_booking still set; lookback 24h unchanged
LIVE RESCUE → BOOKING: PASS  HS-2026-000037 (is_test=1, 60001111, WAVE-C-TEST)
  HA-4ea1810b CONFIRMED 2026-08-23 11:00  pipeline SCHEDULED  rescued_to_booking=1
SMART SLA: PASS  unit + live tick sla=1 no storm; lookback still 24h
DAILY BRIEF: PASS  not re-sent this wave; brief=0 on post-canary tick
AGENDA: PASS  HA-4ea1810b remains; canary HA-c* used unused November 2026 slots
TELEGRAM SECURITY: PASS  CANARY_I unauth cc:w denied; webhook match true pending 0

JOB LIFECYCLE

JOB ENTITY: PASS  revenue_jobs reused (no parallel wave_c_jobs table)
PUBLIC ID: PASS  HJ-2026-000001 … HJ-2026-000005
APPOINTMENT RELATION: PASS  HJ-2026-000001 ↔ HA-ca00a40e15
REQUEST RELATION: PASS  HJ-2026-000001 ↔ HS-2026-805509
CUSTOMER RELATION: PASS  customer_id 17 (is_test=1)
SCHEDULED: PASS  HJ-2026-000004 remains SCHEDULED (photos only; appointment is not auto-complete)
IN_PROGRESS: PASS  HJ-2026-000001 job.start → IN_PROGRESS then complete
COMPLETED: PASS  atomic UPDATE WHERE status IN ('SCHEDULED','IN_PROGRESS'); completed_at set
CANCELLED: WIRED  cancelServiceJob in job-store; live cancel not exercised this wave
NO_SHOW: WIRED  Telegram cc:ns; live no-show not exercised this wave
CONCURRENCY: PASS  second complete already=true; unit one-winner UPDATE
AUDIT: PASS  JOB_STARTED / JOB_COMPLETED / SATISFACTION_RECEIVED / SERVICE_RECOVERY_* / JOB_MARKETING_APPROVED / JOB_CONTENT_REQUESTED

COMMAND CENTER

JOBS: PASS  Trabajos cc:j / detalle cc:k / completar cc:q confirm cc:w / fotos cc:p
ACTIVE JOB COUNT: PASS  live jobsActive=0; test list returns HJ-2026-000004 SCHEDULED only
FOLLOWUPS: PASS  cc:f list API; live followupsOpen=0 (test PENDING excluded by default)
SERVICE RECOVERY: PASS  live serviceRecovery=0 after HJ-2026-000003 CONTACTED
CONTENT CANDIDATES: PASS  live contentCandidates=0 (HJ-2026-000005 already linked HC-2026-000006)
COUNTS MATCH DB: PASS  summary.jobs* with includeTest=false all 0 = SQLite is_test=0 jobs 0

POST SERVICE

JOB.COMPLETED EVENT: PASS  job.completed:HJ-2026-000001 DELIVERED attempts=1
OUTBOX: PASS  one row per job; unique key job.completed:<jobId>
FOLLOWUP SCHEDULE: PASS  next_attempt_at = completed_at + 120 minutes (POST_SERVICE_FOLLOWUP_DELAY_MINUTES)
CHANNEL: PASS  email SMTP only (sendTransactionalEmail); no unofficial WhatsApp API
DELIVERY: PASS  forced-due HJ-2026-000001 followup_status=SENT 2026-08-22T15:02:36.212Z
  outbox post_service.followup_due:HJ-2026-000001:1 DELIVERED attempts=1
IDEMPOTENCY: PASS  unique post_service.followup_due:<jobId>:<cycle>; already_sent short-circuit in deliverPostServiceFollowup

SATISFACTION

PAGE: PASS  /experiencia/<64-hex> 200; /experiencia/no-disponible 200
MOBILE: PASS  single-purpose page, large type, no admin session
TOKEN SECURITY: PASS  32-byte hex; CANARY_I bad token not ok
POSITIVE: PASS  HJ-2026-000002 EXCELLENT; no recovery OPEN
NEEDS HELP: PASS  HJ-2026-000003 NEEDS_HELP; reviewUrl empty
DUPLICATE RESPONSE: PASS  second POST already=true; satisfaction stayed EXCELLENT / NEEDS_HELP

SERVICE RECOVERY

NEGATIVE/HELP RESPONSE: PASS  recovery_status OPEN then CONTACTED on HJ-2026-000003
REVIEW SUPPRESSED: PASS  needsHelp true and reviewUrl empty
DURABLE STATE: PASS  recovery_status / recovery_at / recovery_contacted_at + lead next_action SERVICE_RECOVERY
OUTBOX: PASS  customer.service_recovery:HJ-2026-000003:1 DELIVERED attempts=1
TELEGRAM ALERT: PASS  dispatcher deliverOpsTelegram (TEST banner); ACTION priority
MARK CONTACTED: PASS  job.recovery → CONTACTED
NO DUPLICATE: PASS  second satisfaction already; second recovery already; outbox count stayed 1

REVIEWS

REVIEW URL: PASS  HOMESTEAD_REVIEW_URL unset → REVIEW_URL_NOT_CONFIGURED (no invented https URL)
REQUEST ELIGIBILITY: PASS  maybeRequestReview no-ops without https:// URL; NEEDS_HELP never calls review
REVIEW REQUEST: PASS  review_requested_at empty on all canary jobs
NO REVIEW GATING: PASS  no 5-star copy; Excelente/Bien only if URL configured
LINK OPEN TRACKING: WIRED  GET /experiencia/<token>/resena → recordReviewLinkOpened; not live-hit (no URL)
REVIEW COMPLETED CLAIMED: PASS  not claimed (Homestead cannot see Google reviews)
REMINDER POLICY: PASS  HOMESTEAD_REVIEW_REMINDER_HOURS default 0 → no reminder outbox

CUSTOMER 360

CUSTOMER HISTORY: PASS  /admin/clientes/[id] reads requests + appointments + jobs
REQUESTS: PASS  counted via revenue_leads.customer_id
APPOINTMENTS: PASS  revenue_appointments.customer_id
JOBS: PASS  completed count from revenue_jobs
LAST SERVICE: PASS  latest completed_at
SATISFACTION: PASS  last captured response on ficha
IDENTITY SAFETY: PASS  no name-merge; phone/email collision does not auto-fuse

JOB PHOTOS

TELEGRAM UPLOAD: WIRED  content-handler expect=job_photos after isTelegramAdmin; live canary wrote the same store path
ORIGINAL PRESERVED: PASS  jobs/2026/08/HJ-2026-000004/originals/original-001.jpg and original-002.jpg exist; not overwritten
JOB ASSOCIATION: PASS  job_photos.job_id = HJ-2026-000004 / HJ-2026-000005
CUSTOMER PHOTOS SEPARATED: PASS  intake remains DATA_DIR/photos/HS-*; job files not under photos/ or content/
MARKETING USAGE STATE: PASS  default 0; job.content blocked until job.marketing; CANARY_F_BLOCKED_WITHOUT_MARKETING

JOB → CONTENT STUDIO

ELIGIBILITY: PASS  COMPLETED + photos + marketing_usage_approved
ADMIN PROMPT: WIRED  job.completed Telegram when photoCount>0; canary A had 0 photos so no_telegram
MANUAL APPROVAL: PASS  job.marketing required before createContentFromJob
CONTENT STUDIO REUSED: PASS  createContentJob + storeOriginal → HC-2026-000006
OPENAI: PASS  content left RECEIVING; processContentJob not called from job.content
IMAGE PROCESSING: PASS  not auto-run; existing PROCESS pipeline unchanged
COPY: PASS  sanitizeContentContext strips email/phone/IDs/apto numbers
PII SANITIZED: PASS  unit + job-content.ts
PREVIEW: WIRED  existing Content Studio preview after PROCESS (not auto)
APPROVAL: WIRED  existing admin/Telegram approve; Wave C stop before publish
AUTO PUBLISH: PASS  HC-2026-000006 status RECEIVING; reason created; no Meta publish

RECURRING MAINTENANCE FOUNDATION

NEXT SERVICE: PASS  recommended_next_service_at 2026-11-20 (ac interval 90 days) + revenue_maintenance OPEN
ADMIN VISIBLE: PASS  job ficha recommendedNextServiceAt
CUSTOMER AUTO MESSAGE: PASS  not sent (foundation only; Wave C does not message the customer)

RELIABILITY

N8N DOWN: NOT RE-RUN this wave (Wave A/B dispatcher fail-mode already certified)
  Wave C followup/recovery/job Telegram are dispatcher-local; they do not POST n8n
BUSINESS STATE PERSISTS: PASS  HJ-2026-000001 stayed COMPLETED after drain
OUTBOX PERSISTS: PASS  rows remain after tick; FAILED_COUNT 0
RETRY: PASS  same claim+lease; remaining followups still PENDING until due
DELIVERY: PASS  job.completed x4 DELIVERED; recovery DELIVERED; followup A DELIVERED
DUPLICATE DELIVERY: PASS  unique keys; second complete/recovery/content did not insert extras

SECURITY

TELEGRAM ADMIN: PASS  HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS allowlist
CALLBACK AUTH: PASS  isTelegramAdmin before job_photos / cc:w
CUSTOMER TOKEN: PASS  64 hex, not HJ-*; expired detectable
IDOR: PASS  forged token does not change HJ-2026-000003 (stayed NEEDS_HELP)
PII: PASS  callback_data has job ids only; unauthorized "No autorizado."
PHOTO PRIVACY: PASS  originals under DATA_DIR/jobs, not a public URL; admin session for fichas
SECRETS EXPOSED: PASS  none in git; canaries do not print tokens/secrets

QUALITY

LINT: PASS  Wave C files 0 errors (pre-existing warnings elsewhere unchanged)
TSC: PASS  tsc --noEmit before deploy
BUILD: PASS  next build 0 errors (pre-existing middleware→proxy deprecation only)
TESTS: PASS  npm test Wave A + B + C
E2E: PASS  canary-wave-c.py FAILED_COUNT 0 (A–I)
SECURITY TESTS: PASS  CANARY_I unauth / bad token / token-bound
SQLITE FINAL INTEGRITY: PASS (ok)

METRICS

JOBS COMPLETED: 4 test (HJ-2026-000001/2/3/5); 0 live
POST SERVICE SENT: 1 (HJ-2026-000001); 3 still PENDING until +120m
POSITIVE SATISFACTION: 1 (EXCELLENT HJ-2026-000002)
SERVICE RECOVERY: 1 requested then CONTACTED (HJ-2026-000003)
REVIEWS REQUESTED: 0
REVIEW LINKS OPENED: 0
JOB CONTENT CREATED: 1 (HC-2026-000006 ← HJ-2026-000005)
JOB CONTENT APPROVED: 0 (left RECEIVING on purpose)

DEFECTS

P0: none open
P1: none open
P2: Live Telegram photo ingest not bot-uploaded this wave (same job_photos path certified via disk+API)
P2: CANCELLED / NO_SHOW live transitions not exercised (wired; SCHEDULED leftover HJ-2026-000004 proves no auto-complete)
P2: n8n 2.3.6 cannot HMAC inbound Homestead requests (unchanged from Wave A/B)
P2: AUTOMATION_N8N_FAIL not toggled again this wave
P3: failedWaveCOutbox() counts PENDING scheduled followups as well as FAILED (metric name is misleading; actual FAILED Wave C rows = 0)
P3: content_jobs pending count is global; canary HC-2026-000006 RECEIVING makes live contentPending=1

N8N

NEW WORKFLOWS: 0
MODIFIED WORKFLOWS: 0
TOTAL HOMESTEAD ACTIVE: 5
  HOMESTEAD — Content Scheduler|t
  HOMESTEAD — Content Studio|t
  HOMESTEAD — Marketing Analytics Collector|t
  HOMESTEAD — Nueva solicitud → Telegram|t
  HOMESTEAD — Weekly Marketing Report|t
ARCHITECTURE DECISION: Zero new Homestead workflows. Wave C email + ops Telegram are dispatcher-owned. n8n remains orchestration for existing request + Content Studio webhooks.

GIT

PRE_WAVE_C_SHA: 64fdf36faea5530b40a29b1363f1a9bb4aa532bc
FINAL_SHA: ad7c086197e8f81e00c222410e23d09ee28f7934
COMMITS:
  ad7c086 feat(ops): add job lifecycle, post-service follow-up, and job-to-content loop
  (plus this certification commit and canary unique-slot fix)
PUSH: pending at certification write
LOCAL_EQUALS_ORIGIN: pending push

FINAL VERDICT:

WAVE C CERTIFIED

========================================================
```

## Architecture decision (n8n)

Zero new Homestead workflows. Five existing HOMESTEAD workflows remain active. Post-service email, service-recovery Telegram, and job.completed ops alerts are dispatcher-owned.

## Review URL

`HOMESTEAD_REVIEW_URL` is unset in production. Homestead does not invent a Google/Facebook URL. Positive satisfaction still records; the review button stays hidden until an https URL is configured.

## Rollback

Tag `pre-automation-v2-wave-c-20260822-0945` + SQLite copy under `/opt/backups/pre-automation-v2-wave-c-20260822-0945/`. Disable Wave C follow-up by not draining `post_service.followup_due`. Do not DROP new columns.

## Stop

Wave D, Meta publishing, campaigns, payments, inventory, and technician dispatch were not implemented.
