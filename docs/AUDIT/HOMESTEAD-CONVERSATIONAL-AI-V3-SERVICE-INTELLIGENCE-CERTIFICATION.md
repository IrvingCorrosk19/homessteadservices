# HOMESTEAD CONVERSATIONAL AI V3 — SERVICE INTELLIGENCE CERTIFICATION

DATE: 2026-08-22 America/Panama  
SCOPE: Service playbooks, structured state, photo-first locksmith, Wave A/B/C + V2 regression intact.

```text
PRE-V3 ROLLBACK
GIT TAG: pre-conversational-ai-v3-20260822-1048 @ 21525a0
SQLITE BACKUP: /opt/backups/pre-conversational-ai-v3-20260822-1048/homestead/homestead.sqlite
  SHA256 fbc18d63dabb89acd9218944b73a0e708e3317bce4687b58b3067cb177c086e4
  integrity_check: ok (via homestead_web node)
DEPLOY: homestead_web only — DEPLOY_OK loopback:200
```

COMMITS: `3df9742` service playbooks · `0ce623d` embedded phone fix  
FINAL SHA: `0ce623d`  
ORIGIN: pushed `main`

```text
========================================================
HOMESTEAD CONVERSATIONAL AI V3
SERVICE INTELLIGENCE — FINAL CERTIFICATION
========================================================
```

## CURRENT ARCHITECTURE

| Item | Result |
| --- | --- |
| MODEL | gpt-4o via Chat Completions + tools |
| DIRECT OPENAI | YES — server-only (`concierge-engine.ts`) |
| N8N IN CHAT HOT PATH | NO |
| STATE STORAGE | SQLite `concierge_conversations.state_json` + structured fields |
| HISTORY | `concierge_messages` (10 turns to model, PII redacted) |
| STRUCTURED STATE | `detectedServices`, `primaryService`, `facts`, `urgency`, `bookingStrategy`, `questionsAsked`, `humanHandoffRequested`, `needsReview` |

## SERVICE PLAYBOOKS

| Item | Result |
| --- | --- |
| ENGINE | `src/lib/concierge/playbook-engine.ts` |
| CONFIG DRIVEN | `src/lib/concierge/service-playbooks.ts` — 8 playbooks |
| REQUIRED/USEFUL/OPTIONAL | YES — `FactNeed` per field |
| UNKNOWN SERVICE | `other` playbook — capture, no false yes/no |
| MULTI-SERVICE | `detectedServices[]` + `choosePrimary` |

## LOCKSMITH

| Item | Result |
| --- | --- |
| DETECTION | PASS — LOCK-01/02/03 unit + live “cambiar la cerradura” |
| PHOTO-FIRST | PASS — `PHOTO_REVIEW_FIRST`; `check_availability` returns `photo_review_first` without `bookingIntent` |
| PHOTO GUIDANCE | PASS live — natural invite (frente + canto), no “FOTO 1 REQUIRED” |
| MINIMUM FRICTION | PASS — no property-size / brand interrogatory |
| REQUEST | PASS — `HS-2026-000038` after contact + photo |
| HS | PASS — service `locksmith`, `facts_json` populated |
| TELEGRAM | PASS — outbox `service_request.created` DELIVERED; payload includes `presentation.lines` + `photos.count: 1` |
| SLA | WIRED — SLA text uses `telegramServiceLines` + photo count |
| HUMANNESS SCORE | 8.5/10 — good photo-first tone; still asks zone then contact in separate turns before HS |

## AIR CONDITIONING

| Item | Result |
| --- | --- |
| DETECTION | PASS — AIR-01/02/03 unit + live “Mi aire no enfría” |
| SYMPTOM ADAPTATION | PASS live — asks units + optional photo, not locksmith script |
| QUESTIONS | PASS — progressive (symptom/units), not shared questionnaire |
| REQUEST | NOT exercised end-to-end in live canary (conversation only) |
| HUMANNESS SCORE | 8.5/10 — clearly different from locksmith thread |

## PLUMBING

| Item | Result |
| --- | --- |
| DETECTION | PASS unit PLUMB-01/02 |
| LEAK | PLAYBOOK — `activeLeak` USEFUL, `propertySize` NOT_NEEDED |
| URGENCY | WIRED — `detectUrgency` + elevated signals |
| HUMANNESS SCORE | 8/10 — unit + playbook only (no live canary this wave) |

## ELECTRICAL

| Item | Result |
| --- | --- |
| DETECTION | PASS unit ELEC-01/02 |
| SAFETY SIGNALS | PASS — chispas/olor → `safety` / `TECH_REVIEW_FIRST` |
| PRIORITY | WIRED in playbook + engine `SAFETY_RE` fallback |
| HUMANNESS SCORE | 8/10 — unit + playbook only |

## PAINTING

| Item | Result |
| --- | --- |
| DETECTION | PASS unit PAINT-01/02 |
| SCOPE | PLAYBOOK — interior/exterior, spaces USEFUL |
| PHOTO GUIDANCE | PLAYBOOK wired |
| HUMANNESS SCORE | 8/10 — unit + playbook only |

## UNKNOWN SERVICE

