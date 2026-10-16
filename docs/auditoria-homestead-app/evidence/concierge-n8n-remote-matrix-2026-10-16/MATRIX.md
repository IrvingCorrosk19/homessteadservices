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

## Matrix

| Suite | Mode | Result | Evidence |
| --- | --- | --- | --- |
| Plumbing e2e (prior) | **local** coordinator | Keep separate; script still sets `AI_CONCIERGE_N8N_MODE=local` | `scripts/test-concierge-n8n-plumbing-e2e.mjs` |
| HTTP remote plumbing | **n8n remote** | PASS (corr. turnId + executionId + HS) | `docs/.../concierge-n8n-remote-2026-10-16T19-57-09` |
| Pending edge cases | **n8n remote** | PASS (failed=0) | `docs/.../concierge-pending-2026-10-16T20-01-36` |
| Browser widget plumbing | **UI + remote** | PASS core path: typos → name/phone → phone fix → location → HS-2026-000009 → business WA → resume → slots chips → reload hydrates transcript + card. Booking: 12:00 `slot_taken` (contention from parallel pending tests); 2:00 initially missed 12h→24h map (fixed). | `docs/.../concierge-browser-ui-2026-10-16/` |
| A06 physical push | **device** | BLOCKED | No authorized test device/FCM creds in this session |

## Pending cases (remote)

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

`DELIVERED` in Control push DB means **outbox/job marked delivered after n8n accepted the send payload** (`ControlPushN8nAccepted`). It does **not** prove:

1. Simulated transport only — isolated tests with dry/mocked dispatch
2. Event persisted — outbox/reminder row exists
3. FCM accepted — n8n/FCM HTTP accept (`accepted`)
4. Physical phone receipt — requires device
5. Correct detail open — requires A06 UI path

A06 physical cases: **BLOCKED** — need authorized test operator device + FCM path; do not mutate production appointments/customers.

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
# Browser: open http://127.0.0.1:3095/contact → chat widget
```

## Blockers

- Docker Desktop / WSL distro unavailable → npm-local n8n + portable Node 22
- VPS SSH previously denied → no remote isolated container used
- A06 physical push BLOCKED without device/credentials
- System Node is v24; n8n requires ≤22 (portable Node used only for n8n)
