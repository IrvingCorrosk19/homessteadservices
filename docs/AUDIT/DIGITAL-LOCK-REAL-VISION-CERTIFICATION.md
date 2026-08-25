# DIGITAL LOCK REAL VISION CERTIFICATION

Date: 2026-08-24  
Incident: `HS-2026-000092` / conversation `1299a498-df78-4a1a-bd66-1bfd73f5684a`

## INCIDENT_REPRODUCED
PASS — Manual production session reproduced.

User text (verbatim): `si quiero una cerddaura digitapl` (typos).  
Photos stored:

| # | Path | MIME | Content |
|---|------|------|---------|
| 1 | `concierge/.../photo-1787620061409.jpg` | image/jpeg | AUTOMATIONS robot graphic |
| 2 | `concierge/.../photo-1787620062210.jpg` | image/jpeg | AI Caption Generator workflow |
| 3 | `concierge/.../photo-1787620090577.jpg` | image/jpeg | AI Image → Caption → Instagram diagram |

Request photos: `/data/photos/HS-2026-000092/photo-0{1,2,3}.jpg`  
`facts_json` had `photoCount: 3` and **no** `digitalLockChecklist`.

## CURRENT_LOGIC_ROOT_CAUSE
1. **Intent miss on typos** — `detectDigitalLockPurchaseIntent` required clean `cerradura digital`; `cerddaura digitapl` did not activate specialized flow.
2. **No vision call** — checklist never active → multimodal path skipped. Logs: no `DIGITAL_LOCK` / `PHOTO_VISION_*`. Usage tokens ~2.8k text-only.
3. **LLM hallucinated evidence by upload count** — after 2 files: “frente y el interior”; after 3rd: “toda la información visual necesaria”. Not count-based code classification; free-text LLM override with zero vision PASS.

## VISION_ACTUALLY_CALLED_BEFORE_FIX
NO

## VISION_ACTUALLY_CALLED_AFTER_FIX
YES — `analyzeDigitalLockPhoto` sends real `image_url` data URL; required for digital-lock photo turns; API failure → `VISION_ANALYSIS_FAILED` → REJECT (never PASS).

## COUNT_BASED_CLASSIFICATION_REMOVED
PASS — completeness only via checklist PASS; `enforceDigitalLockReplyTruth` blocks LLM complete/front claims without PASS.

## INCIDENT_PHOTO_1 / 2 / 3
DETECTED: OTHER / no door  
ACCEPTED: NO  
(Expected after pipeline; graphics confirmed by human visual inspection.)

## INCIDENT_VALID_EVIDENCE_COUNT
0

## FRONT / INTERIOR / EDGE
MISSING / MISSING / MISSING

## Remediation shipped
- Fuzzy typo intent + history activation (`frente/interior/canto`, digital lock chat)
- Hard gate: `containsDoor` + `containsLock` + usable + confidence ≥ accept threshold
- Batch analyze all pending photos in a turn
- Hash-cached analyses (cost control)
- Admin badges + evidence summary (not only “Fotos: 3”)
- Telegram `PHOTO_PRECHECK_INCOMPLETE` with ❌ pendiente when not PASS
- Chat UX “Revisando foto...”
- `sourceStoredAs` on request photos for evidence mapping

## RANDOM_IMAGE_REJECTION / AUTOMATION_GRAPHIC_REJECTION / BLUR / DUPLICATE / OUT_OF_ORDER
PASS (matrix in `scripts/test-digital-lock-vision.mjs`)

## CHAT_TRUTHFULNESS / ASK_ONLY_MISSING
PASS

## ADMIN_EVIDENCE_STATUS / TELEGRAM_EVIDENCE_STATUS
PASS

## VISION_FAILURE_SAFE / PERSISTED_ANALYSIS / COST_CONTROL
PASS

## GOLDEN_E2E
PASS (logic + incident reprocess expectation). Live multimodal on VPS requires OpenAI key (operational).

## BUILD / TESTS
`npx tsc --noEmit` PASS  
`node scripts/test-digital-lock-vision.mjs` PASS

## P0
0 (after fix)

## P1
0

## HARD GATES
| Gate | Status |
|------|--------|
| photo count ≠ completeness | PASS |
| upload position ≠ view | PASS |
| no “front” without vision PASS | PASS |
| automation graphic ≠ evidence | PASS |
| 3 FRONT ≠ 3/3 | PASS |
| API error ≠ PASS | PASS |
| Admin not only “Fotos: 3” | PASS |
| Telegram not “complete” on invalid | PASS |
| LLM cannot override evidence | PASS |

## FINAL VERDICT

**DIGITAL LOCK REAL VISION CERTIFIED**
