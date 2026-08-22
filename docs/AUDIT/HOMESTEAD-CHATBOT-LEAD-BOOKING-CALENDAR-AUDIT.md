# HOMESTEAD SERVICES

# FORENSIC AUDIT — CHATBOT + LEAD + BOOKING + CALENDAR

**Fase:** 1 — solo análisis  
**Fecha de evidencia:** 2026-08-22 (America/Panama, UTC-5)  
**Alcance:** producción viva (`https://homestead.lat`) + código del repositorio  
**Cambios de aplicación/n8n/prompts/calendario/esquema:** ninguno

Este informe documenta comportamiento **observado**. No asume PASS por existencia de código. Donde una prueba no se ejecutó, se marca `NOT TESTED`.

---

## 0. Veredicto ejecutivo

El chatbot **sí usa OpenAI `gpt-4o`**, **sí crea solicitudes reales `HS-YYYY-NNNNNN` en SQLite**, **sí dispara n8n y Telegram**, y **no envía email**.

El chatbot **no agenda citas**. Cuando el cliente dice «mañana a las 3», el sistema guarda una **preferencia de texto** en `revenue_leads` (`preferred_date` / `preferred_time_window`) y responde que la «tomó como preferencia». **No** llama `createAppointment()`. La tabla `revenue_appointments` está **vacía (0 filas)**. El calendario admin consulta esa tabla. Por eso no hay citas visibles: **no se guardan como citas**.

En la prueba controlada el bot **no** dijo «su cita ha sido agendada». Dijo que tomó una preferencia. Eso no es una cita persistida ni un evento de calendario.

---

## 1. Respuestas a las 28 preguntas

| # | Pregunta | Evidencia |
| --- | --- | --- |
| 1 | ¿Qué IA? | OpenAI Chat Completions, JSON mode. Híbrido: LLM + regex (teléfono, seguridad, scheduling, jailbreak). |
| 2 | Proveedor | OpenAI. |
| 3 | Modelo exacto | `gpt-4o`. Env producción: `OPENAI_TEXT_MODEL=gpt-4o`, `OPENAI_CONCIERGE_MODEL` vacío → fallback `gpt-4o`. |
| 4 | Dónde se configura | VPS `.env` → Docker `homestead_web`. Código: `src/lib/concierge-engine.ts` `model()`. |
| 5 | System prompt | `src/lib/concierge-knowledge.ts` `conciergeSystemPrompt`, versión `hs-concierge-v2`. |
| 6 | Contexto | Cookie `hs_cid` + SQLite `concierge_conversations.state_json` + últimos 12 mensajes + segundo system message con estado interno. |
| 7 | Memoria conversacional | Sí, en SQLite. No es memoria nativa de OpenAI. Refresh HTTPS restaura vía `GET /api/concierge/chat`. |
| 8 | Qué captura | Servicio, problema, zona, teléfono (obligatorio para lead), nombre opcional, email no exigido, preferencia de visita como texto, fotos opcionales (no vistas en esta corrida). |
| 9 | Cómo determina el servicio | Campo JSON `serviceCategory` del LLM + regex posterior en handoff (`aire`, `plom`, `pintar`). |
| 10 | Teléfono/email | Prompt pide teléfono cuando hay servicio+zona. Email **no se pide**. Si falta, se guarda el email de Homestead. |
| 11 | Dónde guarda | `service_requests` + `revenue_leads` + `revenue_customers` + `concierge_*`. |
| 12 | ¿Crea solicitud? | **Sí.** Prueba `HS-2026-000027`. |
| 13 | Folio `HS-YYYY-NNNNNN` | **Sí.** Misma `saveServiceRequest()` / `nextPublicId()` que el formulario. |
| 14 | SQLite | **Sí.** |
| 15 | Email | **No** en el path del chatbot. Cero filas `EMAIL` para `HS-2026-000027`. No hay `sendContactEmail` en `concierge-handoff.ts`. |
| 16 | n8n | **Sí.** Log `N8nNotificationSucceeded` HTTP 200 para `HS-2026-000027`. |
| 17 | Telegram | **Sí, dual:** (a) n8n workflow solicitudes → `service_request_messages.channel=TELEGRAM SENT`; (b) bot Homestead `TelegramLeadAlertSent`. |
| 18 | ¿Puede agendar visita? | Puede **pedir/anotar preferencia**. No crea cita. |
| 19 | Dónde guarda la «cita» | No hay cita. Preferencia en `revenue_leads.preferred_date` / `preferred_time_window`. |
| 20 | ¿Entidad de citas? | **Sí:** `revenue_appointments` (`HA-********`). Vacía. |
| 21 | Relación cliente/solicitud | La cita, si existiera, une `lead_id` (= `public_id` HS) + `customer_id`. El lead `027` no tiene fila de cita. |
| 22 | Calendario admin | **Sí.** `/admin/citas` + `AppointmentCalendar`. |
| 23 | Origen de eventos | `listAppointments()` sobre `revenue_appointments`. Rango página: `businessYmd(-40)` … `businessYmd(+90)`. |
| 24 | ¿Por qué no veo citas? | La tabla de citas está vacía. El chatbot no escribe ahí. |
| 25 | ¿Se crea y la UI no muestra? | **No.** DB 0, API 0. No hay evento que mapear. |
| 26 | ¿El chatbot dice que agenda y no persiste? | En esta prueba **no** afirmó «cita agendada». Persistió preferencia de texto. **No** persistió appointment. |
| 27 | Google Calendar / otro | **No.** Código y docs: «No hay Google Calendar conectado». |
| 28 | ¿Procesos duplicados? | Formulario y chat convergen en `saveServiceRequest` + `notifyN8n`. Chat **además** llama `ingestCanonicalLead` inmediato y `sendNewLeadAlert`. Formulario **además** llama `sendContactEmail`. Riesgo de **doble Telegram** en leads de chat. |

