# HOMESTEAD
# CHAT → LEAD → TELEGRAM → VISIT CERTIFICATION

DATE: 2026-08-20 America/Panama

## ROOT CAUSE

La conversación real en producción (`concierge_messages`) no aceptó `594210` como teléfono de 6 dígitos. El usuario envió primero `678993` (incompleto; el modelo sí pidió el número completo) y después **`69594210`** (8 dígitos, válido en Panamá; `594210` aparece como subcadena).

Con ese número válido ocurrió el cierre defectuoso:

«Gracias. Coordinaremos una visita… Nos pondremos en contacto contigo pronto.»

Handoff comercial **no existió**:

1. `canCreateLead` exigía **nombre + ≥7 dígitos**. No había nombre → **cero lead**.
2. El LLM marcó `funnelStage = LEAD_CREATED` sin folio HS.
3. `AI_CONCIERGE_DRY_RUN=true` habría creado solo `DRY-…` y **no** llamaba n8n/Telegram aunque el nombre existiera.
4. El servicio quedó pegado en `ac` (el primero de la charla) aunque la necesidad final era reparación y pintura.
5. No hay `LEAD_CREATED` en eventos. `service_requests` no creció. Revenue no recibió el chat. Telegram interno no disparó.

`594210` de 6 dígitos **debe** seguir siendo INCOMPLETE. El arreglo no depende del LLM para esa puerta.

## BACKUP

PRE_CHANGE_BACKUP = PASS

- Git: `e1e9367` · tag `pre-chat-lead-handoff-20260820-2211`
- VPS sqlite: `/opt/backups/pre-chat-lead-handoff-20260820-2214/` · integrity ok
- n8n: no se modificó

## FIX (extend, no rebuild)

- Validador central en `src/data/contact-region.json` + `src/lib/phone.ts` (VALID / INVALID / INCOMPLETE / UNKNOWN). Panamá por defecto, internacional permitido.
- Contacto válido **sin nombre** (Cliente web). Una conversación → un lead HS canónico `WEBSITE_AI_CHAT`.
- `594210` → pide el número completo; conserva servicio, zona e intent.
- Tras contacto válido: pide preferencia de visita. No cierra con «te contactamos pronto». Preferencia ≠ cita confirmada.
- Alerta Telegram interna premium + botones. PROGRAMAR VISITA usa horario comercial (no inventa agenda de técnicos). Cotización: SITE VISIT REQUIRED / NEEDS_MANUAL_PRICING.
- Callbacks solo `AUTHORIZED_CHAT_IDS`. Recordatorio HOT con `HOT_LEAD_ATTENTION_MINUTES`.

ORIGINAL DEFECT REPRODUCED: PASS

PHONE NORMALIZATION: PASS (local)
PHONE VALIDATION: PASS (local)
INCOMPLETE PHONE DETECTION: PASS (local)
594210 TEST: PASS (local)
CONVERSATION RETENTION: PASS (local / code)
NO REPEATED QUESTIONS: PASS (prompt + state)
CONTACT VALIDATED: PASS (local)
LEAD CREATED: see production canary
LEAD IDEMPOTENCY: PASS (code: existingLeadId)
LEAD SCORE: PASS (existing engine + location + site visit weight)
NEXT ACTION: PASS (PROGRAM_SITE_VISIT)
TELEGRAM ALERT: see production canary
TELEGRAM FORMAT: PASS (code)
PROGRAM VISIT BUTTON: PASS (code)
CONTACT BUTTON: PASS (code)
QUOTE BUTTON: PASS (code)
AUTHORIZED TELEGRAM: PASS (existing isTelegramAdmin)
UNAUTHORIZED TELEGRAM: PASS (denied before mutation)
CUSTOMER PREFERENCE: PASS (code)
FALSE APPOINTMENT CONFIRMATION: 0 (PROPOSED only)
FOLLOW-UP: PASS (existing engine + PROGRAM_SITE_VISIT)
HOT LEAD REMINDER: PASS (scheduler-tick + configurable minutes)
DUPLICATE LEADS: guarded by conversation.leadPublicId
STOP SIGNAL: PASS (code)
BROWSER E2E: see canary
TELEGRAM E2E: see canary
SECURITY: PASS (no secrets; phones masked in new lead log)
REGRESSION: PASS (static suites + production build)
BUILD: PASS (`next build`)
