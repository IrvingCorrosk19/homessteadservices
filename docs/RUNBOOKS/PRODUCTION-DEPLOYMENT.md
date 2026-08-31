# Production Deployment Runbook

**Target:** VPS with Docker Compose, nginx, persistent volume.  
**Public URL:** `https://homestead.lat`  
**Internal bind:** `127.0.0.1:3091` → container `:3000`

> This runbook documents procedure only. **Do not deploy without owner authorization.**

## Prerequisites

- [ ] Owner-approved change window
- [ ] `.env` on host with `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (≥32 chars), `OPENAI_API_KEY`, n8n secrets
- [ ] Persistent volume: `/opt/apps/homestead/data` → `/app/data`
- [ ] Latest backup verified (`scripts/production-backup.mjs`)
- [ ] Certified regression pass on release commit

## Pre-deploy checks

```bash
curl -sS http://127.0.0.1:3091/api/health   # expect 200
curl -sS http://127.0.0.1:3091/api/ready    # expect 200, database ok
```

## Deploy steps

```bash
cd /opt/apps/homestead
git fetch && git checkout <release-tag-or-sha>
docker compose -f deploy/vps/docker-compose.yml build homestead_web
docker compose -f deploy/vps/docker-compose.yml up -d homestead_web
docker compose -f deploy/vps/docker-compose.yml ps
curl -sS http://127.0.0.1:3091/api/ready
```

nginx reload only if config changed:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Health semantics

| Endpoint | Purpose | Fail when |
|----------|---------|-----------|
| `/api/health` | Liveness | Process dead |
| `/api/ready` | Readiness | DB missing/unreachable/integrity fail |

**Degraded (still ready):** stale scheduler, stale backup, outbox backlog, admin env incomplete.  
**Not degraded for readiness:** OpenAI/Telegram/n8n outage (handled asynchronously).

Docker healthcheck uses `/api/health`.

## Rollback procedure

1. **Code rollback:** redeploy previous image/tag (`docker compose up -d` with prior build).
2. **Do not** restore old SQLite unless DB corruption or bad migration — schema may have moved forward.
3. Verify `/api/ready` and spot-check HS/HA/calendar.
4. If migration broke app: stop container, restore DB from pre-deploy backup to volume (owner action).

### Rollback drill (isolated)

Simulate: deploy tag B → health fails → redeploy tag A → data intact.  
Evidence: persistence drill + readiness 200 + HS/HA counts unchanged.

## Persistence drill

1. Create business data (HS/HA) in isolated `DATA_DIR`
2. Restart container/process without deleting volume
3. Verify DB, photos, signals survive

## Post-deploy smoke (non-customer)

- `/api/health`, `/api/ready`
- Admin login
- Calendar loads
- Operations AI panel opens
- Autonomous Alert Center loads

## Owner actions before go-live

- Set production secrets on VPS
- Configure external uptime monitor (Homestead cannot be sole offline detector)
- Telegram live canary (one authorized operator message)
- Flip dry-run flags per matrix (CONTENT, AI concierge external sends, revenue, autonomous actions)
- DNS/SSL final verification
