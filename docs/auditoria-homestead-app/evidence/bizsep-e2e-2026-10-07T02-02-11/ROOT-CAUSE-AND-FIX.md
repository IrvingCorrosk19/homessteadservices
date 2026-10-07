# Biz-sep: customer phone ≠ Homestead contact + door-open continuity

**Evidence run:** `bizsep-e2e-2026-10-07T02-02-11`  
**Marker:** `CONCIERGE_BUILD_MARKER=v3.2-nc-bizsep`  
**Phones:** fictional only (`61112222` → `62223333`; business from config `+507 6000-1111` / official WA `+507 6661-6580`)

## Root cause

1. **Contact confusion (regression):** When the customer asked “cuál es el número”, the model/planner saw the customer phone in fact summaries / planner context without a verified business channel. There was no hard separation, so the customer number could be echoed as Homestead’s.
2. **Unit pollution:** `contradiction-engine` matched `perdón … es 62223333` as apartment `S62223333` (letter `s` from `es` + digits).
3. **Door-open abandoned / no HS:** `classifyActionableServiceIntent` treated “necesito me puedan abrir la puerta…” as underspecified (`createServiceRequest=false`) because lockout was not a concrete need. Without actionable create, the flow could stall or fall into call-handoff patterns; photos for `PHOTO_REVIEW_FIRST` still blocked lockout availability.

## Fix (cause, not phrase)

| Layer | Change |
|--------|--------|
| `business-contact.ts` | Single approved source: `NEXT_PUBLIC_PHONE` + official WA; `isBusinessContactQuestion` / `formatBusinessContactReply` / scrub; live env read (no invent if absent) |
| `operations-qa.ts` + knowledge + fact-model + summary + natural-style | Business Q&A early path; mask customer phone in planner facts; scrub leaks |
| `contradiction-engine.ts` | Unit corrections only with apto/unidad context; never phone-length |
| `packed-extraction.ts` | Reject Q/name/phone as location; San Miguelito typo; bare unit vs phone |
| `actionable-intent.ts` | `detectLockoutIntent` → actionable create |
| `conversation-action-gate.ts` / playbook / turn-intelligence / engine fallback | Lockout continues without interior photos; manual coordination copy; no auto “call Homestead” with customer digits |

## Test transcript (fictional)

See `transcript.json`. Highlights:

- Cliente: apertura → nombre → `61112222` → San Miguelito (typo) → **“cuál es el número”** → WhatsApp/tel **de Homestead** (no `6111`).
- Corrige a `62223333`; ubicación intacta; unit no contaminada.
- Precio → retoma apertura; sin exigir fotos interiores.
- **HS-2026-000001** persistido; phone corregido en DB; `control.push.new_request` **DELIVERED** in isolated outbox.
- Sesión 2 (Bruno / `63334444`): WA oficial; sin mezcla con Ana.
- Contacto comercial ausente: admite no disponible; no inventa ni reusa el del cliente.

## Operational chain

`conversación → service_requests (HS-2026-000001) → folio en reply/card → control_push_outbox new_request DELIVERED`

Physical A06 shade/tap requires device + prod FCM after deploy; isolated proves enqueue/delivery status in outbox. Manual coordination remains “coordinación manual”, not visita confirmada.

## Scripts

- `scripts/test-business-customer-contact-separation.mjs`
- `scripts/test-bizsep-conversation-e2e.mjs`
