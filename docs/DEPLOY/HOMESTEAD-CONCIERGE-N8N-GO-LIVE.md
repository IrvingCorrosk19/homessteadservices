# Homestead Concierge n8n — go-live preparation

**Base:** `d878846` + corrections in this revision.  
**Status:** preparation only — **do not deploy / flip traffic yet**.  
**A06 physical push:** pending (phone unavailable). Does not block this prep.

Untouched production surfaces: Telegram lead alerts, Content Studio / Meta, Control Push, SMTP, and all existing n8n workflows except an eventual **new** Concierge Turn import.

---

## What was actually verified (this session)

| Check | Result | Evidence |
| --- | --- | --- |
| Backup script includes SQLite consistency, data dirs, config keys/hash, **previous image IDs** | Script updated (not executed on VPS) | `deploy/vps/backup-before-concierge-n8n.sh` |
| Phase order: **backup before any deploy/migration** | Documented below as Phase 0 | this file |
| Engine rollback (isolated): legacy / n8n-pin / in-flight / HS+cita | **PASS** `failed=0` | `docs/.../concierge-engine-rollback-2026-10-16T20-34-04/` |
| Prod workflow JSON uses `$vars` only (no `$env`, no secret literals) | **PASS** | `n8n/homestead-n8n-concierge-turn.prod.json` + `scripts/verify-n8n-vars-isolated.mjs` |
| Shared n8n **2.3.6** live `$vars` resolve | **BLOCKED** — SSH `Access denied` this session | Script ready: `deploy/vps/verify-n8n-vars-readonly.sh` |
| Prior shared inventory (`$vars` used by Homestead WFs; `$env` blocked; `credentials_entity=0`) | Historical **VERIFIED** | `docs/auditoria-homestead-app/02-INVENTARIO-N8N.md` |

### Rollback behavior proven (isolated, no SQLite restore)

| Scenario | After `AI_CONCIERGE_ENGINE=legacy` |
| --- | --- |
| Conversation pinned **legacy** | Stays legacy |
| Conversation pinned **n8n** (with `HS-…` + `HA-…` CONFIRMED) | **Stays n8n** (pin wins); lead+cita retained; no duplicate book |
| In-flight turn `INTERPRETING` | Remains `INTERPRETING` / engine `n8n` until completed — flag flip does not rewrite the turn |
| New conversation after rollback | Pins **legacy** |

Command: `npx tsx scripts/test-concierge-engine-rollback.mjs`

---

## Architecture (target)

```
Browser → homestead_web /api/concierge/chat
  → new chats: AI_CONCIERGE_ENGINE=n8n + N8N_MODE=remote
  → POST http://n8n:5678/webhook/homestead-concierge-turn
       header x-homestead-internal-secret
  → n8n Code → http://homestead_web:3000/api/internal/concierge/*
  → SQLite writes stay in Homestead
```

Existing threads with history pin **legacy** via `resolveAndPinConversationEngine`.

---

## Secrets handling (no values in Git / logs)

| Store | Use |
| --- | --- |
| Homestead `deploy/vps/.env` | `CONCIERGE_INTERNAL_SECRET` (operator credentials / secret manager — never commit) |
| Shared n8n **Variables** (`$vars`) | `CONCIERGE_INTERNAL_SECRET`, `HOMESTEAD_INTERNAL_BASE` — required on 2.3.6 because `$env` is blocked in Code/IF |
| n8n **Credentials** entity | Currently empty on shared instance (inventory). Do **not** invent a second secret channel unless you also change the workflow nodes. Prefer Variables to match live Homestead Telegram/Content patterns. |
| Workflow JSON | Expressions only (`$vars.…`) — never paste secret values |

Verification scripts print **lengths / presence**, never secret values. Use SSH/login credentials to run probes; do not echo passwords into logs or commits.

---

## Artifacts

| Path | Role |
| --- | --- |
| `n8n/homestead-n8n-concierge-turn.prod.json` | Shared n8n import (`$vars`, `active:false`) |
| `deploy/vps/backup-before-concierge-n8n.sh` | **Phase 0** backup (before any deploy) |
| `deploy/vps/verify-n8n-vars-readonly.sh` | Shared 2.3.6 `$vars` readonly probe |
| `deploy/vps/preflight-concierge-n8n.sh` | Connectivity + flag presence |
| `deploy/vps/rollback-concierge-n8n-engine.sh` | Flag → legacy only (`CONFIRM=YES`) |
| `deploy/vps/env.concierge-n8n.production.example` | Flag template |
| `scripts/test-concierge-engine-rollback.mjs` | Isolated rollback proof |
| `scripts/verify-n8n-vars-isolated.mjs` | Prod JSON + isolated vars lengths |

---

## Exact activation order (do not reorder)

### Phase 0 — Backup **before** any deploy or migration

On VPS (working SSH):

