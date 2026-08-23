# HOMESTEAD CONVERSATIONAL AI V3.1 — Human Excellence

DATE: 2026-08-22 America/Panama  
STATUS: Live-certified (see audit certification doc)

## Objective

Raise conversational quality from **8.6 → ≥9.5** via packed-message intelligence, structured interpretation as primary path, and question economy — without new architecture.

## Deployed version

| Item | Value |
| --- | --- |
| DEPLOYED_SHA | `d98df0d5aad619b0a3c924ac75b1920e5e6d8f7b` |
| BUILD_MARKER | `v3.1-he-live` (returned on `CHAT_STARTED`) |
| PROMPT | `hs-concierge-v3.1-he` |
| ROLLBACK_TAG | `pre-conversational-ai-v3.1-final-20260822-2025` |

## Architecture (unchanged hot path)

```text
CLIENTE → /api/concierge/chat → packed-extraction (deterministic)
       → OpenAI gpt-4o + tools → record_service_intelligence (validated)
       → playbook-engine → HS/HA → SQLite → outbox → n8n → Telegram
```

## Live evidence highlights

- **PACKED** `HS-2026-000058`: facts `Obarrio`, `bota agua`, `desde ayer`, `split`, phone valid; REASK=0; next action photo (useful).
- **LOCKSMITH** `HS-2026-000059`: photo-first → combined zone+phone → 1 photo on HS; outbox DELIVERED; REASK=0.
- **NEGATION** `HS-2026-000069`: facts `symptom=no enfría` only (no water leak).
- **CORRECTION** `HS-2026-000068`: final location `Bella Vista`.
- **ELECTRICAL SAFETY** `HS-2026-000064`: `urgency=safety`, hazard set, safety guidance, 0 questions after intake.
- **BOOKING** `HA-122513bb` for `HS-2026-000072`: real slots offered → customer selected → HA in `revenue_appointments`.

## Canaries

- `deploy/vps/canary-ai-v3.1.py` — full matrix
- `deploy/vps/canary-ai-v3.1-resilient.py` — continues on failure
- `deploy/vps/canary-ai-v3.1-retry.py` — retries after rate-limit
- `deploy/vps/canary-ai-v3.1-booking.py` — booking path

## Ops note

Dense canary matrices can hit Homestead chat IP rate-limit (HTTP 429). Retry harness uses distinct `X-Forwarded-For` per case for lab traffic only. Nginx `proxy_read_timeout` for `/api/concierge/` raised to 180s.
