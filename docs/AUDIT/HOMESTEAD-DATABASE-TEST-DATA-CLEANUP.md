# HOMESTEAD — DATABASE TEST DATA CLEANUP

**Date (UTC):** 2026-08-26T23:38:07Z  
**Environment:** Production VPS (`homestead.lat` / `164.68.99.83`)  
**Operator:** Automated safe cleanup (`deploy/vps/safe-test-data-cleanup.py`)

---

## DATABASE

| Field | Value |
|-------|-------|
| Engine | SQLite 3 |
| Path | `/opt/apps/homestead/data/homestead.sqlite` |
| Pre-cleanup integrity | `ok` |
| Post-cleanup integrity | `ok` |
| Tables discovered | 50 |

---

## BACKUP

| Field | Value |
|-------|-------|
| Timestamp (UTC) | 2026-08-26T23:38:07Z |
| Directory | `/opt/backups/homestead-cleanup-20260826-233807/` |
| File | `/opt/backups/homestead-cleanup-20260826-233807/homestead.sqlite` |
| Size | 2,023,424 bytes (~1.93 MiB) |
| Table count in backup | 50 |
| Manifest | `/opt/backups/homestead-cleanup-20260826-233807/manifest.json` |

---

## BACKUP_VERIFIED

| Check | Result |
|-------|--------|
| `PRAGMA integrity_check` | `ok` |
| Backup file exists | yes |
| Table count matches source | yes (50) |
| Proceed after backup | yes |

---

## TABLES_DISCOVERED

50 application tables (excluding `sqlite_*` internals):

`automation_engine_state`, `automation_outbox`, `automation_outbox_audit`, `concierge_conversations`, `concierge_events`, `concierge_intelligence`, `concierge_messages`, `concierge_photos`, `concierge_usage`, `content_assets`, `content_counters`, `content_events`, `content_jobs`, `content_publications`, `content_settings`, `content_telegram_updates`, `content_usage`, `content_versions`, `copilot_audit`, `copilot_confirmations`, `copilot_metrics`, `copilot_sessions`, `copilot_usage`, `job_feedback_tokens`, `job_photos`, `marketing_leads`, `marketing_recommendations`, `marketing_snapshots`, `ops_audit`, `request_counters`, `retention_actions`, `revenue_appointment_notices`, `revenue_appointments`, `revenue_customers`, `revenue_events`, `revenue_followups`, `revenue_job_counters`, `revenue_jobs`, `revenue_leads`, `revenue_maintenance`, `revenue_operator_pending`, `revenue_quote_counters`, `revenue_quotes`, `revenue_referrals`, `revenue_reviews`, `service_request_messages`, `service_requests`, `telegram_operator_audit`, `telegram_operator_metrics`, `telegram_operators`

**Classification summary:**

| Class | Count | Notes |
|-------|-------|-------|
| AUTH | 1 table | `telegram_operators` (Telegram/copilot identities) |
| SYSTEM_CONFIG | 8 tables | settings, counters, engine state, copilot metric keys |
| OPERATIVE_TEST_DATA | 41 tables | transactional / audit / outbox / chat / revenue / content jobs |
| LOOKUP/MASTER | 0 | no separate lookup tables in this schema |
| UNCERTAIN | 0 | all tables mapped before delete |

**Auth discovery (critical):**

- **Admin dashboard login** does **not** use a DB `users` table. Authentication is env-based: `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` in `/opt/apps/homestead/deploy/vps/.env` (unchanged).
- **Telegram operators** (`telegram_operators`) are the DB-backed operator identities for Telegram, Content Studio, and Copilot.

---

## PRESERVED_TABLES

| Table | Rows before | Rows after | Reason |
|-------|-------------|------------|--------|
| `content_settings` | 1 | 1 | Content Studio schedule/config |
| `telegram_operators` | 2 | 2 | Operator identities & roles |
| `request_counters` | 1 | 1 | HS folio sequence (2026 → 99) |
| `content_counters` | 1 | 1 | Content job sequence |
| `revenue_quote_counters` | 1 | 1 | Quote numbering |
| `revenue_job_counters` | 1 | 1 | Job numbering |
| `automation_engine_state` | 5 | 5 | Outbox engine cursors |
| `copilot_metrics` | 10 | 10 | Copilot metric key registry |

