# Concierge n8n renewal — evidence matrix (2026-10-16)

Production untouched. Shared VPS n8n untouched.

## Environments

| Layer | Endpoint / path | Notes |
| --- | --- | --- |
| Isolated Next | `http://127.0.0.1:3095` | `DATA_DIR=data/control-test`, `AI_CONCIERGE_ENGINE=n8n`, `AI_CONCIERGE_N8N_MODE=remote` |
| Isolated n8n | `http://127.0.0.1:5679` | n8n `1.72.1` via portable Node 22; user folder `data/n8n-isolated` |
| Secret | `data/n8n-isolated/.secret` | Outside git (`/data/` ignored) |
| Workflow | `n8n/homestead-n8n-concierge-turn.json` | No credentials; ID `WDY7i1Ve9b4acblh` |

## Coordination path (remote)

`widget/API → n8n webhook → interpret → route_decision → business tools → finalize_turn → UI`

- AI/heuristic interpretation: backend tool `interpret` (+ packed extraction)
- Next-step decision: backend tool `route_decision` (called by n8n Code node)
- Persistence: `upsert_request` / appointments / turn store
- No silent fallback to local coordinator when remote fails (`ok:false` + visible copy)

## Matrix by layer

### Layer A — HTTP / n8n remote (no UI)

| Suite | Result | Evidence |
| --- | --- | --- |
| Plumbing e2e (prior) | Keep separate (`AI_CONCIERGE_N8N_MODE=local`) | `scripts/test-concierge-n8n-plumbing-e2e.mjs` |
| HTTP remote plumbing | **PASS** (turnId + executionId + HS) | `docs/.../concierge-n8n-remote-2026-10-16T19-57-09` |
| Pending edge cases | **PASS** (failed=0) | `docs/.../concierge-pending-2026-10-16T20-01-36` |
| 12h→24h Panama slot parse | **PASS** (a.m. / p.m. / afternoon / bare HH:MM) | `scripts/test-slot-12h24h-panama.mjs` + fix in `business-tools.ts` |

### Layer B — Browser widget (real UI + remote n8n)

| Case | Result | Evidence |
| --- | --- | --- |
| Core plumbing (typos → HS → WA → resume → slots → reload) | **PASS** (prior) | `docs/.../concierge-browser-ui-2026-10-16/01…03-*.png` |
| `slot_taken` root cause | **Contention** (not defect): busy CONFIRMED rows from parallel tests | Cleared exclusive; see CORRELATION |
| Book from widget chip | **PASS** | `04-booking-confirmed.png` · turn `795625ae-…` · n8n **179** · `HA-3e64a4ea` 14:00 CONFIRMED |
| Reload persistence | **PASS** | `05-booking-persisted-reload.png` · card Visita confirmada |
| Reschedule from conversation | **PASS** | chip 4:00 p. m. → DB 16:00 RESCHEDULED · n8n **181** |
| Cancel from conversation | **PASS** | confirm sí → CANCELLED · turn `d3c1dac9-…` · `06-reschedule-cancel.png` |
| Correlation UI ↔ turn ↔ n8n ↔ cita | **PASS** | `docs/.../concierge-browser-ui-2026-10-16/CORRELATION.md` |

Do **not** treat HTTP-only booking as Layer B PASS.

### Layer C — A06 physical push

| Case | Result | Evidence |
| --- | --- | --- |
| Exact BLOCKED reason | **BLOCKED** — `adb devices -l` empty (no device attached). Not yet Firebase/credentials/network. | `docs/.../a06-push-blocked-2026-10-16/BLOCKED.md` |
| Nueva solicitud → push físico / FG·BG·killed / tap→detail / logout / reminder invalidate | **Not run** | Requires USB device authorized (`device` state) |

## Pending cases (remote) — Layer A

| Case | Result |
| --- | --- |
| Second service ask (no overwrite) | PASS |
| Cancela todas (enumerate + confirm + per-HS result) | PASS |
| Reschedule keeps prior on fail | PASS |
| Slot contention (not both silent confirm) | PASS (assertion tightened) |
| Concurrent messages | PASS |
| Idempotent replay (2s window) | PASS |
| n8n auth failure visible | PASS (401) |
| Cross-conversation internal mismatch | PASS (403) |
| Lockout vs digital lock | PASS |

## Notifications honesty

`DELIVERED` in Control push DB means **outbox/job marked delivered after n8n accepted the send payload** (`ControlPushN8nAccepted`). It does **not** prove physical phone receipt.

A06 physical cases: **BLOCKED** — empty `adb devices`; connect authorized test phone before retrying. Do not mutate production appointments/customers.

## Remaining exact pendings

1. **A06 physical** — phone unavailable; left pending. Not declared verified.
2. **Shared n8n 2.3.6 `$vars` live probe** — BLOCKED this session (SSH Access denied). Run `deploy/vps/verify-n8n-vars-readonly.sh` before import. Prior inventory still shows Homestead WFs use `$vars`.
3. **VPS Phase 0 backup execution** — script ready (`backup-before-concierge-n8n.sh`); must run before any deploy.
4. **Production go-live Phases 2–7** — not executed. Runbook: `docs/DEPLOY/HOMESTEAD-CONCIERGE-N8N-GO-LIVE.md`.
5. Optional: UI live race re-offer chips after BOOK fail.

### Prep corrections verified locally

| Item | Result |
| --- | --- |
| Engine rollback isolated (legacy / n8n-pin / in-flight / HS+cita) | PASS — `concierge-engine-rollback-2026-10-16T20-34-04` |
| Prod JSON `$vars` only | PASS |
| Backup before deploy (script + runbook Phase 0) | READY (not run on VPS) |

## Reproduce isolated stack

```bash
# 1) Secret (once)
# write random secret to data/n8n-isolated/.secret

# 2) Portable Node 22 (already under data/n8n-isolated/node-v22) — required by n8n 1.72.1
# 3) npm install in tools/n8n-isolated (uses Node 22 on PATH)

# 4) Import workflow (Node 22)
node tools/n8n-isolated/import-cli.mjs

# 5) Start n8n (Node 22)
node tools/n8n-isolated/start.mjs

# 6) Start Next (system Node matching better-sqlite3)
# CONCIERGE_INTERNAL_SECRET from .secret
node scripts/start-concierge-isolated.mjs

# 7) Tests
node scripts/test-concierge-n8n-remote-http.mjs
node scripts/test-concierge-pending-cases.mjs
npx tsx scripts/test-slot-12h24h-panama.mjs
# Browser: open http://127.0.0.1:3095/contact → chat widget
```

## Blockers

- Docker Desktop / WSL distro unavailable → npm-local n8n + portable Node 22
- VPS SSH previously denied → no remote isolated container used
- A06: no USB device in `adb devices`
- System Node is v24; n8n requires ≤22 (portable Node used only for n8n)