---

## 2. Mapa de arquitectura real

```text
VISITANTE (homestead.lat)
  ├── páginas públicas: /  /services  /contact
  ├── ConciergeMount → ConciergeWidget (si GET /api/concierge/chat = 200)
  └── POST /api/contact  (formulario)

ADMIN
  ├── middleware cookie hs_admin  (/admin, /api/admin)
  ├── /admin  /admin/solicitudes  /admin/citas
  ├── /calendar y /appointments → redirect /admin/citas
  └── GET/PATCH /api/admin/appointments

BACKEND (Next.js 16, Docker homestead_web, 127.0.0.1:3091)
  ├── /api/concierge/chat
  ├── /api/concierge/photo
  ├── /api/contact
  └── /api/internal/*  (content studio, scheduler, revenue briefing)

DATOS
  └── SQLite /app/data/homestead.sqlite  (host /opt/apps/homestead/data)
        ├── service_requests (folio HS-YYYY-NNNNNN)
        ├── concierge_conversations / messages / events / photos / usage
        ├── revenue_customers / revenue_leads / revenue_appointments
        └── content_*, marketing_*

IA
  └── OpenAI POST https://api.openai.com/v1/chat/completions  (servidor, no browser)

SALIDAS
  ├── SMTP  (solo formulario)
  ├── n8n  POST webhook homestead-service-request
  │     └── Telegram «NUEVA SOLICITUD»
  └── Bot Homestead  sendNewLeadAlert  (solo chat / motor de revenue)
```

**Frontend:** React 19 + Next.js App Router. Widget: `src/components/concierge/ConciergeWidget.tsx`. Calendario: `src/components/admin/AppointmentCalendar.tsx` (cliente, sin librería tipo FullCalendar).

**Auth:** `src/middleware.ts`. Concierge es público con rate limit + origin check.

**Logs:** JSON a stdout del contenedor (`logInfo` / `logError`). Teléfono enmascarado en `ConciergeLeadCreated`.

**Variables (sin secretos, producción observada):**

```text
OPENAI_TEXT_MODEL=gpt-4o
OPENAI_CONCIERGE_MODEL=<empty>  → gpt-4o
AI_CONCIERGE_ENABLED=true
AI_CONCIERGE_DRY_RUN=true          ← NO bloquea leads (ver P0)
AI_CONCIERGE_CREATE_LEADS=<empty>  ← vacío ≠ false → SÍ crea
REVENUE_ENGINE_ENABLED=true
REVENUE_ENGINE_DRY_RUN=true
HOMESTEAD_TIMEZONE=<empty>         ← America/Panama vía revenue-engine.json
OPENAI_API_KEY_SET True
SMTP_PASS_SET True
N8N_WEBHOOK_SET True
TELEGRAM_BOT_SET True
```

---

## 3. Auditoría del chatbot

```text
CHATBOT PROVIDER: OpenAI
CHATBOT MODEL: gpt-4o
SDK: fetch HTTP (no SDK oficial OpenAI en el turn)
API ENDPOINT (app): POST /api/concierge/chat
API ENDPOINT (modelo): https://api.openai.com/v1/chat/completions
SYSTEM PROMPT LOCATION: src/lib/concierge-knowledge.ts (hs-concierge-v2)
CONVERSATION STORAGE: SQLite concierge_conversations + concierge_messages
SESSION STRATEGY: cookie httpOnly hs_cid, 7 días, Secure en production
TOOLS/FUNCTIONS: ninguna
STRUCTURED OUTPUT: response_format json_object
TEMPERATURE: 0.4
MAX TOKENS: no enviado (default del modelo)
TIMEOUT: 28s AbortController
RATE LIMIT: 40 msgs / 10 min / IP; 24 msgs usuario / 10 min / conversación
```

UI: `ConciergeWidget` montado desde `ConciergeMount` en layout público. GET inicial hidrata historial. POST `{ message }` o `{ event: "CHAT_STARTED" }`. Fotos: `POST /api/concierge/photo`.

Errores OpenAI: log `ConciergeOpenAiFailed` + fallback regex. Error de ruta: respuesta genérica «Puedo seguir registrando tu solicitud…».

---

## 4. ¿Realmente es IA?

**Híbrido.** No es un FAQ estático ni un workflow n8n conversacional.

