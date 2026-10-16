# Homestead Concierge n8n — go-live preparation (from `f931c53`)

**Status:** preparation only. Do **not** flip production traffic until an operator runs the phases below on purpose.  
**Out of scope:** A06 physical push (phone unavailable — remains pending). Do not declare push físico verified.

Production services that must stay untouched: Telegram lead alerts, Content Studio Meta publish, Control Push FCM webhooks, SMTP, Meta tokens, shared n8n workflows other than the **new** Concierge Turn import.

---

## Architecture (target)

```
Browser widget → homestead_web /api/concierge/chat
  → (new conversations only) AI_CONCIERGE_ENGINE=n8n + N8N_MODE=remote
  → POST http://n8n:5678/webhook/homestead-concierge-turn
       header x-homestead-internal-secret
  → n8n Code calls http://homestead_web:3000/api/internal/concierge/*
  → SQLite business writes stay in Homestead (n8n never opens homestead.sqlite)
```

Existing conversations with transcript/lead stay on **legacy** via `resolveAndPinConversationEngine` (empty `engine` + prior work → pin `legacy`). New chats (`Nueva solicitud` / new `hs_cid`) take the global flag.

---

## Artifacts prepared in repo

| Artifact | Purpose |
| --- | --- |
| `n8n/homestead-n8n-concierge-turn.json` | Isolated / `$env` (local Node portable n8n) |
| `n8n/homestead-n8n-concierge-turn.prod.json` | Shared VPS n8n — **`$vars` only** (2.3.6 blocks `$env`) |
| `scripts/build-concierge-n8n-prod-workflow.mjs` | Rebuild prod JSON from source |
| `deploy/vps/env.concierge-n8n.production.example` | Flag + URL template (no secrets) |
| `deploy/vps/docker-compose.yml` | Pass-through for engine/webhook/secret (default `AI_CONCIERGE_ENGINE=legacy`) |
| `deploy/vps/backup-before-concierge-n8n.sh` | Pre-activation backup |
| `deploy/vps/preflight-concierge-n8n.sh` | Read-only connectivity + flag presence |
| `deploy/vps/rollback-concierge-n8n-engine.sh` | Flag rollback only (keeps data) |

---

## Credentials & connectivity checklist (no secret values)

### Homestead (`deploy/vps/.env` → `homestead_web`)

| Key | Required for remote | Notes |
| --- | --- | --- |
| `AI_CONCIERGE_ENGINE` | yes | Ship as `legacy`; flip to `n8n` only in Phase 5 |
| `AI_CONCIERGE_N8N_MODE` | yes | `remote` |
| `CONCIERGE_INTERNAL_SECRET` | yes | ≥32 random bytes; **same value** as n8n Variable |
| `N8N_CONCIERGE_TURN_WEBHOOK_URL` | yes | Prefer `http://n8n:5678/webhook/homestead-concierge-turn` on `n8n_net` |
| `AI_CONCIERGE_DRY_RUN` | ops choice | Production leads: `false` only if intentional |
| `OPENAI_API_KEY` | yes (interpret) | Existing; do not rotate for this rollout unless needed |

Do **not** reuse `N8N_HOMESTEAD_WEBHOOK_SECRET` / Telegram / Control Push secrets for Concierge internal auth.

### Shared n8n (Settings → Variables)

| Variable | Value shape |
| --- | --- |
| `CONCIERGE_INTERNAL_SECRET` | identical to Homestead env |
| `HOMESTEAD_INTERNAL_BASE` | `http://homestead_web:3000` (Docker DNS on `n8n_net`) |

Confirm `$env` remains blocked; prod workflow uses `$vars` only.

### Connectivity (preflight)

1. `homestead_web` → `n8n:5678/healthz` (or `n8n_n8n`) returns ok.  
2. `n8n_n8n` → `homestead_web:3000/api/health` returns ok.  
3. Webhook path `homestead-concierge-turn` does **not** already exist on another workflow.  
4. Existing Homestead webhooks (Telegram / content / control-push) still listed and active as before.

---

## Phases (exact order — do not skip)

### Phase 0 — Deploy code with engine still legacy

1. Deploy Homestead image/commit that includes `f931c53` + pin hardening + compose pass-through.  
2. Ensure `.env` has `AI_CONCIERGE_ENGINE=legacy` (or unset → compose default `legacy`).  
3. Recreate **only** `homestead_web` if compose changed (`docker compose up -d homestead_web`).  
4. Do **not** restart/recreate `n8n_n8n` / `n8n_postgres` unless required for an unrelated reason.  
5. Smoke: site health + an **existing** cookie chat still answers (legacy).

### Phase 1 — Backup (data-preserving)

On VPS:

```bash
cd /opt/apps/homestead
sh deploy/vps/backup-before-concierge-n8n.sh
cat /opt/backups/concierge-n8n-pre-LATEST.path
```

Verify: `manifest.json` integrity `ok`, `n8n.dump` non-empty, `all-workflows.json` present.

### Phase 2 — Preflight (read-only)

```bash
sh deploy/vps/preflight-concierge-n8n.sh | tee /tmp/concierge-n8n-preflight.txt
```

Abort if health hops fail or a colliding concierge webhook already exists under another name/path.

