# AI Sales Concierge

In-page advisor for Homestead Services. Not a FAQ bot. Kill switch: `AI_CONCIERGE_ENABLED=false`. Default `AI_CONCIERGE_DRY_RUN=true` (talks, does not notify Telegram).

## Architecture

Browser → `POST /api/concierge/chat` (cookie `hs_cid`) → SQLite state + catalog → OpenAI JSON (server only) → reply + chips.

Qualified lead → existing `saveServiceRequest` + `notifyN8n` (same Telegram workflow). No new n8n workflow. No OpenAI from the browser.

## Knowledge

Website dictionary only: A/C, plomería, pintura, electricidad, cerrajería, reparaciones, pequeñas remodelaciones. Hours/area if published. **No prices.** WhatsApp handoff only if `NEXT_PUBLIC_WHATSAPP` is set; today it is not.

Prompt version: `hs-concierge-v1` in `src/lib/concierge-knowledge.ts`.
