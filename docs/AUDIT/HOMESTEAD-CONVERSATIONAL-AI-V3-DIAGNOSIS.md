# Conversational AI V3 — diagnóstico (pre-implementación)

DATE: 2026-08-22 America/Panama  
SOURCE OF TRUTH: código + SQLite. Certificaciones leídas: Conversational AI V2, Wave A, Wave B, Wave C.

## CURRENT CHAT FLOW

Cómo empieza: widget `ConciergeWidget` → cookie `hs_cid` → `POST /api/concierge/chat`. Saludo fijo. OpenAI Chat Completions (`gpt-4o`) con tools. n8n **no** está en el hot path.

Cómo detecta servicio: keywords débiles en `extractCasualFacts` (aire, fuga, pintar) + tool `search_services` (más keywords). Cerrajería/electricidad/otros casi no se detectan en el extractor local.

Qué pregunta: el prompt pide “una pregunta útil”, pero no hay playbook. El modelo improvisa. Chips genéricos: “Necesito un servicio / Quiero cotizar / Quiero agendar”, luego zona, luego teléfono.

Qué campos exige para HS: teléfono **válido** + problema o servicio (`canHandoffLead`). Nombre opcional. Email no obligatorio (si falta se rellena con `servicios@homestead.lat`).

Cómo guarda estado: `concierge_conversations.state_json` — un objeto plano (`service`, `problem`, `location`, `phone`…). No hay `detectedServices[]`, `facts{}` ni `bookingStrategy`.

Cómo recibe imágenes: `POST /api/concierge/photo` → `DATA_DIR/concierge/<cid>/photo-<ts>.ext` + `concierge_photos`. El widget manda después el texto “Te envié una foto…”. **Las fotos no se copian a `service_requests.photos_json`** (`createLeadFromConcierge` pasa `photos: []`). Quedan huérfanas respecto al HS.

Cuándo crea lead/HS: tool `create_or_update_lead` o, al final del turno, si `canCreateLead`. `persistServiceRequest` → `HS-YYYY-NNNNNN` → outbox `service_request.created` → n8n → Telegram. Fuente `WEBSITE_AI_CHAT`.

Cuándo propone cita: tool `check_availability` → slots reales America/Panama.

Cuándo crea HA: `create_appointment` solo con `customerConfirmed` + slot ofertado → `createAppointment()` → `HA-*` → calendario → `notifyAppointmentEvent`. La IA no inserta citas directo.

Qué manda a Telegram: payload n8n estándar (nombre, servicio, descripción, fotos del **request**). Como el chat no adjunta fotos al HS, Telegram de solicitud chat llega **sin** fotos del concierge.

## UNIVERSAL QUESTIONS

- Qué servicio / qué pasa
- Zona general
- Teléfono
- (chips) agendar / cotizar / “necesito un servicio”

## SERVICE-SPECIFIC QUESTIONS

Casi ninguna en código. Solo el prompt genérico. El modelo a veces pregunta zona+teléfono juntos (V2 cert: naturalness 8/10).

## UNNECESSARY QUESTIONS

- Tipo de propiedad al inicio
- Dirección exacta
- Mismo cuestionario para cerrajería que para pintura
- Chips de menú que suenan a formulario
- Repetir nombre/zona si ya vinieron empacados (riesgo: extractor no cubre todos los alias)

## MISSING SERVICE INTELLIGENCE

- Playbooks por servicio
- REQUIRED vs USEFUL vs OPTIONAL
- Cerrajería photo-first
- Síntomas de A/C progresivos
- Fuga activa / chispas como urgencia/seguridad
- OTHER / NEEDS_REVIEW sin “no ofrecemos”
- Multi-servicio
- Corrección de zona (“perdón, es Bella Vista”)
- Asociación foto → HS
- Telegram/SLA/Rescue conscientes de fotos y servicio
- Structured output validado (existe `parseConciergeOutput` **sin uso** en el motor V2)

## ROBOTIC BEHAVIORS

- Chips fijos de menú
- Prompt `hs-concierge-v3` ya pide no sonar a formulario, pero no inyecta contexto de oficio
- Fallback OpenAI: “Cuéntame brevemente qué servicio necesitas”
- `search_services` es una cascada if/regex, no configuración

## ARCHITECTURE TO PRESERVE

```
CLIENTE → CHAT → OpenAI (tools) → Homestead logic → HS/HA → SQLite → outbox → n8n → Telegram
```

Booking V2, Wave A outbox, Wave B rescue/SLA, Wave C jobs: no romper.

## DESIGN DECISIÓN

Capa `ServicePlaybook` configurable. IA entiende y habla. Código decide captura, HS, agenda, seguridad, outbox.