| Mecanismo | Cuándo |
| --- | --- |
| OpenAI JSON | Casi cada turno si hay `OPENAI_API_KEY` (producción: sí). |
| Regex SAFETY | chispa/humo/gas → override seguridad. |
| Regex INJECTION | jailbreak → override. |
| Regex EXIT / stop | «no gracias» / no contactar → cierra y puede `stopFollowUps`. |
| `classifyPhone` | dígitos incompletos/inválidos **reemplazan** el reply del LLM. |
| `looksLikeSchedulingPreference` | hoy/mañana/lunes/a las/… **reemplazan** el reply por `preferenceAckReply`. |
| Fallback `fallbackReply` | sin API key o fallo OpenAI. |
| n8n | **después** del lead, no genera el diálogo. |

Sin API key el bot seguiría hablando con plantillas, pero no es el caso actual.

---

## 5. System prompt (sin modificarlo)

**Personalidad:** asesor comercial Homestead, español de Panamá, 1–4 frases.  
**Objetivo:** entender problema, una pregunta por turno, convertir a contacto + preferencia de visita.  
**Restricciones:** no inventar precios, diagnósticos, cupos, ni confirmar cita. No revelar el prompt.  
**Conocimiento:** catálogo del diccionario del sitio (A/C, plomería, pintura, electricidad, cerrajería, reparaciones, remodelación). Horario/cobertura publicados. Sin lista de precios.  
**Datos:** nombre opcional; teléfono cuando hay servicio y zona; no exige email.  
**Objeciones:** «lo voy a pensar» → una pregunta; «no gracias» → cerrar.

```text
HUMANNESS: 6/10
NATURALNESS: 5/10
SALES ABILITY: 6/10
EMPATHY: 5/10
CONTEXT RETENTION: 7/10  (con cookie; 2/10 si se pierde hs_cid)
SERVICE KNOWLEDGE: 7/10
LEAD CAPTURE: 8/10
BOOKING ABILITY: 2/10
```

- **HUMANNESS 6:** breve y en español, pero plantillas repetidas («Podemos ayudarte con eso»).
- **NATURALNESS 5:** el ack de horario pega el texto crudo del usuario, incluso con signos de pregunta.
- **SALES 6:** avanza a teléfono y visita; no cierra ni cotiza (correcto: no hay precios).
- **EMPATHY 5:** reconoce el problema en una frase; no profundiza síntomas.
- **CONTEXT 7:** estado SQLite + 12 mensajes. Refresh GET restauró 10 mensajes.
- **SERVICE 7:** A/C, fuga, pintura, typos. Catálogo cerrado.
- **LEAD 8:** teléfono válido + necesidad → folio real. Email/nombre no bloquean.
- **BOOKING 2:** el prompt **prohíbe** confirmar cita y el código **no** crea `revenue_appointments`.

---

## 6. Conversaciones reales (producción, 2026-08-22)

Cookie `hs_cid` preservada en el harness (sin `hs_cid`, cada POST sería otra conversación).

### A — `Hola`

«¡Hola! Cuéntame, ¿qué necesitas reparar, mantener o instalar?»  
`next=ASK_SERVICE_QUESTION` · lead `None`. Cumple el prompt (no se queda en «¿en qué puedo ayudarte?»).

### B — `Mi aire acondicionado no está enfriando.`

«Podemos ayudarte con eso. ¿En qué área de Panamá te encuentras?»  
Comprende A/C. Pregunta zona. Naturalidad media (plantilla).

### C — `Tengo una fuga debajo del fregador.`

Misma plantilla de ubicación. Plomería implícita.

### D — `Necesito pintar mi apartamento.`

Pintura detectada. Pregunta zona.

### E — `¿Cuánto cuesta?`

No inventa precio. Pide tipo de servicio. Alineado al prompt.

### F — no quiere dar email

«Necesito reparación eléctrica. No voy a dar mi email.»  
Acepta y pide zona. **No exige email.** Correcto respecto al código.

### G — teléfono incompleto

Tras cerradura, envío `60001` (sin zona). Override regex: «Parece que al número le faltan algunos dígitos…»  
`ASK_COMPLETE_CONTACT`. Lead no creado.  
Teléfono **válido solo** (`60001111`, sin email/nombre) se cubrió en la prueba de persistencia → folio `HS-2026-000027`.

### H — cambio de tema

Aire → «olvida el aire, ahora es una fuga de agua.»  
Cambia a fuga, vuelve a pedir zona. Conserva el hilo de la misma cookie.

### I — typos `mi aire no enfria y bota agua`

Entiende A/C. Pregunta zona.

### J — `¿Pueden venir mañana a las 3?` (sin teléfono previo)

Tras mantenimiento A/C: **pide teléfono**, no agenda. `LEAD: None`.

### Persistencia + booking con lead

```text
USER: Necesito mantenimiento del aire. AUDIT-CHATBOT-TEST
BOT:  …¿En qué área de Panamá…?
USER: Estoy en Ciudad de Panamá
BOT:  …número de contacto…
USER: 60001111
BOT:  Perfecto, ya tengo tus datos… ¿día u horario…?
LEAD: HS-2026-000027
USER: ¿Pueden venir mañana a las 3?
BOT:  Perfecto. Tomé como preferencia ¿Pueden venir mañana a las 3?. La verificaremos…
USER: Mañana a las 3 PM
BOT:  Perfecto. Tomé como preferencia Mañana a las 3 PM. La verificaremos…
```

