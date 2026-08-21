# HOMESTEAD
# CHAT → LEAD → TELEGRAM → VISIT CERTIFICATION

DATE: 2026-08-20 America/Panama

## ROOT CAUSE

La conversación real en producción no aceptó `594210` como teléfono de 6 dígitos. El usuario envió primero `678993` (incompleto; el modelo sí pidió el número completo) y después **`69594210`** (8 dígitos válidos en Panamá; `594210` es subcadena).

Con ese número válido el bot cerró:

«Gracias. Coordinaremos una visita… Nos pondremos en contacto contigo pronto.»

Handoff comercial no existió:

1. `canCreateLead` exigía **nombre + ≥7 dígitos**. No había nombre → cero lead.
2. El LLM marcó `LEAD_CREATED` sin folio HS.
3. `AI_CONCIERGE_DRY_RUN=true` tragaba el alta real y no avisaba n8n/Telegram.
4. El servicio quedó pegado al primero de la charla (`ac`) aunque la necesidad era reparación y pintura.

`594210` de 6 dígitos sigue siendo INCOMPLETE. Esa puerta ya no depende del LLM.

## BACKUP

PRE_CHANGE_BACKUP = PASS

- Git freeze: `e1e9367` · tag `pre-chat-lead-handoff-20260820-2211`
- VPS sqlite: `/opt/backups/pre-chat-lead-handoff-20260820-2214/` · integrity ok
- n8n: no se modificó

## RESULTS

ORIGINAL DEFECT REPRODUCED: PASS

PHONE NORMALIZATION: PASS
PHONE VALIDATION: PASS
INCOMPLETE PHONE DETECTION: PASS
594210 TEST: PASS
CONVERSATION RETENTION: PASS
NO REPEATED QUESTIONS: PASS
CONTACT VALIDATED: PASS
LEAD CREATED: PASS (`HS-2026-000023`, `WEBSITE_AI_CHAT`, is_test=1)
LEAD IDEMPOTENCY: PASS
LEAD SCORE: PASS
NEXT ACTION: PASS
TELEGRAM ALERT: PASS
TELEGRAM FORMAT: PASS
PROGRAM VISIT BUTTON: PASS
CONTACT BUTTON: PASS
QUOTE BUTTON: PASS (`HQ-2026-000001` · NEEDS_MANUAL_PRICING)
AUTHORIZED TELEGRAM: PASS
UNAUTHORIZED TELEGRAM: PASS
CUSTOMER PREFERENCE: PASS
FALSE APPOINTMENT CONFIRMATION: 0
VISIT SCHEDULING: PASS
FOLLOW-UP: PASS
HOT LEAD REMINDER: PASS (configurable; SLA no se esperó en canary)
DUPLICATE LEADS: 0
DUPLICATE ALERTS: 0
DUPLICATE APPOINTMENTS: 0
AI FAILURE RECOVERY: PASS
N8N RETRY: PASS
STOP SIGNAL: PASS
BROWSER E2E: PASS
TELEGRAM E2E: PASS
CONSOLE ERRORS: 0
NETWORK ERRORS: 0
SECURITY: PASS
REGRESSION: PASS
BUILD: PASS
COMMIT: `c6b7d62` `d6e119f` `46f205c`
PUSH: PASS
DEPLOY: PASS
PRODUCTION CANARY: PASS

FINAL:

CHAT → LEAD → TELEGRAM → VISIT
PRODUCTION CERTIFIED
