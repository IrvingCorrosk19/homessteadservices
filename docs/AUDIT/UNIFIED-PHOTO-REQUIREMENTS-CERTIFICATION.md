# HOMESTEAD UNIFIED PHOTO REQUIREMENTS CERTIFICATION

Date: 2026-08-25

## Pre-change audit (summary)

| Channel | Before |
| --- | --- |
| Public form | Photos optional for **all** services; no Vision; no locksmith subtype |
| Chatbot | Hard gate only for digital-lock purchase via `digital-lock-vision.ts` |
| Backend `/api/contact` | No required-photo gate |
| Decision makers | Chat: vision module + playbooks soft; Form: none |

## After change

| Check | Result |
| --- | --- |
| **CENTRAL_POLICY** | PASS — `src/lib/service-requirements.ts` → `getServiceRequirements()` |
| **FORM_USES_POLICY** | PASS — RequestForm + `/api/contact` |
| **CHATBOT_USES_POLICY** | PASS — `concierge-engine` resolves intent via same policy (+ lockout override) |

| Digital lock | Result |
| --- | --- |
| **DIGITAL_LOCK_INTENT** | PASS — `digital_lock_purchase_install` / compatibility |
| **FRONT_REQUIRED** | PASS |
| **INTERIOR_REQUIRED** | PASS |
| **EDGE_REQUIRED** | PASS |
| **VISION_VALIDATION** | PASS — `analyzeDigitalLockPhotoFromBytes` + `applyVisionToChecklist` |
| **COUNT_BASED_COMPLETION_REMOVED** | PASS — completion = 3× PASS evidence, not file count |

| Gates | Result |
| --- | --- |
| **FORM_HARD_GATE** | PASS — FE blocks empty slots; BE Vision gate |
| **BACKEND_HARD_GATE** | PASS — `422 DIGITAL_LOCK_PHOTO_REQUIREMENTS_INCOMPLETE` |
| **CHAT_HARD_GATE** | PASS — existing checklist + `enforceDigitalLockReplyTruth` |

| Evidence quality | Result |
| --- | --- |
| **INVALID_IMAGES** | PASS — Vision reject → no progress (shared applyVisionToChecklist) |
| **WRONG_SLOT** | PASS — slot is hint only; Vision `imageType` assigns |
| **DUPLICATE_IMAGES** | PASS — sha / duplicateSuspected gate |

| Intents | Result |
| --- | --- |
| **LOCKOUT_EXCEPTION** | PASS — lockout wins; digital checklist cleared; no 3-photo block |
| **OTHER_LOCKSMITH_INTENTS** | PASS — repair / key copy / other = photos not blocking |

| Ops | Result |
| --- | --- |
| **ADMIN** | PASS — checklist in `facts_json` → existing `buildAdminPhotoEvidenceMap` |
| **TELEGRAM** | PASS — existing `telegramServiceLines` / digital lock evidence lines |
| **CUSTOMER360** | PASS — per-request facts; no historical auto-satisfy |

| UX | Result |
| --- | --- |
| **DESKTOP** | PASS — 3 slots + intent radios |
| **MOBILE** | PASS — Cámara (`capture=environment`) + Galería |

| Build / tests | Result |
| --- | --- |
| **BUILD** | `tsc --noEmit` clean |
| **TESTS** | `scripts/test-unified-photo-requirements.mjs` + digital-lock vision suite |
| **P0** | 0 |
| **P1** | 0 — progressive per-slot Vision API deferred; submit-time Vision is the hard gate |

## Principle

> No queremos “3 archivos obligatorios”.  
> Queremos **3 evidencias visuales obligatorias y válidas**.  
> Formulario y chatbot obedecen la **misma** política.

## FINAL VERDICT

**UNIFIED PHOTO REQUIREMENTS CERTIFIED**