### Phase 3 — n8n Variables + import **inactive** workflow

1. In n8n UI → Variables: set `CONCIERGE_INTERNAL_SECRET` and `HOMESTEAD_INTERNAL_BASE` (values never committed).  
2. Import **only** `n8n/homestead-n8n-concierge-turn.prod.json`.  
3. Leave **active = false**.  
4. Do not open/edit Telegram, Content Studio, or Control Push workflows.  
5. Optional: tag the workflow `homestead-concierge` for inventory.

### Phase 4 — Activate workflow only (Homestead still legacy)

1. Activate the Concierge Turn workflow in n8n UI.  
2. From `homestead_web` (secret from env, not echoed):

```bash
docker exec homestead_web sh -c '
  SECRET=$(printenv CONCIERGE_INTERNAL_SECRET)
  URL=$(printenv N8N_CONCIERGE_TURN_WEBHOOK_URL)
  # Expect 401 without/wrong secret — proves path exists without coordinating a fake turn
  wget -qS -O- --header="content-type: application/json" \
    --post-data="{}" "$URL" 2>&1 | head -20 || true
'
```

3. Confirm other webhook executions (Telegram/content) still succeed in n8n Executions filter.  
4. Homestead chat for customers still uses **legacy** (`AI_CONCIERGE_ENGINE=legacy`).

### Phase 5 — Flip Homestead to n8n (new conversations only)

1. Set in `/opt/apps/homestead/deploy/vps/.env`:

```bash
AI_CONCIERGE_ENGINE=n8n
AI_CONCIERGE_N8N_MODE=remote
N8N_CONCIERGE_TURN_WEBHOOK_URL=http://n8n:5678/webhook/homestead-concierge-turn
# CONCIERGE_INTERNAL_SECRET already set and matching n8n Variable
```

2. Recreate **only** `homestead_web`:

```bash
cd /opt/apps/homestead/deploy/vps
docker compose up -d homestead_web
```

3. Do **not** recreate n8n/postgres.  
4. Optional backfill (belt-and-suspenders; code already pins history → legacy):

```sql
-- inside homestead_web / sqlite
UPDATE concierge_conversations
SET engine = 'legacy'
WHERE TRIM(COALESCE(engine,'')) = ''
  AND (
    EXISTS (SELECT 1 FROM concierge_messages m WHERE m.conversation_id = concierge_conversations.id)
    OR TRIM(COALESCE(lead_public_id,'')) != ''
  );
```

### Phase 6 — Verify **new** conversation (required before calling go-live done)

Use a private/incognito window (no `hs_cid`):

1. Open `https://homestead.lat/contact` → open chat → **Nueva solicitud** if needed.  
2. Send a short plumbing-style message with typos → provide name/phone/zone → obtain `HS-…`.  
3. Ask for horarios → select a chip → expect confirmation (or honest failure, never silent success).  
4. Correlate layers:

| Layer | Check |
| --- | --- |
| UI | Reply + request card / visita confirmada |
| Homestead turn | `concierge_turns.engine='n8n'`, `status='DONE'`, `reply_json` present |
| Conversation pin | `concierge_conversations.engine='n8n'` for this new id only |
| n8n | New execution on Concierge Turn workflow; `executionId` referenced if stored |
| SQLite business | `service_requests` / `revenue_appointments` row matches folio |

5. Resume an **old** cookie conversation (if available): must remain `engine=legacy` and still answer.  
6. Confirm Telegram/Content/Control Push still healthy (one read-only execution glance).

**Not required for this go-live:** A06 physical FCM on device.

---

## Rollback (preserve customer data)

Prefer flag rollback over DB restore.

```bash
# On VPS — sets engine back to legacy and recreates only homestead_web
CONFIRM=YES sh deploy/vps/rollback-concierge-n8n-engine.sh
```

Manual equivalent:

1. `AI_CONCIERGE_ENGINE=legacy` in `.env`  
2. `docker compose up -d homestead_web`  
3. Optionally deactivate Concierge Turn workflow in n8n UI (leave JSON imported).  
4. **Do not** restore `homestead.sqlite` from the pre-backup over live data (would wipe post-activation bookings).  
5. n8n dump restore only if the **import itself** corrupted n8n (disaster); use `pg_restore` against a maintenance window — out of band.

Conversations already pinned to `n8n` keep that pin until the user starts **Nueva solicitud** (new cookie). After rollback, those pins still call n8n unless you deactivate the workflow (then they get the visible `n8n_unavailable` / timeout copy — data kept). To force legacy for a stuck pin, set that row’s `engine='legacy'` only for that conversation id.

---

## What this rollout must not do

- Restart or recreate unrelated containers (mail, unrelated apps).  
- Change Meta / Telegram / Control Push env keys.  
- Edit existing n8n workflows in place.  
- Point Concierge at public broken TLS if private `n8n_net` works.  
- Claim A06 physical push PASS.

---

## Pending after go-live

1. **A06 physical** — when USB test phone is available (`adb devices` shows `device`).  
2. Optional canary: keep `AI_CONCIERGE_ENGINE=legacy` and enable n8n only for staff via temporary pin (future).  
3. Monitor n8n execution error rate for Concierge Turn for 24h.
