# HOMESTEAD — Zombie Context / Stale Photo Response P0 Certification

**Date:** 2026-08-30  
**Scope:** Text-only air-conditioning request must never receive a digital-lock photo-validation reply.  
**Reported message:**

```
Hola, necesito mantenimiento de 2 aires acondicionados
mañana a las 2:00 p. m.
Estoy en Edison Park, PH El Mare, apartamento 3A.
Mi nombre es Irving Corro y mi teléfono es 65656565.
```

**Observed incorrect reply (pre-fix):**

> Parece que esta imagen no muestra la puerta o la cerradura que necesitamos revisar. Envíame una foto de frente de la puerta donde se vea completa la cerradura o el área donde quieres instalarla.

---

## ROOT_CAUSE

**PRIMARY (evidence, not assumed):**  
`detectConversationTransition` classified an explicit AC packed request as `CONTINUE_CURRENT_SERVICE` because a switch required abandon/switch phrases, and `\baire\b` does not match **aires**. The current message was then ignored as authority.

**PHOTO PATH:**  
`concierge-engine.ts` scanned **conversation history** for unanalyzed lock photos on every turn, including text-only turns. `analyzeDigitalLockPhoto` + `visionFailedResult` produced `digitalLockHumanReply`, which is the exact customer-visible sentence. That reply **early-returned** before AC intent, fact merge, calendar, or HS creation.

**HISTORY REACTIVATION:**  
`historySuggestsDigitalLockFlow` kept the lock checklist active after the AC message. `responseReferencesStaleService` ran only on later LLM replies, **not** on `digitalLockReply`.

**SESSION:**  
Cookie `hs_cid` (7 days) hydrates the same conversation. Close and minimize both preserve it. There was no real “Nueva solicitud”. A tester could see the default greeting before GET hydration and send into the old lock conversation.

## FRONTEND_OR_BACKEND

**Both.** Backend executed lock vision from historical photos and refused to SWITCH on an explicit new service. Frontend reused the cookie conversation and allowed send before hydrate.

## ASYNC_RACE

**YES, guarded.** Vision is awaited in-turn today, but historical pickup was equivalent to applying an old photo job to a newer text turn. After the fix, a vision job carries `conversationId` / `photoId` / `serviceContextId` / `stateVersion`. Mismatch → `STALE_VISION_RESULT_DISCARDED`. No state write. No customer reply.

## SESSION_LEAK

**YES, mitigated.** Close ≠ new conversation. `NEW_CONVERSATION` now allocates a new `conversationId` and cookie. Composer waits for GET hydrate (`sessionReady`). POST may send the hydrated `conversationId`.

## STATE_MERGE_DEFECT

**YES, fixed.** Facts used to be extracted **then** SWITCH wiped `preferredDate` / `preferredTime` / `units`. Order is now: detect transition → apply (invalidate stale service state) → extract current message onto the clean context.

---

## FAILING_MESSAGE_REPRODUCED

**YES** (pre-fix script `scripts/repro-zombie-context.ts`).

| Field | Before AC message | After (pre-fix) |
|---|---|---|
| OLD_SERVICE | locksmith / DIGITAL_LOCK | locksmith (continued) |
| NEW_SERVICE | — | `ac` detected, **not applied** |
| TRANSITION | — | `CONTINUE_CURRENT_SERVICE` |
| OLD_SERVICE_CONTEXT_ID | `locksmith-1` | unchanged |
| NEW_SERVICE_CONTEXT_ID | — | not created |
| ATTACHMENT_COUNT | n/a | **0** |
| PHOTO_VALIDATION_CALLED | pending edge photo | **yes** (historical unanalyzed photo) |

Post-fix: `SWITCH_SERVICE` locksmith → ac; `attachmentCount = 0`; `runVision = false`.

---

## STALE_PENDING_INVALIDATION

**PASS.** Unrelated explicit service in the current message is `SWITCH_SERVICE` (phrase not required). Pending lock actions require matching `pendingActionService` + `serviceContextId`. Incompatible → `PENDING_ACTION_INVALIDATED`.

## VISION_RESULT_GUARD

