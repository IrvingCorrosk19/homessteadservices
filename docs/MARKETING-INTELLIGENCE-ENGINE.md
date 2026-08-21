# Marketing Intelligence Engine

Homestead extends Content Studio + Autopilot. It does **not** replace Telegram, n8n request/content-studio/scheduler workflows, or SQLite.

**Optimize for commercial intent, not likes.**

## Architecture

```
Trabajos reales → Content queue → Content intelligence → Timing intelligence
→ ¿debemos publicar? → Telegram (tú apruebas) → publicación (ASSISTED / DRY RUN)
→ collector 12h → snapshots si la API existe → Homestead Intent Score → aprendizaje
```

Shadow default: `MARKETING_INTELLIGENCE_SHADOW=true` and `MARKETING_INTELLIGENCE_DRY_RUN=true`. The engine recommends and stores `marketing_recommendations`. It does **not** silently move an approved slot. `PUBLICAR AHORA` remains a **MANUAL_OVERRIDE** on the existing publish path.

AUTO mode stays **DISABLED**.

## Data model (additive SQLite)

- `content_jobs`: `content_type`, `cta_type`, `format`, `business_priority`, `valid_until`
- `marketing_snapshots`: one row per `(public_id, platform, horizon)` — upsert, not duplicates
- `marketing_recommendations`: `recommendationId`, reason codes, sample size, stage, shadow flag, later `decision`
- `marketing_leads`: `public_id`, `channel`, `outcome` — **no names, phones, emails**

Taxonomy reuses site services: `ac` → `AIR_CONDITIONING`, `electrical` → `ELECTRICAL`, etc. Unknown stays `UNKNOWN`.

## Homestead Intent Score (HIS)

Configurable in `src/data/marketing-intelligence.json`.

HIS = Σ (weight × known signal). Missing metrics are omitted, not zero.

Weights (higher = closer to a paid job): jobWon 100, qualifiedLead 40, lead 25, WhatsApp/DM 15, call/contact click 12, profile/link 6, save/share 4, comment/follow 3, like 1, impression 0.01.

Intent per reach = HIS / reach when reach is known.

Vanity example: 10k impressions + 100 likes + 0 leads scores far below 1k impressions + 20 likes + 8 leads.

## Confidence and stages (data, not calendar)

| Sample (posts with evidence) | Confidence |
| --- | --- |
| 0 | INSUFFICIENT |
| 1–4 | LOW |
| 5–11 | MEDIUM |
| ≥12 | HIGH |

| Published with evidence | Stage |
| --- | --- |
| <3 | STAGE_0_COLD_START |
| 3–11 | STAGE_1_EXPLORATION |
| 12–29 | STAGE_2_LEARNING |
| ≥30 | STAGE_3_OPTIMIZED |

One lucky post never yields HIGH. Hours are **windows** (06–09 … 21–23), not 19:13.

## Slot + content selection

Reuses existing allowed days/windows, min spacing, daily cap. Adds diversity penalty (last 3 categories), explicit `/prioridad`, freshness, exploration rate, and `NO_POST` for daily limit / empty queue.

## Analytics

Workflow **HOMESTEAD — Marketing Analytics Collector** (new, does not touch Telegram trigger) POSTs `/api/internal/content/analytics-collect`. Without Meta tokens it returns NOT AVAILABLE and writes nothing fake.

Weekly: **HOMESTEAD — Weekly Marketing Report** → `/api/internal/content/weekly-report`.

## Attribution

- Website contact with hidden/query `hs_ref=HC-YYYY-NNNNNN` stores a CONTACT lead id only
- `/lead HC-YYYY-NNNNNN si|no` for operator confirmation
- Instagram/Facebook message attribution: **NOT AVAILABLE** until official APIs exist

## Telegram (same bot)

`/recomendar` `/porque` `/rendimiento` `/aprendizaje` `/mejores` `/horarios` `/servicios` `/lead` `/prioridad`

Authorized chat IDs only (`HOMESTEAD_TELEGRAM_ADMIN_CHAT_IDS`).

## Failure

API failure: collector `continueOnFail`, previous snapshots kept. No infinite loops. Rate: 12h, not per minute.

## Tests

`node scripts/test-marketing-intelligence.mjs`

Synthetic scoring only. Does not write production analytics.
