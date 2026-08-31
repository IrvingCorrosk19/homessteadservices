# HOMESTEAD — Production Dependency Map

**DATE:** 2026-08-31  
**GIT HEAD (baseline):** `fd0d898aaeb8dda2d248ef9a5251e5907ae1c536`  
**Scope:** Actual repository implementation (not assumed architecture)

---

## Runtime Topology

```
Internet → nginx (443 homestead.lat) → 127.0.0.1:3091 → Docker homestead_web (Next.js standalone)
                                              ↓
                                    /opt/apps/homestead/data → /app/data (volume)
                                              ↓
                         homestead.sqlite + photos/ + concierge/ + content/ + jobs/
```

**Evidence:** `deploy/vps/nginx-homestead.conf`, `deploy/vps/docker-compose.yml`, `deploy/vps/Dockerfile`

---

## Application Layer

| Component | Implementation | Persistent? | Notes |
|-----------|----------------|-------------|-------|
| Next.js 16.3.1 | `output: "standalone"` | N/A | `next.config.ts` |
| Public pages | `(public)/`, `calendar`, `appointments`, `experiencia` | N/A | Marketing + customer flows |
| Admin CRM | `/admin/*` | Session cookie | Middleware-protected |
| API (public) | `/api/concierge/*`, `/api/contact`, `/api/experiencia` | SQLite | Rate-limited |
| API (admin) | `/api/admin/*` | Cookie auth | RBAC via middleware |
| API (internal) | `/api/internal/*` | n8n secret | Scheduler + ops |

---

## Database

| Item | Value |
|------|-------|
| Engine | SQLite via `better-sqlite3` |
| Path | `{DATA_DIR}/homestead.sqlite` (prod: `/app/data/homestead.sqlite`) |
| WAL | `journal_mode=WAL`, `busy_timeout=4000` |
| Migrations | Inline `ALTER TABLE` in `service-requests.ts` `migrate()` — no versioned migration files |
| Singleton | One `Database` instance per Node process |
| Production volume | `/opt/apps/homestead/data:/app/data` |

**Tables (major):** `service_requests`, `revenue_*`, `concierge_*`, `automation_outbox`, `operational_signals`, `copilot_sessions*`, `telegram_operators`, `retention_actions`

---

## Filesystem State (under DATA_DIR)

| Path | Content |
|------|---------|
| `homestead.sqlite` | All relational data |
| `photos/{publicId}/` | Form upload photos |
| `concierge/{conversationId}/` | AI chat photos |
| `content/` | Content Studio assets |
| `jobs/{year}/{month}/{jobId}/` | Job completion photos |

---

## Authentication & Sessions

| Actor | Mechanism | Storage |
|-------|-----------|---------|
| Admin | `hs_admin` HMAC cookie, 7-day TTL | Stateless token; `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` |
| Concierge customer | `hs_cid` conversation UUID cookie | SQLite `concierge_conversations` |
| Internal (n8n) | `x-homestead-webhook-secret` + timestamp skew | Env secret |
| Telegram webhook | `x-telegram-bot-api-secret-token` | Env secret |
| Signed photo URLs | HMAC via `N8N_HOMESTEAD_WEBHOOK_SECRET` | 20-min TTL |

**Middleware:** `src/middleware.ts` — protects `/admin` and `/api/admin` (except login)

---

## Background Processing

| Worker | Trigger | Function |
|--------|---------|----------|
| `scheduler-tick` | n8n cron → POST internal API | Orchestrates all engines |
| Ops engine | scheduler-tick | Lead rescue, SLA alerts |
| Retention engine | scheduler-tick | Maintenance + reactivation |
| Autonomous ops scan | scheduler-tick | Signal detect → enrich → notify |
| Outbox drain | scheduler-tick | Deliver automation events |
| Content scheduler | scheduler-tick | Content autopilot |

**No in-app cron.** Production depends on **external n8n** calling `scheduler-tick`.

State timestamps: `automation_engine_state` table.

---

## External Integrations

| Service | Direction | Config vars | Business role |
|---------|-----------|-------------|---------------|
| OpenAI | Outbound HTTPS | `OPENAI_API_KEY`, model vars | Concierge, Copilot, Content, Autonomous enrichment |
| Telegram Bot API | Outbound HTTPS | `TELEGRAM_BOT_TOKEN`, chat IDs | Alerts, notifications, Content Studio |
| n8n | Bidirectional | `N8N_HOMESTEAD_WEBHOOK_*` | Scheduler trigger, lead webhooks, ops actions |
| SMTP | Outbound | `SMTP_*`, `CONTACT_INBOX` | Contact form, admin replies, retention |
| Meta (optional) | Outbound | `META_*`, `INSTAGRAM_*` | Social publish + analytics |

---

## Localhost / Dev Dependencies

| Pattern | Location | Production risk |
|---------|----------|-----------------|
| `E2E_BASE_URL=http://localhost:3005` | Test scripts only | None (not in prod) |
| `DATA_DIR=data/e2e-cert` + `conciergeE2EMode()` | E2E when `NODE_ENV !== production` | Blocked in production |
| `CONCIERGE_TEST_INJECT` | `test-injection.ts` | Blocked when `NODE_ENV=production` |
| `AUTONOMOUS_TEST_CLOCK_ISO` | `autonomous/clock.ts` | Test-only |
| `127.0.0.1:3091` | VPS deploy/canary scripts | Correct prod loopback |
| Default `NEXT_PUBLIC_SITE_URL=https://homestead.lat` | `site.ts` | Safe fallback |

---

## In-Memory State (production concerns)

| State | Scope | Risk |
|-------|-------|------|
| SQLite `db` singleton | Process | **Single-container constraint** — no horizontal scale without redesign |
| Admin login `attempts` Map | Process | Rate limit resets on container restart |
| Tool loop guards | Request | Low |

Conversation/copilot/autonomous state is **SQLite-backed** — survives restarts.

---

## Deployment Artifacts

| File | Purpose |
|------|---------|
| `deploy/vps/Dockerfile` | Multi-stage standalone build |
| `deploy/vps/docker-compose.yml` | Single service + volume |
| `deploy/vps/nginx-homestead.conf` | TLS termination, proxy headers |
| `deploy/vps/deploy-homestead-web.sh` | Tarball deploy + compose up |
| `deploy/vps/backup-sqlite.sh` | Online SQLite backup (host path hardcoded) |

---

## Missing / Gaps Identified (PR-1)

1. **No `/api/health` or readiness endpoint** in application code
2. **`AUTONOMOUS_*` env vars** not in `docker-compose.yml` or `.env.example`
3. **Backup script** uses hardcoded stamp/path — not generic production backup runner
4. **No restore drill script** in repo (backup exists, restore not automated)
5. **docker-compose defaults** leave several subsystems in dry-run (`CONTENT_DRY_RUN=true`, etc.)