**Sequences intentionally not reset** (Phase 10): next HS will be `HS-2026-000100`.

---

## AUTH_TABLES

| Mechanism | Storage | Preserved |
|-----------|---------|-----------|
| Admin login | `.env` (`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`) | yes — not modified |
| Telegram operators | `telegram_operators` | 2 rows preserved |
| Operator audit/metrics | `telegram_operator_audit`, `telegram_operator_metrics` | rows cleared (operational history only) |

---

## CONFIG_TABLES

| Table | Action |
|-------|--------|
| `content_settings` | PRESERVE (1 row) |
| `automation_engine_state` | PRESERVE (5 keys) |
| `copilot_metrics` | PRESERVE (10 keys) |
| `telegram_operators` | PRESERVE (2 operators) |
| All counter tables | PRESERVE |

`.env`, Docker secrets, SMTP, Telegram, OpenAI, n8n credentials: **not touched**.

---

## CLEANED_TABLES

Deleted in FK-safe child→parent order (no `PRAGMA foreign_keys=OFF`).

| Table | Rows deleted |
|-------|-------------|
| `automation_outbox` | 348 |
| `automation_outbox_audit` | 0 |
| `concierge_events` | 1,202 |
| `concierge_messages` | 808 |
| `concierge_intelligence` | 345 |
| `concierge_usage` | 501 |
| `concierge_photos` | 21 |
| `concierge_conversations` | 146 |
| `revenue_events` | 837 |
| `ops_audit` | 538 |
| `service_request_messages` | 175 |
| `service_requests` | 105 |
| `revenue_leads` | 106 |
| `revenue_followups` | 97 |
| `revenue_appointments` | 16 |
| `revenue_appointment_notices` | 38 |
| `revenue_jobs` | 5 |
| `revenue_customers` | 23 |
| `revenue_maintenance` | 4 |
| `content_telegram_updates` | 384 |
| `content_assets` | 77 |
| `content_jobs` | 12 |
| `content_versions` | 12 |
| `content_events` | 31 |
| `content_publications` | 4 |
| `content_usage` | 38 |
| `marketing_leads` | 67 |
| `copilot_audit` | 14 |
| `copilot_usage` | 6 |
| `telegram_operator_audit` | 15 |
| `telegram_operator_metrics` | 6 |
| `job_photos` | 4 |
| `job_feedback_tokens` | 4 |
| *(others)* | 0 |

**Total rows deleted:** 5,989

---

## ROWS_BEFORE / ROWS_DELETED / ROWS_AFTER (operative highlights)

| Metric | Before | After |
|--------|--------|-------|
| `service_requests` (HS-*) | 105 | 0 |
| `revenue_appointments` (HA-*) | 16 | 0 |
| `revenue_jobs` | 5 | 0 |
| `revenue_customers` | 23 | 0 |
| `revenue_leads` | 106 | 0 |
| `concierge_conversations` | 146 | 0 |
| `concierge_messages` | 808 | 0 |
| `concierge_photos` | 21 | 0 |
| `automation_outbox` | 348 | 0 |
| `content_jobs` | 12 | 0 |
| `content_assets` | 77 | 0 |
| `telegram_operators` | 2 | 2 |

---

## USERS_BEFORE / USERS_AFTER / USERS_PRESERVED

| Identity type | Before | After | Match |
|---------------|--------|-------|-------|
| Admin (env auth) | configured | configured | yes |
| Telegram operators (DB) | 2 | 2 | yes |

**Preserved operators (no secrets):**

| ID | Display name | Role | Active |
|----|--------------|------|--------|
| 1 | Owner | OWNER | yes |
| 2 | Irving CORRO | ADMIN | yes |

---

## OPERATIONAL DELETIONS