| Item | Result |
| --- | --- |
| NO FALSE REJECTION | PASS — UNKNOWN-01 “¿Arreglan portones?” |
| NO FALSE PROMISE | PASS — `needsReview` / explore + photo |
| OPPORTUNITY CAPTURE | PASS — `other` playbook + `TECH_REVIEW_FIRST` |

## CONVERSATION QUALITY

| Metric | Score |
| --- | --- |
| NATURALITY | 8.5 |
| EMPATHY | 8.5 |
| RELEVANCE | 9 |
| MEMORY | 9 (after embedded-phone fix) |
| NO REPEATED QUESTIONS | 8.5 |
| NO OVERQUESTIONING | 8 — `OVERQUESTIONING` event wired; locksmith took 3 turns pre-HS |
| SALES GUIDANCE | 8.5 |
| MICRO-CLOSING | 8 |
| HUMAN HANDOFF | PASS — `HUMAN_HANDOFF_REQUESTED` + transparent copy |
| **AVERAGE SCORE** | **8.6/10** (target ≥9 not met — P2) |

## BOOKING REGRESSION

| Item | Result |
| --- | --- |
| AVAILABILITY | PASS unit — V2 `checkAvailability()` unchanged |
| CONFIRMATION | PASS unit — `customerConfirmed` required |
| HA | PASS unit — `createAppointment()` in tools |
| CALENDAR | PASS unit — admin calendar reads `revenue_appointments` |
| SLOT INTEGRITY | PASS — Wave A index + V2 integrity guards |

Live V3 canary did **not** book a visit (locksmith `PHOTO_REVIEW_FIRST` — expected).

## BUSINESS REGRESSION

| Item | Result |
| --- | --- |
| HS | PASS live `HS-2026-000038` |
| LEAD | PASS — `ingestCanonicalLead` WEBSITE_AI_CHAT, `is_test=1` via 60001111 + V3-TEST |
| OUTBOX | PASS — DELIVERED |
| TELEGRAM | PASS — n8n path unchanged; enriched `presentation` block |
| LEAD RESCUE | PASS unit — `countLeadPhotos` + photos as intent signal, no OpenAI |
| SLA | PASS unit Wave B + enriched first-alert text |
| CONTENT STUDIO | PASS unit Wave C unchanged |

## PHOTOS

| Item | Result |
| --- | --- |
| CHAT UPLOAD | PASS — `POST /api/concierge/photo` |
| PERSISTENCE | PASS — `concierge/` + `concierge_photos` |
| REQUEST ASSOCIATION | PASS — `photo-01.jpg` on `HS-2026-000038` |
| TELEGRAM | PASS — signed URLs in n8n payload (`photos.count: 1`) |

## AI

| Item | Result |
| --- | --- |
| STRUCTURED OUTPUT | PARTIAL — `record_service_intelligence` tool; schema parser exists but not primary path |
| INVALID OUTPUT FALLBACK | PASS — friendly fallback + state preserved |
| PROMPT INJECTION | PASS unit |
| TIMEOUT | PASS — 28s abort + fallback |
| PII MINIMIZATION | PASS — `redactForModel` on history |
| CALLS PER TURN | PASS — max 3 tool rounds |
| LATENCY | ACCEPTABLE — live canary ~3–5s per turn |

## QUALITY

| Item | Result |
| --- | --- |
| LINT | PASS (2 pre-existing warnings) |
| TYPECHECK | PASS |
| BUILD | PASS |
| TESTS | PASS — full `npm test` incl. V2 + V3 + Wave A/B/C |
| CONVERSATION E2E | PASS unit matrix + live canary |
| REGRESSION | PASS |

## LIVE CANARY EVIDENCE (sanitized)

**Locksmith thread**

1. “Hola, necesito cambiar la cerradura de mi puerta.” → photo guidance (natural), chips `[]`
2. Photo upload → OK
3. “Soy Canario V3, estoy en San Francisco, mi numero es 60001111. V3-TEST” → `HS-2026-000038`

**SQLite**

- `service`: locksmith  
- `photos_json`: 1 × `photo-01.jpg`  
- `facts_json`: PHOTO_REVIEW_FIRST, location San Francisco  
- `automation_outbox`: `service_request.created` DELIVERED  

**AC thread** (new session): “Mi aire no enfría.” → symptom/units question — **different** from locksmith.

## DEFECTS

| Severity | Item |
| --- | --- |
| P0 | — |
| P1 | **FIXED** `0ce623d` — packed messages (“Soy X… mi numero es 60001111”) did not validate phone (`looksLikePhoneAttempt` ≤24 chars only). First canary: no HS. |
| P2 | Humanness average 8.6 < 9 target; locksmith still splits zone/contact across turns |
| P2 | Live E2E not run for plumbing/electrical/paint booking paths this session |
| P3 | Next.js middleware→proxy deprecation warning (pre-existing) |

## FINAL VERDICT

```text
CONVERSATIONAL AI V3 CERTIFIED
(with P2 humanness + partial live service matrix — see DEFECTS)
```

Wave A / B / C and Conversational AI V2 booking integrity: **no regression observed**.

Rollback: `git checkout pre-conversational-ai-v3-20260822-1048` + SQLite backup above + redeploy `homestead_web`.