Refresh `GET /api/concierge/chat`: **200, 10 mensajes**, roles user/assistant intercalados.

---

## 7. Humanidad del chatbot

Parece **asesor de servicios con embudo fijo**, más que un humano. No es FAQ puro ni vendedor de descuentos. Tampoco es un formulario visible, pero **sí es un formulario conversacional**: servicio → zona → teléfono → horario.

Problemas observados (no corregidos):

- Frase repetida «Podemos ayudarte con eso».
- Ack que concatena la pregunta del usuario.
- «Gracias. Parece que al número le faltan…» (plantilla).
- No profundiza («¿enfría un poco o nada?»).
- Tras el lead, dos acks de preferencia casi iguales.
- Mensaje persistido duplica «Necesidad: Necesidad:».
- El prompt pide una pregunta por turno; G saltó zona porque el usuario mandó dígitos.
- No se observó «cita agendada» en esta corrida. Sí se observa **promesa de coordinación** («La verificaremos para coordinar la visita») sin crear evento de calendario.

---

## 8. Captura de lead (prueba AUDIT)

Estado interno de la conversación `027` (sanitizado): servicio `ac`, zona `Ciudad de Panamá`, nombre `""`, teléfono E.164 de prueba, email `""`, `preferredTime` `Mañana a las 3 PM`, `contactStatus` `VALID`.

| Campo | CAPTURED? | VALIDATED? | PERSISTED? | TABLE / COLUMN | USED LATER? |
| --- | --- | --- | --- | --- | --- |
| nombre | NO (opcional) | no | sí como `Cliente web` | `service_requests.name` / `revenue_customers.name` | Telegram / n8n |
| teléfono | SÍ | Panamá 8 dígitos | SÍ | `service_requests.phone` `revenue_leads.phone_normalized` | handoff, Telegram |
| email | NO del cliente | no | placeholder Homestead | `service_requests.email` | n8n muestra email de empresa |
| servicio | SÍ `ac` | enum catálogo | SÍ | `service_requests.service` `revenue_leads.service_category` | sí |
| tipo propiedad | NO preguntado | no | `other` fijo | `service_requests.property` | n8n |
| problema | SÍ (resumen LLM) | no | SÍ, sin el marcador `AUDIT-CHATBOT-TEST` | `message` / `problem_summary` | sí |
| ubicación | SÍ | texto libre | SÍ | `revenue_leads.general_location` + texto en `message` | sí |
| fecha | SÍ token `mañana` | no es `YYYY-MM-DD` | `preferred_date` | `revenue_leads.preferred_date` | no calendario |
| hora | SÍ texto `Mañana a las 3 PM` | no `HH:MM` | `preferred_time_window` | `revenue_leads.preferred_time_window` | no calendario |

`AUDIT-CHATBOT-TEST` vive en `concierge_messages.body`, no en `service_requests.message`. Por eso una búsqueda SQL solo en solicitudes no lo encuentra; el folio sí existe.

---

## 9. Momento de conversión a SERVICE REQUEST

**Condición:** `canHandoffLead` = teléfono `VALID` **y** (problema o servicio ≠ `unknown`).  
**Kill switch real:** `AI_CONCIERGE_CREATE_LEADS !== "false"`. Vacío crea. `AI_CONCIERGE_DRY_RUN` **no** se consulta en `createLeadFromConcierge`.

**Endpoint:** mismo proceso del turn `POST /api/concierge/chat` (no hay `/api/leads`).

**Función:** `createLeadFromConcierge` → `saveServiceRequest` (transacción SQLite, `nextPublicId`) → `ingestCanonicalLead` → `notifyN8n` (async) → `sendNewLeadAlert`.

**Idempotencia:** si `lead_public_id` ya es HS real, no crea otro folio.

**Respuesta al cliente:** `leadId: HS-2026-000027` en JSON. El texto humano **no** recita el folio; pide preferencia de visita.

Folio **igual** que el formulario: `HS-YYYY-NNNNNN` con año America/Panama.

---

## 10. Chatbot vs formulario

| | FORMULARIO `POST /api/contact` | CHATBOT `createLeadFromConcierge` |
| --- | --- | --- |
| Persistencia | `saveServiceRequest` | **la misma** |
| Folio | HS-… | HS-… |
| Validación | nombre, teléfono, email regex, property, service, message ≥8, fotos | teléfono válido + necesidad |
| property | elegido | siempre `other` |
| email | obligatorio del cliente | email de Homestead si vacío |
| fotos | en la solicitud | `photos: []` (fotos de chat en otro directorio) |
| `notifyN8n` | sí | sí |
| `sendContactEmail` | sí | **no** |
| `sendNewLeadAlert` | no | **sí** |
| `ingestCanonicalLead` | diferido `ingestSavedRequest` | inmediato + otra vez diferido (upsert) |
| canal mensaje interno | `FORM` | también `FORM` (el chat no tiene canal propio en `service_request_messages`) |

Convergen conceptualmente en `saveServiceRequest`, **no** en un único `CreateServiceRequest()` de notificaciones.

---

## 11. SQLite (producción, conteos 2026-08-22 post-prueba)

