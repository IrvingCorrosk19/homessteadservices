# Homestead Wave E — Customer Retention & Reputation

## Status dependencies

- **Wave D:** NOT CERTIFIED / NOT STARTED → Wave E does not depend on Meta publishing.
- **Multi-Operator:** NOT CERTIFIED (second Telegram account pending). RBAC code is reused; dual live recovery claim E2E not claimed PASS.

## Architecture

SQLite = truth · n8n = orchestration · Telegram = operators · Email = customer aftercare channel (existing Wave C).

Wave E **evolves** Wave C (`post-service`, jobs, recovery, reviews, maintenance foundation). No `*_v2` tables.

## What Wave E adds

- Preferences + marketing frequency cap + open-recovery marketing block
- NEUTRAL satisfaction (no review)
- Recovery priority + RESOLVED + follow-up aftercare
- Service-aware aftercare delay + quiet hours
- Maintenance due processor (message only, Booking V2 via contact link — no auto HA)
- Reactivation (service-aware, capped; skips locksmith one-offs)
- Admin `/admin/retencion`
- Telegram `❤️ Clientes` (`cc:ret`) + resolve (`cc:rr`)
- Scheduler `runRetentionEngine`

## Absolute rules preserved

NEGATIVE / NEEDS_HELP → recovery, never review  
Open recovery → no marketing retention  
Suppression / DNC respected  
No fake reviews  
No invented Meta / Wave D publish  

See `docs/AUDIT/WAVE_E_GAP_ANALYSIS.md` and certification doc.
