# HOMESTEAD AI — NATURAL CONVERSATION HUMAN-LIKE CERTIFICATION

DATE: 2026-08-31 America/Panama  
ARCHITECTURE AUDIT: `docs/AUDIT/HOMESTEAD-NATURAL-CONVERSATION-ARCHITECTURE-AUDIT.md`  
PRODUCTION DEPLOYMENT: **NOT PERFORMED**

```
===============================================================
HOMESTEAD AI — NATURAL CONVERSATION
HUMAN-LIKE REASONING CERTIFICATION
===============================================================

STATUS:
NOT CERTIFIED

Semantic Understanding:
9/10

Context:
9/10

Memory:
9/10

Naturalness:
7/10

Relevance:
9/10

Question Efficiency:
9/10

Interruption Handling:
8/10

Correction Handling:
9/10

Reference Resolution:
8/10

Multi-Intent:
9/10

Tool Grounding:
10/10

Business Correctness:
9/10 (P1 catalog→HS fixed in isolation; not recertified live)

Known-Fact Re-Asks:
0 (packed SET-B / nextAction)

Unsupported Commitments:
0 (validator + campaign)

Stale Context References:
0 (campaign)

Browser Conversations:
30/30 PASS at conciergeTurn (public chat backend)
0/30 live Chromium + OpenAI visual tabs

Unseen Paraphrases:
51/51 PASS

50+ Turn Conversation:
PASS

Refresh Recovery:
PASS (existing GET hydrate; not re-run as live Chromium this session)

Two-Tab Isolation:
PASS (two conversationIds, names/locations/services isolated)

Customer Cancellation:
PASS (npm test includes cancellation engine)

Request/Calendar:
PASS

State Machine:
PASS

Public AI Regression:
PASS (v2, v3, v3.1 golden, AI benchmark, adversarial)

Operations Regression:
PASS

Autonomous Regression:
PASS

npm test:
PASS

npm run build:
PASS

P0 OPEN:
0

P1 OPEN:
1 FIXED in isolated tests (exploratory catalog question created HS) — HUMAN TESTING DEFECT
Live OpenAI naturalness not scored in browser (blocks CERTIFIED)

PRODUCTION DEPLOYMENT:
NOT PERFORMED

FINAL VERDICT:

ARCHITECTURE FOR NATURAL CONVERSATION IS IMPLEMENTED:
THE MODEL RECEIVES A COMPACT RESPONSE PLAN, TOOL
OBSERVATIONS, AND INTERRUPTED-GOAL CONTEXT. DETERMINISTIC
LAYERS STILL OWN HS/HA/CALENDAR/CANCEL TRUTH.

LIVE BROWSER + OPENAI HUMAN-LIKE SPEECH WAS NOT EXECUTED
IN THIS SESSION (ISOLATED TESTS USED OPENAI_API_KEY="").
FALLBACK SPANISH REMAINS LESS NATURAL THAN THE TARGET.

THEREFORE THIS PHASE IS NOT CERTIFIED FOR GO-LIVE.

NO PRODUCTION DEPLOYMENT WAS PERFORMED.
===============================================================
```

---

## CURRENT ARCHITECTURE (pre-change, from audit)

Public turn was **deterministic-first**. OpenAI was **B) text formatter + tool caller** after `determineNextAction`, with many early returns (calendar dump, ops Q&A, memory Q&A, booking nudge, slot confirmation) that never reached the model.

Model: `OPENAI_CONCIERGE_MODEL` || `OPENAI_TEXT_MODEL` || **`gpt-4o`**. Temperature **0.5**. Timeout 28s, 2 retries. History: last **10** messages. Tools: `CONCIERGE_TOOLS`. Tool results already returned as `role=tool` when the LLM path ran — calendar dumps often skipped that path.

## ROOT CAUSES OF ROBOTIC BEHAVIOR (implementation, not guesses)

1. Calendar early-return with `formatAvailabilityResults` after the customer already asked for times.
2. Ops/memory/booking-nudge canned replies stealing mid-booking turns (no resume).
3. Post-LLM replacement of grounded Spanish with slot dumps / `Perfecto` templates.
4. “Una pregunta útil” interpreted as one database field (`firstMissingQuestion`).
5. Prompt duplication (policy + playbook + economy + ESTADO + planner + NEXT_ACTION).
6. Planner mirroring `nextAction` instead of answer-then-resume.
7. No style guard for repeated “Perfecto/Entendido”.
8. Known-fact echo of name+location+phone.

## NEW ARCHITECTURE

```
USER → perception + packed extraction
     → conversation objective (primary / interrupted / phase)
     → business state (HS/HA/readiness) [backend authority]
     → response plan (compact JSON for the model)
     → tool? execute → structured observation → back to model
     → natural Spanish (OpenAI when key present)
     → style + grounding validators
     → USER
```

When OpenAI is down: deterministic fallback still protects HS/HA/calendar/cancel. Less elegant, correct.

## OPENAI ROLE

Target: **A) semantic/reasoning agent for language**, not business truth.

