# WAVE E — GAP ANALYSIS

Date: 2026-08-22  
HEAD: `92b1fbe` (== origin/main)  
Method: code + Wave C certification + live Multi-Operator cert (NOT CERTIFIED) + absence of Wave D docs

## Dependency status

| Foundation | Status |
| --- | --- |
| Wave A | CERTIFIED |
| Wave B | CERTIFIED |
| Wave C | CERTIFIED (jobs, post-service, satisfaction, recovery, reviews foundation, maintenance foundation) |
| Wave D | **NOT CERTIFIED / NOT STARTED** (blocked earlier by Multi-Operator) |
| AI V3 / V3.1 | CERTIFIED |
| Telegram Multi-Operator V1 | **NOT CERTIFIED** (`PENDING SECOND ACCOUNT START`) |

### WAVE_D_DEPENDENCY_STATUS

**NOT_CERTIFIED_NOT_STARTED**

Wave E retention/reputation does **not** require Meta publishing. Content Studio opportunity remains human-approved (Wave C). Wave E proceeds with pieces **independent of Wave D**.

Do **not** claim Wave D regression PASS. Mark `WAVE_D: N/A_NOT_CERTIFIED`.

### MULTI_OPERATOR_STATUS

**NOT_CERTIFIED** (RBAC code deployed; dual live matrix pending second Telegram `/start`).

Wave E reuses existing `telegram_operators` / `hasTelegramPermission` / `adminChatIds(kind)`. Live dual recovery claim E2E remains blocked until second account starts — do not invent PASS.

---

## Domain map

### CUSTOMER IDENTITY

| | |
| --- | --- |
| EXISTS | `revenue_customers` (phone/email, `do_not_contact`, `marketing_opt_in`); Customer 360 Lite `/admin/clientes/[id]` |
| PARTIAL | No probabilistic merge (correct); limited preference dimensions |
| MISSING | Granular prefs: aftercare / review / maintenance / reactivation |
| REUSABLE | customer_id links on leads/jobs/appointments |
| MUST_NOT_TOUCH | Invented name-merge; parallel CRM tables |

### JOB COMPLETION

| | |
| --- | --- |
| EXISTS | `revenue_jobs` lifecycle; atomic complete; `job.completed` outbox |
| REUSABLE | Trigger for aftercare schedule |
| MUST_NOT_TOUCH | Duplicate `jobs_v2` |

### AFTERCARE

| | |
| --- | --- |
| EXISTS | Email follow-up via outbox `post_service.followup_due`; token `/experiencia/<token>`; idempotent send |
| PARTIAL | Global delay `POST_SERVICE_FOLLOWUP_DELAY_MINUTES` (default 120) — not service-aware |
| MISSING | Per-service playbook delay; free-text reply routing into satisfaction |
| BROKEN | — |
| REUSABLE | `deliverPostServiceFollowup`, `job_feedback_tokens` |
| MUST_NOT_TOUCH | WhatsApp unofficial API |

### SATISFACTION

| | |
| --- | --- |
| EXISTS | Buttons: EXCELLENT / GOOD / NEEDS_HELP; atomic claim; audit |
| PARTIAL | No NEUTRAL; no AI text classifier |
| MISSING | NEUTRAL path; structured AI parse of free text with server validation |
| REUSABLE | `recordSatisfaction`, experience UI |
| MUST_NOT_TOUCH | Fake satisfaction |

### SERVICE RECOVERY

| | |
| --- | --- |
| EXISTS | OPEN → CONTACTED; Telegram alert; outbox; no review on NEEDS_HELP |
| PARTIAL | No RESOLVED / priority / assigned_operator / recovery follow-up |
| MISSING | URGENT safety elevation; resolve + post-resolve aftercare; claim/assignment |
| REUSABLE | `openServiceRecovery`, `markRecoveryContacted`, `adminChatIds("recovery")` |
| MUST_NOT_TOUCH | `service_recovery_v2` parallel table |

### REVIEWS

| | |
| --- | --- |
| EXISTS | Positive → optional `HOMESTEAD_REVIEW_URL`; click track `/experiencia/.../resena`; no fake posted |
| PARTIAL | URL unset in prod → REQUEST_NOT_CONFIGURED (honest) |
| MISSING | Confirmed-external ingestion (API) — out of scope if no API |
| REUSABLE | `maybeRequestReview`, reminder outbox when hours > 0 |
| MUST_NOT_TOUCH | Invented Google URL; 5-star pressure |

### RETENTION / MAINTENANCE

| | |
| --- | --- |
| EXISTS | `recommended_next_service_at` + `revenue_maintenance` OPEN on complete; admin visible |
| PARTIAL | Foundation only — **no customer maintenance message** (Wave C explicit) |
| MISSING | Due processor → customer contact; BOOKED via Booking V2; status machine DUE/CONTACTED/… |
| REUSABLE | `maintenanceIntervalsDays` in revenue-engine.json |
| MUST_NOT_TOUCH | Auto-create HA without confirmation |

### REACTIVATION

| | |
| --- | --- |
| EXISTS | — |
| MISSING | Eligibility engine, frequency cap, attributed HS source, opt-out |
| MUST_NOT_TOUCH | Monthly blast to all customers |

### PREFERENCES / SUPPRESSION

| | |
| --- | --- |
| EXISTS | `do_not_contact` skips follow-up; marketing_opt_in column |
| PARTIAL | Single blunt DNC; marketing_opt_in unused for retention sends |
| MISSING | Preference matrix; marketing suppression vs transactional; opt-out UX |
| REUSABLE | `do_not_contact` |

### TELEGRAM

| | |
| --- | --- |
| EXISTS | Command Center followups `cc:f`; recovery alert + `cc:t`; Multi-Op RBAC code |
| PARTIAL | No dedicated “❤️ Clientes” retention panel |
| MISSING | retention/recovery permission matrix entries; recovery resolve actions |
| MUST_NOT_TOUCH | Second bot / second webhook |

### ADMIN UI

| | |
| --- | --- |
| EXISTS | Jobs list/detail; customer 360 lite; followups via Telegram |
| MISSING | `/admin/retencion` dashboard; recovery queue prioritized |
| MUST_NOT_TOUCH | Developer-looking raw dumps |

### ANALYTICS

| | |
| --- | --- |
| EXISTS | ops_audit + revenue_events for satisfaction/recovery/review |
| MISSING | Retention dashboard metrics aggregation; repeat_customer_rate |

---

## Reuse mandate (Wave E §2)

**DO NOT create:** `service_recovery_v2`, `customer_satisfaction_v2`, `jobs_v2`.

**EVOLVE:** `post-service.ts`, `job-store.ts`, `job-config.ts`, `revenue_jobs` columns, `revenue_maintenance`, experience pages, Command Center.

---

## Implementation priority (independent of Wave D)

1. Preferences + frequency cap + open-recovery marketing block  
2. NEUTRAL satisfaction + recovery RESOLVED + follow-up  
3. Service-aware aftercare delay (playbook)  
4. Maintenance due processor (message once, no auto-book)  
5. Reactivation engine (deterministic, capped)  
6. Admin `/admin/retencion` + Telegram retention entry  
7. Attribution sources for retention → HS  
8. Tests + live canaries (single operator; dual-op pending)

## Explicit non-goals this wave

- Wave D / Meta publish  
- Customer 360 expansion (Wave F)  
- Fake review confirmation  
- Dual-operator live matrix (blocked on second Telegram start)