Tablas: `service_requests` (26), `service_request_messages` (29), `concierge_conversations` (54), `concierge_messages` (174), `concierge_events` (248), `concierge_photos` (0), `concierge_usage` (87), `revenue_customers` (10), `revenue_leads` (26), `revenue_appointments` (**0**), `revenue_appointment_notices` (0), más content/marketing/quotes/jobs vacíos o de Content Studio.

**Relaciones relevantes:**

- `service_requests.public_id` = `revenue_leads.lead_id`
- `revenue_appointments.lead_id` → lead; `customer_id` → `revenue_customers`
- `concierge_conversations.lead_public_id` → folio HS
- `concierge_messages.conversation_id` → conversación UUID

Índices: `idx_rev_appt_date`, `idx_rev_appt_status`, `idx_concierge_msgs`, `idx_rev_cust_phone`, unique `public_id` / `lead_id` / `appointment_id`.

PII no se reproduce aquí. Teléfono de prueba `60001111` marcado `is_test=1`.

---

## 12. Persistencia real

```text
CHATBOT LEAD PERSISTED: PASS
FOLIO: HS-2026-000027
SOURCE: WEBSITE_AI_CHAT
SQLITE service_requests: YES
SQLITE revenue_leads: YES
MARKER AUDIT-CHATBOT-TEST IN REQUEST MESSAGE: NO (solo en concierge_messages)
APPOINTMENTS: 0
```

---

## 13. Email

Formulario: `sendContactEmail` si SMTP configurado (lo está).  
Chatbot: no llama mail. `EMAIL_MESSAGES_027 = 0`. Logs de la ventana: sin `EmailNotification*` para `027`.

```text
CHATBOT → EMAIL: NOT IMPLEMENTED
FORM → EMAIL: EXISTS IN CODE + SMTP SET (no se reenvió un formulario en esta fase)
```

---

## 14. n8n (no modificados)

JSON en repo (`active: false` es artefacto de export, no prueba de producción). Consulta SQL directa a Postgres n8n falló en esta corrida; la prueba viva del webhook **sí** respondió 200.

| WORKFLOW | PURPOSE | TRIGGER | INPUT | OUTPUT | ACTIVE (evidencia) |
| --- | --- | --- | --- | --- | --- |
| HOMESTEAD — Nueva solicitud → Telegram | Aviso de `service_request.created` | Webhook `POST /webhook/homestead-service-request` | payload firmado | Telegram HTML + fotos | **Sí en prod:** `N8nNotificationSucceeded` HTTP 200 para `HS-2026-000027` |
| HOMESTEAD — Content Studio | Contenido / Telegram ops | webhook content-studio | updates Telegram | Homestead `/api/internal/content/telegram-update` | fuera del flujo chat→solicitud |
| HOMESTEAD — Content Scheduler | tick 10 min | schedule | tick | `/api/internal/content/scheduler-tick` | no chatbot |
| HOMESTEAD — Daily Business Briefing | briefing | 24h | — | `/api/internal/revenue/daily-briefing` | no chatbot |
| HOMESTEAD — Weekly Revenue Report | reporte | 7d | — | `/api/internal/revenue/weekly-report` | no chatbot |
| HOMESTEAD — Marketing Analytics Collector | analytics | 12h | — | `/api/internal/content/analytics-collect` | no chatbot |
| HOMESTEAD — Weekly Marketing Report | marketing | 7d | — | `/api/internal/content/weekly-report` | no chatbot |

n8n **no** genera el diálogo del chatbot.

---

## 15. Telegram

```text
FORM → TELEGRAM: PASS
  Evidencia: service_request_messages TELEGRAM SENT en solicitudes de formulario
  (HS-2026-000018 … 000022, sin prefijo «Asistente web Homestead»).

CHATBOT → TELEGRAM: PASS
  Evidencia HS-2026-000027:
  - N8nNotificationSucceeded http 200
  - service_request_messages TELEGRAM SENT
  - TelegramLeadAlertSent (bot Homestead, stage=1)
```

No son el **mismo** mensaje: el formulario usa n8n; el chat usa **n8n + alerta del motor de revenue**.

---

## 16–18. Citas — cuando el chatbot «agenda»

Búsqueda en código: `Appointment` / `createAppointment` / `revenue_appointments` / `listAppointments` / `AppointmentCalendar`. No hay Google/CalDAV.

`createAppointment(leadId, date, startTime, status)` existe en `src/lib/revenue-store.ts`. Único llamador de creación: `proposeVisitSlot` en `src/lib/revenue-telegram.ts` (operador Telegram: PROGRAMAR visita). Admin PATCH confirma/cancela/reprograma citas **ya existentes**.

El concierge **nunca** importa ni llama `createAppointment`. Scheduling en chat:

1. Regex `looksLikeSchedulingPreference`
2. `parseVisitPreference` → `{ preferredDate: "mañana"|"hoy"|"", preferredTimeWindow: raw }`
3. `saveLeadPreference(leadId, preferredDate, rawText)`
4. Reply `preferenceAckReply`

```text
CHATBOT CLAIMED BOOKING: NO  (dijo preferencia, no «cita agendada»)
APPOINTMENT ACTUALLY PERSISTED: NO
APPOINTMENT ID: n/a
RELATED SERVICE REQUEST: lead HS-2026-000027 existe; cita NO
```

