# HOMESTEAD CONVERSATIONAL AI V2

Asesor de servicios en la web. No es un FAQ ni un formulario numerado.

## Hallazgos de auditoría usados

```text
AUDIT FINDINGS USED

Current AI: OpenAI Chat Completions JSON (híbrido regex)
Current model: gpt-4o (OPENAI_TEXT_MODEL / OPENAI_CONCIERGE_MODEL)
Current chatbot endpoint: POST /api/concierge/chat
Current conversation persistence: SQLite concierge_* + cookie hs_cid
Current lead persistence: saveServiceRequest → HS-YYYY-NNNNNN + revenue_leads
Current booking implementation: preferencia de texto; no createAppointment()
Current calendar implementation: /admin/citas ← revenue_appointments
Calendar defect: tabla vacía porque el chat no insertaba citas
Current n8n integration: webhook homestead-service-request (NUEVA SOLICITUD)
Current Telegram integration: n8n + sendNewLeadAlert duplicado en chat
```

## Decisión de modelo

```text
CURRENT MODEL: gpt-4o
PROPOSED MODEL: gpt-4o (sin cambio)
WHY: ya conversa en español, soporta tools, latencia/costo conocidos en prod.
EXPECTED BENEFIT: tools + integridad, no un modelo más grande.
COST/LATENCY TRADEOFF: 1–4 llamadas/turno si hay tools (tope 4).
```

Variable: `OPENAI_CONCIERGE_MODEL` o `OPENAI_TEXT_MODEL`. Default `gpt-4o`.

Prompt: `hs-concierge-v3` (PERSONA / POLÍTICAS / CONOCIMIENTO / HERRAMIENTAS). No se auto-reescribe.

## Flujo

```text
VISITANTE
  → ConciergeWidget
  → POST /api/concierge/chat
  → gpt-4o + tools (server-side)
       remember_customer_facts
       search_services
       create_or_update_lead
       check_availability
       create_appointment / reschedule / cancel
       escalate_human
  → saveServiceRequest (mismo que formulario)
  → revenue_appointments (HA-*)
  → GET /admin/citas
  → n8n (solicitud) + notifyAppointmentEvent (cita)
```

`Talking is not doing`: no se afirma cita ni horarios inventados. `enforceBookingIntegrity` y `enforceAvailabilityIntegrity` corrigen al modelo.

## Disponibilidad

Horarios reales: slots 08:00–18:00 (horario de negocio) menos citas no canceladas, timezone America/Panama. `check_availability` lee `listAppointments()`.

## Notificaciones

| Evento | Canal |
| --- | --- |
| Solicitud HS | n8n → Telegram NUEVA SOLICITUD (+ email SMTP) |
| Cita confirmada | bot Homestead existente `notifyAppointmentEvent` → 📅 NUEVA CITA |
| Escalamiento humano | `sendNewLeadAlert` solo si `escalate_human` |

`AI_CONCIERGE_DRY_RUN=true` omite n8n, email y Telegram. Producción de V2 debe usar `false` para notificar.

## Estado

SQLite `concierge_conversations.state_json` + `hs_cid` 7 días. Recarga restaura mensajes. No hay matching por nombre entre clientes.

## Analytics

Tabla `concierge_intelligence` (eventos, no chain-of-thought). Outcomes: BOOKED, LEAD_NOT_BOOKED, INFORMATION_ONLY, ABANDONED, UNSUPPORTED.

## Seguridad

Rate limit 40/10 min/IP y 24/conversación. Tools validadas en servidor. Jailbreak denegado. OpenAI key solo servidor.

## Rollback

Tag git `pre-conversational-ai-v2-20260822-0208` (`PRE_AI_V2_SHA`). SQLite `/opt/backups/pre-conversational-ai-v2-20260822-0208/`. n8n no se modificó.