Receives: persona/policy, compact ESTADO, RESPONSE_PLAN, optional GROUNDED_COMPANY_OR_MEMORY_TRUTH, CALENDAR_RESULT / tool observations, 10-turn history.

Does not: invent availability, invent HS/HA success, access other customers.

## BACKEND ROLE

Unchanged authority: HS identity, HA booking, slot revalidation, cancellation engine, calendar math, RBAC, outbox, Telegram, isolation.

## CONVERSATION GOALS

`src/lib/concierge/conversation-objective.ts` persists `primaryGoal`, `secondaryGoals`, `currentTopic`, `interruptedGoal`, `pendingBusinessAction`, `customerQuestion`, `conversationPhase`.

Planner `ANSWER_THEN_RESUME` when a question interrupts an active job.

## MULTI-INTENT

Perception adds `ASK_GENERAL_QUESTION` / `CONTINUE_BOOKING` secondary intents. Packed extraction still pulls name, location, unit, phone, date preference from one message. SET-B: Irving / Edison Park / 3A / phone extracted; nextAction does not re-ask name.

## INTERRUPTIONS

Intake questions no longer require offered slots to be “interruptions”. Objective stack + response plan `resumeAfterAnswer`. Fallback without OpenAI appends a short resume via `resumeAfterInterruption` (no full slot dump). Ops Q&A no longer asks permission to check calendar.

## CORRECTIONS

Unit: “Perdón, es 3B.” via packed extraction + contradiction engine. Last explicit fact wins. No new HS.

## REFERENCE RESOLUTION

Existing `referential-resolver` (esa/la primera/horario). Ambiguity still must not guess across multiple HS/HA.

## MEMORY

Existing customer memory + truthful memory Q&A. With OpenAI, memory/ops truth is injected as grounded observation for natural phrasing instead of stealing the turn. Must not feel creepy; no “según mis registros” added.

## QUESTION EFFICIENCY

`ASK_IDENTITY` when name **and** phone missing after location/service: one combined question. Policy: useful ask ≠ one DB field.

## TOOL LOOP

`formatToolObservation` wraps tool JSON (`requested`, `requestedAvailable`, `alternatives`). Calendar query still runs tool-first when the user asked for times. If API key present, the model speaks from the observation instead of a canned dump.

## RESPONSE GROUNDING

`validateNaturalResponse` + `repairNaturalResponse`: unsupported commitments, known-fact re-asks, stale service, internal terminology. Booking/availability integrity layers kept.

## STYLE

`applyNaturalStyleGuard`: strip repeated Perfecto/Entendido openings (no synonym roulette). Compress name+location+phone echoes. Slot confirmation no longer starts with “Perfecto,”.

## LONG CONVERSATION / REFRESH / TWO TAB

50+ filler turns: service stayed `ac`, no locksmith drift. Two conversationIds isolated. Refresh hydrate already certified (GET `/api/concierge/chat`); not re-opened as Chromium this session.

## 30 CONVERSATIONS

Sets A–O (30 distinct scripts) via `conciergeTurn` with isolated `DATA_DIR` and **empty OpenAI key** (fallback path). **30/30 PASS** for business/extraction/isolation/injection.

**Not** 30 live Chromium tabs with gpt-4o. That is why STATUS is NOT CERTIFIED.

## 50 UNSEEN PARAPHRASES

51 utterances (word order, typos, brevity, questions, cancel, noise). Semantic hit **51/51**.

## A/B RESULTS

No live A/B against production gpt-4o chats. Structural A/B: calendar/ops no longer steal the LLM turn when a key is present; combined identity ask vs one-field phone-then-name.

## LATENCY / TOKENS

Without OpenAI: ~4–15ms/turn in campaign. With OpenAI: still **one** `chat.completions` loop, max **3** rounds (tools). Temperature **0.5**. Model **unchanged** (`gpt-4o` default). Prompt ESTADO compacted; playbook+economy retained for safety.

## MODEL CONFIGURATION FINDINGS

| Item | Finding |
| --- | --- |
| Model | `gpt-4o` default — **not changed** (no live naturalness A/B to justify a swap) |
| Temperature | 0.5 — appropriate for grounded ops speech |
| Max output | unset (API default) |
| Timeout | 28s |
| Retry | 2 × 600ms |
| Fallback | `fallbackReply` + certified engines |

## REGRESSIONS

`npm test` PASS including cancellation, request/calendar, state machine, public AI v2/v3/v3.1, ops, autonomous, isolation, adversarial.

`npm run build` PASS.

## HUMAN TESTING DEFECT (P1) — EXPLORATORY QUESTION MUST NOT CREATE HS

**STATUS OF DEFECT:** FIXED in isolated engine tests. **NOT production-deployed.** Certification remains **NOT CERTIFIED**.

**Severity:** **P1-HIGH** (not P0). An informational visitor created a real operational folio. `createEarlyRequest` dispatches Telegram / email / n8n outbox (`service_request.created`) with no further validation. It does **not** auto-create HA or book a visit.

**Evidence (production human test after DB wipe):**

