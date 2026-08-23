# HOMESTEAD AI BUSINESS COPILOT

Wave G — final functional wave of Homestead V1.0.

## Purpose

Operators talk to Homestead in natural language (Telegram, same bot).

The LLM **interprets and explains**. Homestead **authorizes, queries, mutates, audits**.

```
USER → Telegram / Admin → CopilotService → Safe tools → Wave F / ops → SQLite
                                                      → structured result → LLM explain
```

## Entry

- Telegram: `/homestead` → **🤖 Copiloto** (`cc:cop`) or `/copilot`
- Natural language while Copilot session active, or business questions (`¿Cómo vamos hoy?`, etc.)
- Admin: `/admin/copilot` — deterministic brief (same brain layer; no duplicate prompts)

## Not the customer chatbot

Customer concierge (`concierge-*`) sells and books for clients.  
Business Copilot (`business-copilot-v1`) serves authorized operators only.

## Truthfulness

- No text-to-SQL
- No invented counts
- `revenueAvailable: false` until paid data exists
- Wave D Meta publish: **not** available via Copilot

## Prompt

`business-copilot-v1` — see `src/lib/copilot/prompt.ts`

## Ops

See `docs/HOMESTEAD-COPILOT-OPERATIONS.md` and `docs/HOMESTEAD-COPILOT-SECURITY.md`.
