# Homestead Telegram — Single Bot, Multi Operator V1

## Principle

- **One bot**, one token, one webhook, one Command Center.
- Telegram account = operator identity (`telegram_user_id`).
- Homestead / SQLite = authority (role, active flag, permissions, prefs).
- n8n orchestrates; it does **not** own operator identity.

## Flow

```text
Telegram update
  → n8n webhook homestead-content-studio
  → POST /api/internal/content/telegram-update
  → gate: private chat + operator lookup + active + RBAC
  → /start | /homestead | cc:* | cs:* callbacks
  → SQLite mutation (single business transition)
```

## Operator model

Table `telegram_operators`:

- `telegram_user_id` UNIQUE (authorization key)
- `telegram_chat_id` (delivery target for private chats)
- `role`: OWNER | ADMIN | PENDING (+ reserved SALES/CONTENT/TECHNICIAN)
- `is_active`
- notification prefs: requests / appointments / leads / sla / content / daily_brief

Unknown `/start` → PENDING (no Command Center). OWNER approves as ADMIN or OWNER.

## Fan-out

One business event (e.g. `service_request.created`) may produce N Telegram deliveries.

- Ops alerts: outbox payload `chats[]` from eligible operators.
- `service_request.created`: n8n keeps primary `HOMESTEAD_TELEGRAM_CHAT_ID`; Homestead fans out extras via Bot API without a second HS/outbox event.
- Per-chat failure does not undo successful deliveries.

## Concurrency

Callbacks always re-read SQLite. Second “Atendido” / content approve gets a friendly stale message. Actor recorded in `telegram_operator_audit` + `ops_audit`.

## Bootstrap & break-glass

Env `HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS` / `HOMESTEAD_TELEGRAM_CHAT_ID` seed OWNER rows on migrate (access preserved).

Emergency (server only, not HTTP):

```bash
node scripts/telegram-break-glass-owner.mjs <telegram_user_id> [display_name]
```

## Admin UI

`/admin/configuracion/operadores` — list, approve, deactivate (session-gated).

## Related

- `docs/HOMESTEAD-TELEGRAM-RBAC.md`
- `docs/HOMESTEAD-TELEGRAM-COMMAND-CENTER.md`