**No** se clasifica como «afirmó cita inexistente» en esta corrida. **Sí** hay desconexión producto: el usuario pide venir mañana a las 3 y el calendario sigue vacío.

Clasificación de integridad conversacional: **P1** (promesa de coordinación / preferencia sin entidad de cita). No P0 de «Su cita ha sido agendada» en el texto observado.

---

## 19. Fecha y hora / timezone

- Negocio: `America/Panama` (`src/data/revenue-engine.json`). `HOMESTEAD_TIMEZONE` vacío.
- `created_at` de solicitudes: ISO UTC.
- `revenue_appointments.date` esperado `YYYY-MM-DD`; `start_time` `HH:MM`.
- Chat guarda `"mañana"` y `"Mañana a las 3 PM"` — **no** convierte a fecha de calendario ni a 15:00.
- «esta tarde» / «el lunes»: regex puede marcar preferencia; `parseVisitPreference` solo mapea hoy/mañana a `preferred_date`.
- Panamá no usa DST. Un desfase UTC↔Panama **no** explica citas invisibles: no hay filas.
- Calendario UI compara `item.date === day` con días `YYYY-MM-DD` anclados a noon UTC para la grilla.

```text
TIMEZONE (capa calendario): PASS (America/Panama)
TIMEZONE (chat → cita): FAIL (no hay parsing a YMD/HH:MM ni INSERT)
```

---

## 20–24. Calendario end-to-end

```text
SQLite revenue_appointments          ✓ REAL (tabla existe, 0 filas)
  ↓
listAppointments()  revenue-store    ✓ REAL
  ↓
/admin/citas SSR  +  GET /api/admin/appointments   ✓ REAL (auth)
  ↓
HTTP { ok, appointments: [] }        ✓ REAL  API_APPOINTMENTS 0
  ↓
AppointmentCalendar items=[]         ✓ REAL
  ↓
Event mapping item.date === day      ✓ REAL (nunca ejecuta con datos)
  ↓
Rendered appointment                 ✗ BROKEN  (nada que pintar)
```

```text
DB APPOINTMENTS: 0
API APPOINTMENTS: 0
CALENDAR DISPLAYED: 0
CALENDAR DISPLAY: FAIL
CALENDAR ROUTE: /admin/citas
CALENDAR API: GET /api/admin/appointments  (cookie hs_admin)
AUTH: anonymous → login; API → 401. Login admin en prueba: OK.
```

UI: vistas Mes / Semana / Día, filtros estado/servicio, panel «Próximas citas» con empty state «Sin citas.», detalle con cliente/hora/zona, acciones confirm/cancel/reschedule vía PATCH. Sin FullCalendar. Responsive: grilla 7 columnas con `overflow-x-auto`. Loading: SSR, sin spinner de fetch inicial. Errores de mutate: «No se pudo actualizar la cita.»

```text
CALENDAR UX: 6/10   (claro, pero vacío de negocio)
CALENDAR UI: 7/10
MOBILE: 6/10
USEFULNESS: 2/10    (no hay citas que operar desde el chat)
```

**Causa de citas invisibles:** **A** — no se guardan como appointments.  
Contribuye **B** si se esperaba ver preferencias: el calendario **no** lee `revenue_leads.preferred_*`.  
No es C/D/E/F/G/H/I/J: API autenticada devolvió 0 coherente con DB; no es UI sin backend.

---

## 25. Calendario externo

```text
EXTERNAL CALENDAR INTEGRATION: NO
```

---

## 26. Duplicados

| Riesgo | Evidencia |
| --- | --- |
| Doble solicitud chat | Mitigado: `existingLeadId` HS no recrea. |
| Doble cita chat | No aplica: cero citas. |
| Doble Telegram chat | **Real:** n8n + `sendNewLeadAlert`. Log `TelegramLeadAlertSent` aparece dos veces (handoff + función); un envío `stage=1` + n8n aparte. |
| Doble email | Chat no manda email. |
| Doble webhook | n8n idempotencia `event:requestId`. Retry de tool no aplica (no hay tools). |
| `ingestCanonicalLead` 2× | upsert; no duplica `lead_id`. |
| Preferencia 2 mensajes | sobrescribe la misma fila del lead. |

---

## 27–29. Estado conversacional, refresh, tabs

Estado canónico: **SQLite** `state_json` + `lead_public_id`. El LLM recibe ese JSON cada turno. React solo muestra mensajes.

Cookie `hs_cid` 7 días, httpOnly. No hay memoria OpenAI threads.

```text
REFRESH (probado): CONVERSATION PRESERVED? YES (10 msgs)
LEAD PRESERVED? YES (SQLite, no depende del browser)
CONTEXT PRESERVED? YES (misma cookie)
MULTI-TAB: NOT TESTED en dos pestañas reales.
  Arquitectura: misma cookie de sitio → misma conversación; tryBeginTurn evita doble turn concurrente.
```

---

## 30. Privacidad y seguridad (sin pentest destructivo)

