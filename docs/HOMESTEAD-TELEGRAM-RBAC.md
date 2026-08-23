# Homestead Telegram RBAC

## Deny by default

`hasTelegramPermission(operator, permission)` returns false unless the role grants the permission. PENDING and inactive operators never pass.

## Roles (V1)

| Permission | OWNER | ADMIN | PENDING | (future) SALES / CONTENT / TECHNICIAN |
| --- | --- | --- | --- | --- |
| dashboard.read | ✓ | ✓ | | partial |
| requests.read / manage | ✓ | ✓ | | SALES |
| appointments.* | ✓ | ✓ | | SALES / TECH |
| leads.* | ✓ | ✓ | | SALES |
| content.read / approve | ✓ | ✓ | | CONTENT |
| jobs.* | ✓ | ✓ | | TECH |
| operators.read | ✓ | ✓ | | |
| operators.manage | ✓ | | | |
| operators.promote_owner | ✓ | | | |

ADMIN has near-full ops capability. Only OWNER manages operators and can create another OWNER. Last active OWNER cannot be deactivated/demoted.

## Central API

```ts
import { hasTelegramPermission, requireOperatorPermission } from "@/lib/telegram-operators";
```

Do not scatter `if (role === "OWNER")` across handlers.

## Anti self-escalation

PENDING cannot approve itself, change role, or invoke protected callbacks. Router checks operator before every mutation.
