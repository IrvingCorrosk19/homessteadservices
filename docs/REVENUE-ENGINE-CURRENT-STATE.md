# Revenue engine — current state

Date: 2026-08-20. Principle: EXTEND, don't rebuild.

| Piece | Status | Action |
| --- | --- | --- |
| Website homestead.lat | EXISTS | DO NOT TOUCH layout except Telegram already there |
| SQLite `service_requests` HS-YYYY-NNNNNN | EXISTS | REUSE as **canonical lead id** |
| Admin `/admin/solicitudes` | EXISTS | EXTEND later; Telegram is command center now |
| n8n request → Telegram | EXISTS | DO NOT TOUCH |
| Content Studio + scheduler | EXISTS | DO NOT TOUCH |
| Marketing Intelligence | EXISTS | EXTEND via jobs won / leads when they exist |
| AI Sales Concierge | EXISTS | REUSE (writes HS requests) |
| OpenAI | EXISTS | DO NOT add a second key |
| Telegram bot | EXISTS | EXTEND commands |
| WhatsApp / Meta / phone | MISSING / NOT CONFIGURED | No fake numbers |
| Pricing catalog | MISSING | Quotes = NEEDS_MANUAL_PRICING |
| Google Calendar | MISSING | Internal appointments only |
| Payment gateway | MISSING | paymentStatus field only |
| Review URLs | MISSING | Eligible flag, no invented links |

Canonical lead: `service_requests.public_id`.