**PASS.** `NO CURRENT IMAGE = NO PHOTO VALIDATION RESPONSE` via `resolveDigitalLockTurnPolicy`. Photo PUT still analyzes **trailing user photos since last assistant**, not the whole history.

## RESPONSE_GUARD

**PASS.** Lock-photo replies are blocked unless current service is locksmith, lock is active, not abandoned, and this turn has an image. Also `STALE_RESPONSE_BLOCKED` / `STALE_ASSISTANT_RESPONSE_BLOCKED` on generated text.

## SESSION_ISOLATION

| Action | Semantics |
|---|---|
| Minimize | Same conversation (UI hidden, cookie kept) |
| Close window | Same conversation (cookie kept; GET hydrates) |
| Nueva solicitud | New `conversationId`, empty service/pending/slots/photos |

---

## CERTIFICATION MATRIX

| Gate | Result | Evidence |
|---|---|---|
| EXACT_AC_TEST | PASS | `scripts/zombie-context-behavior.ts` exact string |
| SAME_CONVERSATION_SWITCH | PASS | “Ahora necesito mantenimiento de aire…” → SWITCH |
| NEW_CONVERSATION_ISOLATION | PASS | empty state; `NEW_CONVERSATION` API + UI |
| LATE_VISION_RESULT | PASS | `isStaleVisionResult` unit + engine discard log |
| ZERO_ATTACHMENT | PASS | `attachmentCount = 0`, `runVision = false` |
| MULTI-FACT EXTRACTION | PASS | name, phone, Edison Park, El Mare, 3A, qty 2, 14:00 |
| LOCK REQUIREMENTS ON AC | PASS | lock inactive; pending lock invalid |
| LOCK → PAINT / AC → PLUMBING / PAINT → AC / PLUMBING → LOCK | PASS | transition tests (not lock/AC-only ifs) |
| ADD still ADD | PASS | “también necesito pintar” |
| REFRESH | CODE-LEVEL | GET hydrates cookie conversation after SWITCH (AC). Browser refresh not executed. |
| MULTI_TAB | PARTIAL | Client sends `conversationId`. Cookie is still shared across tabs. No JS singleton mix. Live two-tab not executed. |
| TELEGRAM | CODE-LEVEL PASS | After SWITCH, `telegramServiceLines` is AC, not “CERRADURA DIGITAL”. Live Telegram send not executed. |
| EXACT SLOT 14:00 | EXTRACTION PASS | `parseNaturalDateTime` → 14:00; engine already prefers `hasRequestedExactWhen`. Live calendar book not executed. |
| BUILD | PASS | `npx tsc --noEmit` |
| TESTS | PASS | `test-zombie-context.mjs`, `test-context-switch.mjs`, `test-conversation-session-isolation.mjs`, `test-digital-lock-vision.mjs` |

---

## OBSERVABILITY

Structured events (no message body / PII):

`USER_MESSAGE_RECEIVED` · `INTENT_DETECTED` · `SERVICE_CONTEXT_SWITCHED` · `PENDING_ACTION_INVALIDATED` · `PHOTO_ANALYSIS_STARTED` · `PHOTO_ANALYSIS_COMPLETED` · `STALE_VISION_RESULT_DISCARDED` · `STALE_RESPONSE_BLOCKED` · `CONVERSATION_CREATED` · `CONVERSATION_ENDED` · `CONVERSATION_HYDRATED`

---

## P0

**0** for the reported zombie: a text-only AC message cannot emit the lock-photo validation reply.

## P1

**0 found in this audit of the zombie path.** Not claimed: live booking confirmation, live Telegram delivery, live multi-tab cookie fights, live browser refresh.

Gypsum is an alias of `repairs`, not a distinct `serviceId`. Painting → gypsum is therefore not a separate playbook switch; painting → AC / plumbing / locksmith is.

---

## FINAL VERDICT

**ZOMBIE CONTEXT ELIMINATED / CERTIFIED** for the customer-visible defect:

> A customer asking for air conditioning must never receive a zombie lock-photo response.

The current user message outranks old pending lock actions. No current image means no image-validation response. Async vision from a superseded service context is discarded. Nueva solicitud creates an isolated conversation.
