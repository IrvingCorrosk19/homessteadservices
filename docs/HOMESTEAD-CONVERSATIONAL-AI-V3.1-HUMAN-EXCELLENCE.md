# HOMESTEAD CONVERSATIONAL AI V3.1 — Human Excellence

DATE: 2026-08-22  
SCOPE: Remediation of V3 P2 defects only — no new architecture, no V4, no n8n chat hot path.

## Objective

Raise conversational quality from **8.6 → 9.5+** by:

- Packed-message intelligence (multi-fact extraction in one turn)
- Structured interpretation as primary path (`record_service_intelligence` + server validation)
- Question economy (no re-asks, combined zone+contact when natural)
- Observability (`REPEATED_QUESTION`, improved `OVERQUESTIONING`)

## Architecture (unchanged hot path)

```text
CLIENTE → /api/concierge/chat → extractPackedExtraction (deterministic)
       → OpenAI gpt-4o + tools → record_service_intelligence (validated)
       → playbook-engine → HS/HA (deterministic) → SQLite → outbox → n8n → Telegram
```

## New modules

| Module | Role |
| --- | --- |
| `src/lib/concierge/packed-extraction.ts` | Deterministic multi-fact extraction: name, zone, phone, units, symptoms, negation, duration, contact preference |
| `src/lib/concierge/turn-intelligence.ts` | `parseTurnIntelligence`, `applyTurnIntelligence`, `detectRepeatedQuestion`, `questionEconomyBlock`, `shouldFlagOverquestioning` |

## Structured intelligence flow

1. **Deterministic first** — every user turn runs `applyPackedExtraction` before OpenAI (no extra latency/cost).
2. **AI structured tool** — `record_service_intelligence` args validated via `parseTurnIntelligence`; invalid shapes rejected without corrupting state.
3. **Fact confidence** — `EXPLICIT` / `HIGH_CONFIDENCE` / `UNCERTAIN` stored in `state.factConfidence`.
4. **Business rules** — Homestead code still owns HS creation, booking, pricing, availability.

## Prompt

- Version: `hs-concierge-v3.1-he`
- Injects: global policy + active playbook + `questionEconomyBlock` (known facts + forbidden re-asks)

## Observability

| Event | When |
| --- | --- |
| `REPEATED_QUESTION` | Bot reply matches re-ask pattern for data already in state |
| `OVERQUESTIONING` | ≥3 questions with sufficient context for handoff, or >5 without lead |

## Golden conversations

`scripts/test-conversational-ai-v3.1-golden.mjs` — deterministic assertions (no OpenAI required):

- PACKED_MESSAGE (Ana / Obarrio / AC water / phone)
- NEGATION (no water leak + not cooling)
- TYPO tolerance
- MULTI units

## Live canary

`deploy/vps/canary-ai-v3.1.py` — full service matrix with `V3.1-TEST` + phone `60001111`.

## Rollback

Tag: `pre-conversational-ai-v3.1-YYYYMMDD-HHMM` on baseline SHA `083994c`.
