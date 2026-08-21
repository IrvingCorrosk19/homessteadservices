# Revenue Growth Engine

Canonical lead id = `HS-YYYY-NNNNNN` (existing service requests). Customers are upserted by phone digits. Pipeline lives in `revenue_leads`, not a second inbox.

## Flags

`REVENUE_ENGINE_ENABLED` (default on) · `REVENUE_ENGINE_DRY_RUN=true` · `AUTO_FOLLOW_UP=false` · `REVENUE_BRIEFING_SEND=false`

Assisted follow-up: Telegram shows a suggested message. Nothing is sent to the customer automatically.

## Scoring

Deterministic weights in `src/data/revenue-engine.json`. LLM does not set the score.

## Quotes

Drafts start as `NEEDS_MANUAL_PRICING`. Totals only if a human stored numbers. Sending is blocked until then.

## Money

Quoted ≠ won ≠ collected. Empty totals stay unknown. No ROI without campaign spend.

## Telegram (same bot)

`/hoy` `/leads` `/calientes` `/seguimientos` `/cotizaciones` `/agenda` `/trabajos` `/clientes` `/reseñas` `/mantenimientos` `/ventas`

Next Best Action uses recovery > hot leads > quote follow-up. AUTO follow-up stays disabled.
