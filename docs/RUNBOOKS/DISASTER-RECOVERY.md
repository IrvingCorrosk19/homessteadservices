# Disaster Recovery Runbook

**Architecture:** Single Next.js container on VPS, SQLite at `/app/data/homestead.sqlite` (host `/opt/apps/homestead/data`), nginx TLS → `127.0.0.1:3091`.

## Quick triage

| Symptom | Likely cause | First action |
|---------|--------------|--------------|
| Site 502/504 | Container down / unhealthy | `docker compose ps`, check `/api/health` |
| Admin works, no new HS | OpenAI or concierge error | Check logs, `AI_CONCIERGE_DRY_RUN` |
| No Telegram alerts | Bot/webhook/n8n | See `docs/AUDIT/TELEGRAM_EXTERNAL_BLOCKER.md` |
| Scheduler stale | n8n cron missed | Check `last_scheduler_at` via `/api/ready` |
| DB errors | SQLite corruption / disk full | Stop writes, integrity check, restore |

## Bad deployment

1. Do **not** restore old DB for a normal code rollback.
2. Roll back image/tag: `docker compose pull && docker compose up -d` (previous tag).
3. Verify `/api/health` (200) and `/api/ready` (200, database ok).
4. Spot-check HS/HA in admin calendar.

## App unavailable

```bash
cd /opt/apps/homestead
docker compose -f deploy/vps/docker-compose.yml logs --tail=200 homestead_web
curl -sS http://127.0.0.1:3091/api/health
curl -sS http://127.0.0.1:3091/api/ready
docker compose restart homestead_web
```

## SQLite corruption

1. Stop container: `docker compose stop homestead_web`
2. Copy damaged files aside (do not delete only copy).
3. Run integrity on backup copy: `PRAGMA integrity_check`
4. Restore from latest good backup (see below).
5. Start container and verify counts.

## Persistent volume unavailable

- Mount failure → container may start empty DB. **Stop immediately** to avoid split-brain.
- Fix mount at `/opt/apps/homestead/data` before restart.
- If empty DB was created, restore from backup into volume.

## OpenAI down

- Customer AI uses deterministic fallbacks where implemented.
- Readiness may stay **200** (OpenAI is not a critical readiness dependency).
- Outbox retains events; no duplicate HS/HA from retries (idempotency keys).

## Telegram down

- Web admin and HS/HA creation continue.
- Notifications queue in `automation_outbox`; drain when n8n/Telegram returns.
- No notification storm: backoff + idempotency.

## n8n down

- `/api/internal/content/scheduler-tick` fails; `last_scheduler_at` goes stale (readiness **degraded** after 2h).
- Missed ticks: next successful scan catches aging/upcoming conditions.
- Verify duplicate ticks do not duplicate business actions (idempotency).

## Outbox backlog

1. Check `/api/ready` → `outbox.pending` / `outbox.failed`
2. Fix downstream (n8n, Telegram, SMTP)
3. Allow dispatch drain; monitor for duplicates
4. Failed items: inspect `last_error` in DB admin tools

## Restore from backup

**Never overwrite live production without explicit owner approval.**

On host (isolated restore first):

```bash
# Create backup (online SQLite backup + files)
DATA_DIR=/opt/apps/homestead/data node scripts/production-backup.mjs --dest /opt/backups/$(date +%Y%m%d-%H%M)

# Restore to NEW directory for verification
node scripts/production-restore.mjs --from /opt/backups/TIMESTAMP --dest /opt/restore-test/data --force

# After verification only, owner may swap DATA_DIR contents with container stopped
```

Retention: `BACKUP_RETAIN_COUNT` (default 7). Newest backups are never deleted if only one valid copy exists.

## Contacts / owner actions

- Production secrets: owner-managed `.env` on VPS
- Telegram live canary: owner authorization required
- Dry-run → go-live flags: see dry-run matrix in readiness doc