- OpenAI key solo servidor. No hay tools que el modelo pueda disparar.
- Prompt no se sirve al browser. Jailbreak regex.
- Rate limit IP + conversación.
- Origin check si hay header `Origin`.
- Admin protegido por middleware.
- SQL parametrizado.
- Fotos: sniff MIME, tamaño, disco bajo `data/concierge/{id}` (0 fotos en prod en esta foto de DB).
- PII en SQLite en claro (esperado para CRM). Logs de lead enmascaran teléfono.
- Chatbot público: abuso limitado por rate, no por auth.
- `AI_CONCIERGE_DRY_RUN=true` **no** aísla producción (Telegram/n8n reales).

```text
PII PROTECTION: PARTIAL
RATE LIMITING: PASS
SECRETS EXPOSED (frontend API keys): 0
```

---

## 31. Costo IA (arquitectura, no precios)

- Modelo: `gpt-4o`, 1 llamada por turno (si hay key y no abort).
- Contexto reenviado: system prompt + estado JSON + hasta 12 mensajes.
- Uso acumulado tabla `concierge_usage`: 87 filas, ~96 958 prompt + ~11 183 completion tokens (histórico, no solo esta auditoría).
- Media aproximada: ~1 1xx prompt tokens / llamada.
- Sin `max_tokens`. Timeout 28s.
- Rate 40/10 min/IP reduce abuso, no lo elimina.

---

## 32. Diagrama real

```text
VISITOR
   ↓
CHAT UI  ConciergeWidget                 ✓ REAL
   ↓
POST /api/concierge/chat  (hs_cid)       ✓ REAL
   ↓
OpenAI gpt-4o JSON                       ✓ REAL
   ↓
regex phone / schedule / safety          ✓ REAL
   ↓
TOOL createAppointment?                  ✗ BROKEN (no existe en este path)
   ↓
saveServiceRequest → HS-YYYY-NNNNNN      ✓ REAL
   ↓
SQLITE service_requests + revenue_leads  ✓ REAL
   ├── EMAIL sendContactEmail            ✗ BROKEN (no implementado en chat)
   ├── N8N → Telegram solicitud          ✓ REAL
   ├── sendNewLeadAlert Telegram         ✓ REAL
   └── APPOINTMENT revenue_appointments  ✗ BROKEN (0 filas; solo preferred_*)
            ↓
         CALENDAR API                    ✓ REAL (devuelve [])
            ↓
         CALENDAR UI /admin/citas        ⚠ PARTIAL (UI real, dataset vacío)
```

---

## 33. Matriz end-to-end

| Capability | Exists | Works | Persisted | Visible | Evidence |
| --- | --- | --- | --- | --- | --- |
| chatbot UI | YES | YES | n/a | YES | ConciergeWidget + 200 |
| AI gpt-4o | YES | YES | usage table | n/a | env + replies no-fallback |
| conversation context | YES | YES | SQLite | refresh YES | GET 10 msgs |
| lead capture | YES | YES | YES | admin solicitudes | HS-2026-000027 |
| request creation | YES | YES | YES | folio | saveServiceRequest |
| SQLite | YES | YES | YES | n/a | dump |
| email (chat) | NO | NO | NO | NO | 0 EMAIL msgs |
| n8n | YES | YES | n8n + TELEGRAM msg | Telegram | HTTP 200 |
| Telegram | YES | YES | SENT | operador | dual path |
| appointment | YES entity | NO from chat | NO | NO | table 0 |
| calendar API | YES | YES empty | n/a | [] | GET 0 |
| calendar UI | YES | empty state | n/a | 0 events | /admin/citas |
| photos (chat) | YES code | NOT TESTED live | 0 rows | n/a | concierge_photos=0 |

---

## 34. Defectos

### P0

1. **`AI_CONCIERGE_DRY_RUN=true` no es kill switch.** La conversación quedó `dry_run=1` y aun así se creó `HS-2026-000027`, n8n 200 y Telegram. El código de handoff ignora dry-run; solo `AI_CONCIERGE_CREATE_LEADS=false` evita el alta. Documentación `docs/AI-SALES-CONCIERGE.md` está desactualizada (dice que dry-run no notifica).

### P1

1. El chatbot **no crea citas**; el calendario opera sobre `revenue_appointments` vacía. Preferencia de «mañana 3 PM» no es un evento.
2. Email de solicitudes de chat **no implementado** (el formulario sí).
3. Fecha/hora de chat no se normalizan a `YYYY-MM-DD` / `HH:MM`.
4. Fotos del concierge no se copian a `service_requests.photos_json` (siempre `[]` en handoff).

### P2

1. Doble notificación Telegram (n8n + `sendNewLeadAlert`) en leads de chat.
2. Email placeholder de Homestead en el payload n8n (parece email del cliente).
3. `property=other` siempre.
4. UX de plantillas («Podemos ayudarte con eso»; ack que cita la pregunta).
5. Mensaje persistido duplica «Necesidad: Necesidad:».
6. Canal interno de mensajes del chat queda como `FORM`.

### P3

1. Log `TelegramLeadAlertSent` duplicado en el mismo turno.
2. Docs prompt `hs-concierge-v1` vs código `v2`.
3. Exports n8n `active: false` no reflejan producción.
4. Sin Google Calendar (esperado hoy).

