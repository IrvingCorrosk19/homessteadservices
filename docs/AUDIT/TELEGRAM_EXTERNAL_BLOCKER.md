# Telegram External Delivery — Blocker Analysis

**DATE:** 2026-08-31  
**Status:** HUMAN ACTION / ENVIRONMENT — not a code defect

---

## Current Certification State

From Autonomous Operations God Level Certification:

| Gate | Result |
|------|--------|
| Telegram Internal Pipeline | **PASS** (outbox, routing, dedup, action tokens) |
| Telegram External (Bot API delivery) | **ENVIRONMENT_BLOCKED** on localhost E2E |

---

## Diagnostic Run (this campaign)

Command: `node scripts/e2e-telegram-diagnostics.mjs`  
Environment: `DATA_DIR=data/e2e-cert`, local dev

| Check | Result |
|-------|--------|
| `TELEGRAM_BOT_TOKEN` configured | yes (env present — value not logged) |
| Active operators in DB | 1 |
| Operators with chat ID | 1 |
| `sendTelegramMessage` message_id | **not returned** |
| Root cause classification | Token invalid, blocked chat, or network from localhost |

---

## Architecture

```
Homestead → automation_outbox → drainAutomationOutbox()
         → ops.telegram.alert / revenue-telegram handlers
         → Telegram Bot API (HTTPS outbound)
         OR → n8n webhook (N8N_HOMESTEAD_WEBHOOK_URL) → Telegram
```

**Webhook path:** Telegram → n8n (`TELEGRAM_EXPECTED_WEBHOOK_URL`) → Homestead internal routes  
**Evidence:** `src/lib/automation-dispatch.ts`, `src/lib/content-telegram.ts`, `deploy/vps/nginx-homestead.conf`

---

## Why External Is Blocked on Localhost

Likely causes (requires owner verification on VPS, not localhost):

1. Bot token valid on VPS `.env` but localhost uses E2E cert DB with different operator chat IDs
2. Outbound Bot API from developer machine blocked or token scoped to production IP
3. Operator chat has not `/start` the bot
4. n8n webhook path works in production but local loopback does not reach n8n network

---

## Internal Pipeline (certified PASS)

- Outbox event types enqueue correctly
- Idempotency keys prevent duplicate NUEVA SOLICITUD on reprogram
- Payload includes HS identity
- Autonomous notifications route through same pipeline
- Action tokens (`auto:ack:`) validated server-side

---

## Required for External PASS

| Action | Owner |
|--------|-------|
| Verify `TELEGRAM_BOT_TOKEN` on production VPS `.env` | Owner |
| Confirm operator chat IDs in `telegram_operators` match live Telegram accounts | Owner |
| Ensure bot can message each operator (user sent `/start`) | Owner |
| Run **one** safe TEST canary from VPS (not localhost) after go-live prep | Owner + readiness campaign |
| Confirm n8n variables synced if using n8n Telegram nodes | Owner |

---

## Canary Protocol (when authorized)

1. Set message body to clearly include `HOMESTEAD TEST — DO NOT ACTION`
2. Send exactly **one** message to authorized operator chat
3. Verify `message_id` returned and logged
4. Do not spam or notify customers

**This campaign did NOT run external canary** — localhost diagnostics insufficient for production proof.

---

## Go-Live Impact

Telegram external delivery is **OWNER ACTION / ENVIRONMENT**, not a blocker for completing other readiness waves.

Homestead core booking, AI, and autonomous internal pipeline can be ready while Telegram external remains pending owner setup on VPS.
