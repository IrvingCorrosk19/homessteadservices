# PLATFORM ANALYTICS CAPABILITY MATRIX

Date: 2026-08-20. Source: live Homestead env on VPS (`INSTAGRAM_ACCOUNT_ID`, `FACEBOOK_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`). No scraping. Official Graph API only.

## Instagram Graph API (Instagram professional account)

| Metric | Status | Notes |
| --- | --- | --- |
| reach | NOT AVAILABLE | Meta tokens not configured |
| impressions | NOT AVAILABLE | Meta tokens not configured |
| likes | NOT AVAILABLE | Meta tokens not configured |
| comments | NOT AVAILABLE | Meta tokens not configured |
| shares | NOT AVAILABLE | Meta tokens not configured |
| saves | NOT AVAILABLE | Meta tokens not configured |
| profile actions | NOT AVAILABLE | Meta tokens not configured |
| messages attribution | NOT AVAILABLE | Not delivered by Homestead tokens; DMs are not attributed automatically |
| whatsapp clicks | NOT AVAILABLE | Requires configured CTA + Meta insights |
| leads | PARTIAL | Manual `/lead HC-…` and optional website `hs_ref` only |

When tokens exist, Homestead will map only documented IG insights (`impressions`, `reach`, `likes`, `comments`, `saved`, `shares` if the media type supports them). Missing fields stay **UNKNOWN**, never coerced to 0.

## Facebook Page

| Metric | Status |
| --- | --- |
| reach | NOT AVAILABLE |
| impressions | NOT AVAILABLE |
| likes / reactions | NOT AVAILABLE |
| comments | NOT AVAILABLE |
| shares | NOT AVAILABLE |
| link clicks | NOT AVAILABLE |
| messages | NOT AVAILABLE |
| leads | PARTIAL (same `/lead` / `hs_ref`) |

## WhatsApp

| Signal | Status |
| --- | --- |
| Prefilled `wa.me` with content folio | NOT AVAILABLE until `NEXT_PUBLIC_WHATSAPP` is set |
| Click tracking from Meta | NOT AVAILABLE |
| Operator attribution | `/lead` |

## Snapshots

24h / 48h / 72h / 7d collectors are implemented as **idempotent upserts**. They write rows **only** when an official API returns a value. Today: collector runs, returns `meta_not_configured`, **does not invent zeros**.

## Honest baseline (pre-engine)

- Published content jobs: see live SQLite
- Posts with platform analytics: 0
- Attributable leads: 0 until `/lead` or `hs_ref`
- Learning stage: STAGE_0_COLD_START
