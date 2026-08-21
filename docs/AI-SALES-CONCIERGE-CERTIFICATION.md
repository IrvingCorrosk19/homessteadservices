# HOMESTEAD SERVICES — AI SALES CONCIERGE CERTIFICATION

Date: 2026-08-20. Environment: https://homestead.lat canary. `AI_CONCIERGE_ENABLED=true`, `AI_CONCIERGE_DRY_RUN=true`.

## PRE-BACKUP
PASS. Tag `pre-ai-sales-concierge-20260820-2132` @ `24c801c`. VPS `/opt/backups/pre-ai-sales-concierge-20260820-2133/`.

## Audit (no invented facts)
- Services: A/C, plomería, pintura, electricidad, cerrajería, reparaciones, pequeñas remodelaciones.
- Hours: 8:00 a.m. a 10:00 p.m. Area: Todo Panamá. Email: servicios@homestead.lat.
- WhatsApp / phone públicos: NOT CONFIGURED.
- OpenAI: CONFIGURED (server). n8n request workflow preserved. No prices on the site.

## 20-conversation pilot (live API, dry run)
PRICE_CLAIMS: 0. Injection denied. Mundial redirected. Sparks → safety. A/C / plumbing / electrical asked one clarifying question. Memory kept “Carlos” + Betania. XSS payload not executed (JSON text). Weak spots reviewed: some “Hola” turns were still generic; prompt v1 tightened after the batch.

PHOTO live file upload: not executed in pilots (endpoint + sniffImage implemented).
VISION: photos stored; pixels are not sent to the model in this pass.
TELEGRAM: wired to existing `notifyN8n` when DRY_RUN=false; not fired in canary.
WHATSAPP CTA: hidden until `NEXT_PUBLIC_WHATSAPP` exists.

## Kill switch
`AI_CONCIERGE_ENABLED=false` omits API (404) and launcher.