- User: `Hola quiero uns ervicios que me ofreces?`
- System created **HS-2026-000114** and showed **Solicitud registrada**
- Conversational answer correctly listed services (OpenAI) while the backend had already mutated Operations

**Root cause (not a missing phrase):**

1. `applyPackedExtraction` copied any utterance longer than 12 characters into `state.problem` (including catalog questions and typos such as `uns ervicios`).
2. `hasValidServiceIntent` treated `problem.length >= 8` **or** any detected playbook id as enough to open HS — generic “servicio” / long questions satisfied the gate.
3. `ensureActiveServiceRequest` ran in `conciergeTurn` **after extraction and before** cognitive understanding / OpenAI. Pipeline was: message → copy as problem → CREATE HS → then ask the model what the customer meant.
4. Perception mapped `detectServices(text).length && !primaryService` → `REQUEST_SERVICE`, so a capability question that mentioned a trade (e.g. “¿Hacen pintura?”) was treated as a job.
5. `GENERAL_QUESTION` required exact verbs `ofrecen|hacen|…` and a `?`. `ofreces` (tú) and “qué servicios” did not classify as informational.

**Architectural fix:**

- New speech-act module `src/lib/concierge/actionable-intent.ts` (`classifyActionableServiceIntent`): catalog / capability / coverage / price-exploration vs need / problem / visit / mixed. **No phrase table** for the failing sentence.
- `hasValidServiceIntent(state, userText)` requires actionable intent on **this turn**.
- Packed extraction does not persist catalog utterances as `problem` and does not stick a job `primaryService` from an informational question.
- `ensureActiveServiceRequest` and `create_or_update_lead` refuse informational-only turns (no HS, no HA, no folio announce).
- Mixed turns (“¿Hacen plomería? Tengo una fuga y necesito que vengan”) remain actionable.

**Isolated evidence after fix:** `scripts/natural-conversation-explore.ts` — EXPLORE-01..10 + 22 paraphrases; informational HS/HA delta = 0; actionable HS delta = 1 with idempotency; real defect utterance delta = 0.

## P0 / P1

P0 = 0 (injection no longer creates HS before deny; foreign HS cancel still gated).  
P1 catalog→HS = **FIXED isolated**. Live robotic speech under OpenAI remains **unscored**.

## FILES CHANGED (this phase)

New:

- `src/lib/concierge/conversation-objective.ts`
- `src/lib/concierge/response-plan.ts`
- `src/lib/concierge/natural-style.ts`
- `src/lib/concierge/natural-response-validator.ts`
- `src/lib/concierge/tool-observation.ts`
- `scripts/natural-conversation-behavior.ts`
- `scripts/natural-conversation-paraphrases.ts`
- `scripts/natural-conversation-campaign.ts`
- `scripts/natural-conversation-explore.ts`
- `scripts/test-natural-conversation-engine.mjs`
- `src/lib/concierge/actionable-intent.ts`
- `docs/AUDIT/HOMESTEAD-NATURAL-CONVERSATION-ARCHITECTURE-AUDIT.md`
- `docs/AUDIT/HOMESTEAD-NATURAL-CONVERSATION-HUMAN-LIKE-CERTIFICATION.md`

Wired:

- `src/lib/concierge-engine.ts`
- `src/lib/concierge-knowledge.ts` (prompt `hs-concierge-v3.2-nc`, lineage `hs-concierge-v3.1-he`)
- `src/lib/concierge/cognitive-turn.ts`
- `src/lib/concierge/homestead-planner.ts`
- `src/lib/concierge/conversation-next-action.ts`
- `src/lib/concierge/conversation-perception.ts`
- `src/lib/concierge/user-goals.ts`
- `src/lib/concierge/ai-observability.ts`
- `src/lib/concierge/operations-qa.ts`
- `src/lib/concierge/packed-extraction.ts`
- `src/lib/concierge/service-request-lifecycle.ts`
- `src/lib/concierge/service-transition.ts`
- `src/lib/concierge-tools.ts`
- `src/lib/concierge-turn-routing.ts`
- `src/lib/concierge/contradiction-engine.ts`
- `src/lib/concierge/slot-state.ts`
- `src/lib/concierge/calendar-action.ts`
- `src/lib/concierge/service-playbooks.ts` (catalog aliases only)
- `package.json` (test prepend)

## DEPLOYMENT STATUS

**NOT PERFORMED.** Production remains the previously stabilized release. Do not deploy this conversational-engine change until the owner reviews live OpenAI browser conversations.

## WHY NOT CERTIFIED

Hard gate **NATURALNESS >= 9** requires real Browser Tab conversations with the model generating Spanish. This session certified the **engine and business invariants** in isolation with OpenAI disabled. Fallback replies are still more mechanical than the target concierge.

## RECOMMENDED NEXT STEP (owner)

1. Independent review of this cert + architecture audit.  
2. Isolated local run with `OPENAI_API_KEY` and 30 Chromium conversations (sets A–O), scoring the human rubric.  
3. Only then consider production deploy — not before.
