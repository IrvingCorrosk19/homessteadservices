# HOMESTEAD PUBLIC WHATSAPP REMOVAL

Date: 2026-08-25

## Summary

Public WhatsApp fully hidden until official WhatsApp Business is ready.
Unconfirmed phone placeholders removed.
Contact column shows only real configured data (email, hours, service area).
Chatbot remains the conversational web channel.

## Certification matrix

| Check | Result |
| --- | --- |
| HEADER_WHATSAPP_ICON | **REMOVED** (no mount in Header) |
| CONTACT_WHATSAPP | **REMOVED** (no row unless flag + configured) |
| WA_ME_LINKS_PUBLIC | **0** |
| WHATSAPP_PLACEHOLDERS | **0** |
| PERSONAL_NUMBER_PUBLIC | **0** |
| UNCONFIRMED_PHONE_PLACEHOLDER | **REMOVED** |
| CHATBOT | **KEPT** (Hablar con Homestead / Asesor de servicios) |
| REQUEST_SERVICE_CTA | **KEPT** |

| Surface | Result |
| --- | --- |
| HOME | PASS — no WA CTA; Hablar con Homestead |
| CONTACT | PASS — email/hours/area only when configured |
| SERVICES | PASS |
| MOBILE | PASS — header gap fixed; MobileBar Hablar → chat |
| DESKTOP | PASS |

| Regression | Result |
| --- | --- |
| TELEGRAM_REGRESSION | PASS — untouched |
| N8N_REGRESSION | PASS — untouched |
| CHATBOT_REGRESSION | PASS — widget retained |

| Build / tests | Result |
| --- | --- |
| BUILD | `tsc --noEmit` clean |
| TESTS | `scripts/test-public-whatsapp-removal.mjs` PASS |
| P0 | 0 |
| P1 | 0 |

## Feature flag

`NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED=true` required to re-enable public WhatsApp.
Infra (`WhatsAppHeaderButton`, `whatsappHref`, i18n strings) retained but inactive.

## FINAL VERDICT

**PUBLIC WHATSAPP REMOVAL CERTIFIED**

Live verified 2026-08-25 on https://homestead.lat/, /contact, /services:
- 0 WhatsApp / wa.me / placeholders / personal number
- Header: Solicitar only (no WA icon)
- Contact: Email + Horario + Zona (no WA/Teléfono placeholders)
- CTA: Hablar con Homestead
