# Pre-Go-Live Data Cleanup

**Purpose:** Remove test/E2E operational data before first real customer traffic.  
**WARNING:** Do **not** run against production without owner sign-off and verified backup.

## Protect (never delete)

- Admin credentials / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET`
- Role and operator configuration
- Integration settings (n8n URL, Telegram chat IDs, SMTP)
- Reference/catalog data required for services
- Production customer HS/HA with real contact info

## Typical test artifacts to identify

| Area | Indicator | Action |
|------|-----------|--------|
| HS IDs | `HS-2026-*` from e2e-cert scripts, `DRILL`, `BUI`, benchmark prefixes | Delete after export if needed |
| DATA_DIR | Path contains `e2e-cert` | Never point production at this dir |
| Conversations | `concierge_conversations` for test sessions | Purge test rows |
| operational_signals | Signals from adversarial/autonomous cert | Resolve or delete test signals |
| automation_outbox | PENDING/FAILED test events | Drain or purge with audit |
| Photos | Under `data/photos/` for test HS IDs | Remove orphaned dirs |
| Content jobs | DRAFT test posts | Delete in Content Studio admin |

## Safe procedure

1. **Full backup:** `node scripts/production-backup.mjs`
2. Export list of HS/HA to review with owner
3. Work on **copy** or maintenance window with app stopped
4. SQL deletes only with explicit `public_id` / `lead_id` list — no broad `DELETE FROM service_requests`
5. Run `PRAGMA integrity_check`
6. Restart app, verify `/api/ready`
7. Retain backup until owner confirms cleanup

## Scripts (VPS — use with care)

Existing maintenance scripts under `deploy/vps/` (e.g. `safe-test-data-cleanup.py`) may be used **only** after owner review of scope.

## Not in scope

- Rotating secrets (separate runbook)
- DNS/TLS changes
- Enabling dry-run=false flags (owner go-live matrix)
