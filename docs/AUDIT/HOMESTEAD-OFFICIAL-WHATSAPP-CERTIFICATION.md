# Homestead official WhatsApp — certification

DATE: 2026-09-21  
STATUS: CERTIFIED for public CTAs  
OFFICIAL: +507 6661-6580 / `https://wa.me/50766616580`

## Scope

Public website contact only. Homestead AI, “Solicitar servicio”, Telegram, n8n, and customer-phone `customerWhatsAppUrl` are unchanged.

## Helper

| Function | Result |
| --- | --- |
| `OFFICIAL_WHATSAPP` | display `+507 6661-6580`, destination `50766616580` |
| `buildWhatsAppUrl(message)` | always `https://wa.me/50766616580` + encoded text |
| `whatsappHref` | official URL, or null if `NEXT_PUBLIC_OFFICIAL_WHATSAPP=false` |
| `isPublicWhatsAppEnabled` | still `=== "true"` — Telegram/ops customer buttons only |

## Messages

| Context | Text |
| --- | --- |
| Default / float / footer / contact | Hola, quisiera información sobre los servicios de Homestead. |
| Service card / form | Hola, quisiera información sobre el servicio de {servicio} de Homestead. |
| HS folio | Hola, quisiera consultar sobre mi solicitud HS-YYYY-NNNNNN. |
| HA folio | Hola, quisiera consultar sobre mi cita HA-xxxxxxxx. |

Invalid HS/HA IDs fall back to a generic official message. Never interpolates customer or technician phones.

## Surfaces

| Surface | Behavior |
| --- | --- |
| Floating button (left) | Official default message, `noopener noreferrer` |
| Chatbot (right) | Homestead AI — not replaced |
| Header “Solicitar servicio” | Form — not replaced |
| Hero / final CTA / mobile bar | Chat or form — not WhatsApp |
| Services | Consultar (AI) + secondary official WhatsApp |
| Contact + footer | Official display + helper URL |
| Telegram / admin | Still `customerWhatsAppUrl` |

## Tests

`scripts/test-official-whatsapp.mjs` plus updated `test-public-whatsapp-removal` / `test-image-to-chat`.

## Kill switch

`NEXT_PUBLIC_OFFICIAL_WHATSAPP=false` hides public official CTAs without touching Telegram.
