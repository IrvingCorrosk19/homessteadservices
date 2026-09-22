# Homestead WhatsApp integration audit

DATE: 2026-09-21  
SCOPE: public contact CTAs vs operational customer WhatsApp  
DEPLOYED AT AUDIT: NO

Official number (target):

| Field | Value |
| --- | --- |
| display | +507 6661-6580 |
| localDisplay | 6661-6580 |
| wa.me destination | 50766616580 |

## Inventory

| File | Component / route | Current number/link | Purpose | Action |
| --- | --- | --- | --- | --- |
| `src/lib/site.ts` | `contact.whatsapp`, `whatsappHref` | `NEXT_PUBLIC_WHATSAPP` (empty) + flag off | Public Homestead WhatsApp | EXTEND: official constant + `buildWhatsAppUrl` |
| `.env.example` | env | `NEXT_PUBLIC_WHATSAPP=` / flag false | Docs | UPDATE to official + enabled |
| `deploy/vps/docker-compose.yml` | build/runtime env | flag default false, number empty | Prod image | Default official / enabled |
| `deploy/vps/Dockerfile` | build ARG | same | Bake NEXT_PUBLIC | Default official / enabled |
| `src/components/contact/ContactSection.tsx` | `/contact` `#contacto` | gated, hidden | Show official WhatsApp | UPDATE via helper |
| `src/components/layout/Footer.tsx` | global footer | gated, hidden | Contact channel | UPDATE show official display |
| `src/components/brand/WhatsAppHeaderButton.tsx` | unused (not mounted) | gated | Old header chip | REPLACE with floating CTA |
| `src/components/brand/SocialIcons.tsx` | footer/menu | WhatsApp only if enabled | Social | KEEP helper |
| `src/components/contact/RequestForm.tsx` | form alt CTA | gated | Service-context WA | KEEP, use helper messages |
| `src/components/home/Hero.tsx` | `/` | OpenChatButton | Homestead AI | KEEP (not WhatsApp) |
| `src/components/home/FinalCTA.tsx` | `/` | OpenChatButton | Homestead AI | KEEP |
| `src/components/home/Services.tsx` | `/` `/services` | ServiceConsultButton | Homestead AI | KEEP Consultar; add secondary WA |
| `src/components/layout/MobileBar.tsx` | mobile nav | chat + /contact | AI + form | KEEP (not replace Solicitar) |
| `src/components/layout/Header.tsx` | Solicitar servicio | `/contact` | Form/HS | KEEP |
| `src/components/concierge/ConciergeWidget.tsx` | chatbot | `whatsappUrl` from engine | Continue on WA after HS | KEEP, official helper |
| `src/lib/concierge-engine.ts` | post-HS CTA | `whatsappHref` if configured | Folio message | UPDATE message helper |
| `src/lib/service-requests.ts` | `customerWhatsAppUrl` | **customer** phone | Ops contact customer | DO NOT CHANGE |
| `src/components/admin/*` | admin WhatsApp | customer phone | Operations | DO NOT CHANGE |
| `src/lib/n8n.ts` / Telegram | `contactWhatsApp` | customer wa.me | Ops Telegram | DO NOT CHANGE |
| `scripts/test-homestead-n8n.mjs` | fixture | `wa.me/50760000000` | Fake customer phone | KEEP (not public CTA) |
| Docs / certs | historical | 62594210 personal, flag-off | History | Do not revive personal number |

## Old public numbers

- `62594210` — personal; must remain absent from public CTAs.
- `50760000000` — test/docs customer fixture, not Homestead official.

## Decision

Telegram / n8n / Operations AI / Autonomous Operations: no change.  
WhatsApp official is a public contact redirect only.
