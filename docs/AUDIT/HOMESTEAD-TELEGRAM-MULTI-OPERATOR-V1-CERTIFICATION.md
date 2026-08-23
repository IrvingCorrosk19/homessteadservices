# HOMESTEAD TELEGRAM MULTI OPERATOR V1 — CERTIFICATION

Date: 2026-08-22 (America/Panama)
Pre tag: `pre-telegram-multi-operator-v1-20260822-2113`
Pre SHA: `0d6a774`
Final SHA: `2e90973`
SQLite backup: `/opt/backups/homestead/pre-telegram-multi-operator-v1/homestead-20260822-2116.sqlite`
Integrity: `ok`

## Scope delivered

- One bot / one webhook / one Command Center
- `telegram_operators` + RBAC (`hasTelegramPermission`, deny-by-default)
- Env allowlist → OWNER bootstrap (access preserved)
- `/start` PENDING registration + OWNER approve/reject
- Fan-out deliveries without duplicate HS/outbox business events
- Atomic contact / content approve + stale callback messaging
- Admin UI `/admin/configuracion/operadores`
- Break-glass: `scripts/telegram-break-glass-owner.mjs`
- Unit tests: `scripts/test-telegram-multi-operator.mjs`

## Live canary (2026-08-22)

| Check | Result |
| --- | --- |
| homestead.lat | 200 |
| n8n health | 200 |
| SQLite integrity | ok |
| OWNER active rows | 1 |
| PENDING rows | 0 |
| Simulated OWNER `/homestead` | PASS (`{"ok":true}`) |
| Fake Telegram user callback | PASS (`denied:true`) |
| Second Telegram account `/start` | **PENDING SECOND ACCOUNT START** |

## Dual-operator live matrix

Not executed (no second controlled account has opened the bot yet):

- Approve ADMIN
- Fan-out both deliveries
- Action race
- Content race
- Revoke

Do not invent PASS for those rows.

## Docs

- `docs/HOMESTEAD-TELEGRAM-MULTI-OPERATOR.md`
- `docs/HOMESTEAD-TELEGRAM-RBAC.md`