```bash
cd /opt/apps/homestead
sh deploy/vps/backup-before-concierge-n8n.sh
cat /opt/backups/concierge-n8n-pre-LATEST.path
```

Must contain:

- `homestead/homestead.sqlite` with `manifest.json` `integrity=ok` + sha256  
- `homestead/{photos,content,concierge,jobs}` if present  
- `n8n/n8n.dump` + `n8n/all-workflows.json`  
- `config/*-env-keys.txt` + `*.sha256` (optional `INCLUDE_ENV_COPY=YES` for mode-600 env copy)  
- `images/previous-runtime.txt` + image IDs for `homestead_web` / `n8n_n8n` + `DEPLOYED_SHA` if present  

**Stop if backup incomplete.** Do not rebuild images yet.

### Phase 1 — Shared n8n `$vars` live probe (readonly)

```bash
sh deploy/vps/verify-n8n-vars-readonly.sh | tee /tmp/n8n-vars-probe.txt
```

Pass criteria:

- n8n version reports **2.3.6**  
- Homestead workflows show `vars_refs=yes` and `env_refs=no`  
- Existing vars (e.g. `HOMESTEAD_WEBHOOK_SECRET`) show `len>0` (value not printed)  
- `CONCIERGE_INTERNAL_SECRET` / `HOMESTEAD_INTERNAL_BASE` reported `MISSING` until you create them  
- `HOOK_COUNT_CONCIERGE=0` (no collision)  
- No workflow create/update/delete in this script  

**This phase was BLOCKED from the laptop this session (SSH denied). Re-run before Phase 4.**

### Phase 2 — Deploy Homestead code still on legacy

1. Ensure `.env` has `AI_CONCIERGE_ENGINE=legacy` (or unset → compose default).  
2. Deploy/rebuild **only** `homestead_web` with the prep commit.  
3. Do not recreate `n8n_n8n` / `n8n_postgres`.  
4. Smoke: health + an existing chat still answers.

### Phase 3 — Preflight connectivity

```bash
sh deploy/vps/preflight-concierge-n8n.sh | tee /tmp/concierge-n8n-preflight.txt
```

### Phase 4 — Set n8n Variables + import inactive workflow

1. n8n UI → Variables (operator credentials): set `CONCIERGE_INTERNAL_SECRET` (match Homestead `.env`) and `HOMESTEAD_INTERNAL_BASE=http://homestead_web:3000`.  
2. Import **only** `n8n/homestead-n8n-concierge-turn.prod.json`, leave **inactive**.  
3. Do not edit Telegram / Content / Control Push workflows.

### Phase 5 — Activate Concierge workflow only (Homestead still legacy)

1. Activate Concierge Turn in UI.  
2. From `homestead_web`, POST empty body to webhook URL — expect auth failure without leaking secret; proves path.  
3. Confirm other Homestead executions still succeed.

### Phase 6 — Flip engine for **new** conversations

```bash
# in deploy/vps/.env
AI_CONCIERGE_ENGINE=n8n
AI_CONCIERGE_N8N_MODE=remote
N8N_CONCIERGE_TURN_WEBHOOK_URL=http://n8n:5678/webhook/homestead-concierge-turn
# CONCIERGE_INTERNAL_SECRET already set and matching n8n Variable

cd /opt/apps/homestead/deploy/vps
docker compose up -d homestead_web   # only this service
```

Optional SQL backfill for empty engine + history → `legacy` (code already does this on resolve).

### Phase 7 — Verify a **new** conversation

Incognito / no `hs_cid`:

1. Nueva solicitud → plumbing path → `HS-…` → slots → book.  
2. Correlate: UI ↔ `concierge_turns.engine=n8n` ↔ n8n execution ↔ SQLite cita.  
3. Old cookie chat remains legacy.  
4. Do **not** claim A06 physical push.

---

## Rollback (preserve new data)

```bash
CONFIRM=YES sh deploy/vps/rollback-concierge-n8n-engine.sh
```

- Sets `AI_CONCIERGE_ENGINE=legacy`, recreates **only** `homestead_web`.  
- **Does not** restore pre-backup SQLite over live data.  
- n8n-pinned conversations keep calling n8n until Nueva solicitud or you deactivate the Concierge workflow / re-pin that row.  
- In-flight n8n turns are not rewritten mid-operation (proven isolated).

Disaster-only: n8n `pg_restore` from Phase 0 dump if an import corrupted n8n — separate maintenance window.

---

## Pendings (concrete)

1. **SSH to VPS** with working credentials → run `verify-n8n-vars-readonly.sh` and `backup-before-concierge-n8n.sh` for real.  
2. Create n8n Variables `CONCIERGE_INTERNAL_SECRET` + `HOMESTEAD_INTERNAL_BASE` (after backup).  
3. Execute Phases 2–7 when ready to go live.  
4. **A06 physical** when USB phone available (`adb devices` → `device`).  
5. Optional: monitor Concierge Turn error rate 24h post-flip.