| Category | Count |
|----------|-------|
| REQUESTS_DELETED | 105 |
| APPOINTMENTS_DELETED | 16 |
| CUSTOMERS_DELETED | 23 |
| CHAT_SESSIONS_DELETED | 146 |
| CHAT_MESSAGES_DELETED | 808 |
| PHOTOS_DELETED (DB refs) | 25 (21 concierge + 4 job) |
| OUTBOX_DELETED | 348 |
| CONTENT_DATA_DELETED | 12 jobs + 77 assets + related rows |

---

## FILES_DELETED / FILES_PRESERVED

| Path | Before | After | Action |
|------|--------|-------|--------|
| `/opt/apps/homestead/data/photos/` | 54 files | 0 | cleared |
| `/opt/apps/homestead/data/concierge/` | 21 files | 0 | cleared |
| `/opt/apps/homestead/data/jobs/` | 4 files | 0 | cleared |
| `/opt/apps/homestead/data/content/` | 77 files | 0 | cleared |
| `public/images/*` (site assets) | — | — | **preserved** |
| `.env` / secrets | — | — | **preserved** |

Top-level entries removed from data dirs: **114**

---

## ORPHAN_CHECK

| Check | Result |
|-------|--------|
| `service_request_messages` without `service_requests` | 0 |
| `revenue_leads` without `revenue_customers` | 0 |

---

## FOREIGN_KEY_CHECK

| Check | Result |
|-------|--------|
| Delete order | child tables first, explicit order |
| `PRAGMA foreign_keys=OFF` | not used |
| Transaction rollback on error | implemented (`BEGIN IMMEDIATE` + rollback) |
| Post-delete integrity | `ok` |

---

## LOGIN_AFTER_CLEANUP

| Test | Result |
|------|--------|
| `/admin/login` | 200 |
| Wrong password → `/api/admin/login` | 401 |
| Valid admin login | 200 |
| Env auth keys present | yes (password/secret not exposed) |

---

## ADMIN_DASHBOARD

| Page | Authenticated status |
|------|---------------------|
| `/admin/solicitudes` | 200 |
| `/admin/citas` | 200 |
| `/admin/clientes` | 200 |
| `/admin/retencion` | 200 |

All operative list pages load empty/clean after cleanup.

---

## REQUESTS_PAGE / APPOINTMENTS_PAGE / CUSTOMERS_PAGE

Verified via authenticated HTTP smoke (`deploy/vps/post-cleanup-smoke.py`):

- Solicitudes: empty (0 HS rows)
- Citas: empty (0 HA rows)
- Clientes: empty (0 customers)

---

## CANARY_CREATE / CANARY_FLOW / CANARY_REMOVED

| Step | Result |
|------|--------|
| CANARY_CREATE | `POST /api/contact` → `HS-2026-000099` (200) |
| CANARY_FLOW | 1 row in `service_requests`, 1 row in `automation_outbox` |
| CANARY_REMOVED | yes — canary HS + outbox correlation deleted |
| Post-canary DB | 0 requests, 0 outbox |

Demonstrates system can create new operational data after cleanup without missing config.

---

## P0 / P1

| Severity | Count | Items |
|----------|-------|-------|
| P0 | 0 | — |
| P1 | 0 | — |

---

## FINAL VERDICT

# DATABASE CLEANUP CERTIFIED

Homestead is functional with preserved admin auth, Telegram operators, Content Studio settings, automation engine state, folio counters, and integrations configuration. All identified operational/test transactional data and associated upload files were removed. Login, admin pages, and post-cleanup canary flow verified successfully.

---

## Scripts used

| Script | Purpose |
|--------|---------|
| `deploy/vps/safe-test-data-cleanup.py` | Audit, backup, transactional delete |
| `deploy/vps/post-cleanup-smoke.py` | Login, admin pages, canary HS |

## Restore procedure (if needed)

```bash
cp /opt/backups/homestead-cleanup-20260826-233807/homestead.sqlite \
   /opt/apps/homestead/data/homestead.sqlite
docker restart homestead_web
```

Verify with `python3 /tmp/safe-test-data-cleanup.py --audit`.
