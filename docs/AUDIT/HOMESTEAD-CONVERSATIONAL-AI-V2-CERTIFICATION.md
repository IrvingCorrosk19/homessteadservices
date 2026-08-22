# HOMESTEAD CONVERSATIONAL AI V2 — CERTIFICATION

DATE: 2026-08-22 America/Panama

```text
PRE-IMPLEMENTATION GATE
AUDIT LOADED: PASS
GIT BACKUP: PASS  tag pre-conversational-ai-v2-20260822-0208
SQLITE BACKUP: PASS  /opt/backups/pre-conversational-ai-v2-20260822-0208 integrity ok
N8N BACKUP: NOT REQUIRED
SAFE TO CONTINUE: YES
```

PRE_AI_V2_SHA: `89de45ad44c8e61cf13315fe47ef68578c0b430e`  
CODE SHA: `bb9a2d9`  
FINAL SHA: (docs commit)  
COMMITS: `8cb1855` feat v2 · `bb9a2d9` confirmation integrity

## AUDIT FINDINGS USED

```text
Current AI: OpenAI Chat Completions (was JSON-only)
Current model: gpt-4o
Current chatbot endpoint: POST /api/concierge/chat
Current conversation persistence: SQLite + hs_cid
Current lead persistence: saveServiceRequest HS-YYYY-NNNNNN
Current booking implementation: preference text only (defect)
Current calendar implementation: /admin/citas ← revenue_appointments
Calendar defect: no appointments inserted from chat
Current n8n: webhook homestead-service-request
Current Telegram: n8n + duplicate sendNewLeadAlert
```

ROOT CAUSES ADDRESSED: chat now calls `createAppointment()` after `check_availability()` and explicit confirm; calendar reads the same table; request Telegram stays n8n; booking uses `notifyAppointmentEvent`; dry-run actually skips notifies when true (prod set `false`).

## LIVE EVIDENCE (sanitized)

| Item | Result |
| --- | --- |
| Form | HS-2026-000029 · n8n 200 · email ok |
| Chat lead + book 15:00 | HS-2026-000028 · HA-32eea0ba CONFIRMED 2026-08-23 15:00 CHAT |
| Chat lead + book 10:00 | HS-2026-000030 · HA-7306eb00 · reply «Listo. La visita quedó agendada…» |
| DB appointments | 2 |
| API appointments | 2 origin Chatbot |
| Telegram request | N8nNotificationSucceeded |
| Telegram booking | AppointmentTelegramSent CONFIRMED:1 (HA-32eea0ba y HA-7306eb00) |
| Injection | denied, no API key |
| Human handoff | escalate, no enclosure |
| Refresh | GET 10 messages |
| Typos | fuga del fregador understood |
| Price | no invented amount |

## SCORES (not inflated)

NATURALNESS 8/10 — still some templates; plumbing turn asked zona and teléfono together.  
EMPATHY 8/10  
CONTEXT RETENTION 8/10 — packed identity captured; still asked to pick a slot even when 10:00 was requested (correct confirmation, slightly extra).  
SERVICE UNDERSTANDING 9/10  
SALES HELPFULNESS 8/10  
TRUTHFULNESS 10/10 after hotfix (does not claim booking without HA-*).  
BOOKING INTEGRITY 10/10 on confirm canary.

Target NATURALNESS>=9 not met. Pipeline booking→calendar→telegram met.

## ROLLBACK

Git tag `pre-conversational-ai-v2-20260822-0208`. SQLite backup as above. n8n unchanged.