---

## 35–36. Qué existe / funciona / no / por qué / dónde se rompe

**Existe:** chat IA, memoria SQLite, leads HS, n8n, Telegram, tabla y UI de citas, auth admin.

**Funciona:** diálogo gpt-4o, captura de teléfono, folio, SQLite, n8n, Telegram, refresh de historial, API de calendario autenticada.

**No funciona como «agenda visible»:** chat → appointment → calendario.

**Por qué:** el diseño actual trata «mañana a las 3» como **preferencia comercial**, no como booking. `createAppointment` es del operador Telegram.

**Dónde se rompe:** `src/lib/concierge-engine.ts` (ack de preferencia) / `saveLeadPreference` → **no hay** puente a `createAppointment` → `listAppointments` lee otra tabla.

---

## 37. Resumen operativo

Ver bloque al final de este archivo (copia de la sección pedida).

---

## 38. STOP

No se implementó Homestead Conversational AI V2.  
No se cambió prompt, modelo, n8n, calendario ni esquema.

```text
==================================================
HOMESTEAD
CHATBOT + LEAD + BOOKING + CALENDAR
FORENSIC AUDIT
==================================================

CHATBOT

PROVIDER: OpenAI
MODEL: gpt-4o
SYSTEM PROMPT: src/lib/concierge-knowledge.ts  hs-concierge-v2
CONVERSATION MEMORY: SQLite + cookie hs_cid (last 12 msgs + state_json)
HUMANNESS: 6/10
NATURALNESS: 5/10
SALES ABILITY: 6/10

LEAD

NAME CAPTURE: FAIL
PHONE CAPTURE: PASS
EMAIL CAPTURE: FAIL
SERVICE CAPTURE: PASS
PROBLEM CAPTURE: PASS
LOCATION CAPTURE: PASS

SERVICE REQUEST

CHATBOT CREATES REQUEST: PASS
PUBLIC ID: PASS
SQLITE: PASS
EMAIL: FAIL
N8N: PASS
TELEGRAM: PASS

BOOKING

CHATBOT CAN REQUEST BOOKING: PASS
BOOKING FUNCTION EXISTS: YES
APPOINTMENT ACTUALLY CREATED: FAIL
APPOINTMENT PERSISTED: FAIL
REQUEST ↔ APPOINTMENT LINK: FAIL
TIMEZONE: FAIL

CALENDAR

CALENDAR EXISTS: YES
CALENDAR ROUTE: /admin/citas
CALENDAR API: GET /api/admin/appointments
DB APPOINTMENTS: 0
API APPOINTMENTS: 0
DISPLAYED APPOINTMENTS: 0
CALENDAR DISPLAY: FAIL

ROOT CAUSE OF INVISIBLE APPOINTMENTS:
El chatbot no llama createAppointment(). Guarda texto en revenue_leads.preferred_date/preferred_time_window. El calendario solo lista revenue_appointments, que está vacía.

INTEGRATIONS

EMAIL: FAIL
N8N: PASS
TELEGRAM: PASS
GOOGLE CALENDAR: NO

SECURITY

PII PROTECTION: PARTIAL
RATE LIMITING: PASS
SECRETS EXPOSED: 0

DEFECTS

P0: AI_CONCIERGE_DRY_RUN=true no impide leads ni Telegram/n8n
P1: no hay cita persistida; calendario vacío; email chat ausente; fecha no parseada; fotos chat no van a la solicitud
P2: doble Telegram; email placeholder; property=other; plantillas; mensaje duplicado
P3: log duplicado; docs desactualizados

TOP 10 FINDINGS:

1. IA real: OpenAI gpt-4o JSON, no n8n-chat, híbrido con regex.
2. Lead real HS-2026-000027 en SQLite (source WEBSITE_AI_CHAT, is_test=1).
3. Folio idéntico al formulario vía saveServiceRequest.
4. Chat dispara n8n (HTTP 200) y Telegram; no dispara email.
5. Chat dispara además sendNewLeadAlert (doble canal vs formulario).
6. Email del cliente no se pide; se persiste el de Homestead.
7. «Mañana a las 3» = preferencia de texto, no fila HA-*.
8. revenue_appointments = 0; API admin = []; UI «Sin citas».
9. DRY_RUN=true no aisló producción.
10. createAppointment solo existe en el flujo operador Telegram.

REAL CURRENT FLOW:

VISITOR → CHAT UI → /api/concierge/chat → gpt-4o JSON
  → regex phone/schedule → saveServiceRequest (HS-…)
  → SQLite
     ├── n8n → Telegram solicitud          ✓
     ├── Homestead bot lead alert          ✓
     ├── email                             ✗
     └── preferred_*  ↛  revenue_appointments ↛ calendar  ✗

FINAL VERDICT:

El chatbot es un concierge OpenAI que SÍ convierte conversación en solicitud Homestead (folio, SQLite, n8n, Telegram) y NO agenda citas de calendario. La percepción de «citas invisibles» no es un bug de timezone ni de mapeo UI: no hay appointments que mostrar. El asistente anota preferencias y pide que el equipo coordine; createAppointment queda en Telegram operador.

NO CHANGES WERE MADE:
YES
==================================================
```
