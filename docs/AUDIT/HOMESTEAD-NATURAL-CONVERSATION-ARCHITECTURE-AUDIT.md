# HOMESTEAD AI — NATURAL CONVERSATION ARCHITECTURE AUDIT

DATE: 2026-08-31 America/Panama  
SCOPE: Public Customer AI (`conciergeTurn`) — complete turn trace  
STATUS: AUDIT COMPLETE (pre-implementation findings preserved)

This audit was produced by tracing production code, not by guessing.

---

## 1. COMPLETE PUBLIC AI TURN

```
USER
  ↓
POST /api/concierge/chat  (cookie hs_cid → conversationId)
  ↓
conciergeTurn()
  ↓
conversation state  (SQLite concierge_conversations.state_json)
  ↓
RESET intercept  → canned reply, return
  ↓
CANCELLATION intercept  → central cancel engine, grounded reply, return
  ↓
detectConversationTransition + applyConversationTransition
  ↓
packed extraction (applyPackedExtraction / extractCasualFacts)
  ↓
customer memory retrieve
  ↓
reprogram / digital-lock / slot-select intercepts  → often return
  ↓
calendar decideCalendarExecution + checkAvailability
     → often early-return formatAvailabilityResults
  ↓
prompt-injection / memory Q&A / ops Q&A / booking nudge
     → often early-return canned Spanish
  ↓
determineNextAction  (deterministic field order)
  ↓
runCognitiveTurn  (perceive → contradict → plan → summary)
  ↓
OpenAI chat.completions + tools  (IF OPENAI_API_KEY)
     tool loop ≤ 3 rounds, observations pushed as role=tool
  ↓
else fallbackReply()
  ↓
server-authoritative create_appointment if CONFIRM_OR_BOOK
  ↓
enforceDeterministicAsk
  ↓
detectRepeatedQuestion rewrite
  ↓
price / social / bookingPause / availability integrity rewrites
  ↓
validateResponseCompatibility + stale-service repair
  ↓
persist + session snapshot (requestCard, slotGroups)
  ↓
USER
```

**Verdict on OpenAI role (pre-change):** closer to **B) text formatter for deterministic `nextAction`** than **A) semantic/reasoning agent**.

Many customer turns never reach the model. When they do, the model is constrained to `askField` / `requiredMissing`, then post-processors frequently replace its Spanish with templates.

---

## 2. MODEL CONFIGURATION (actual)

| Item | Value |
| --- | --- |
| Function | `conciergeModel()` in `src/lib/concierge-flags.ts` |
| Current model | `OPENAI_CONCIERGE_MODEL` \|\| `OPENAI_TEXT_MODEL` \|\| **`gpt-4o`** |
| Fallback model | none beyond env override; on OpenAI failure → `fallbackReply()` |
| Endpoint | `https://api.openai.com/v1/chat/completions` |
| Temperature | **0.5** (hardcoded in `completeTurn`) |
| Max output | not set (API default) |
| Timeout | **28s** AbortController |
| Retry | **2 attempts**, 600ms delay |
| Tools | `CONCIERGE_TOOLS` from `src/lib/concierge-tools.ts` |
| Dry-run | `AI_CONCIERGE_DRY_RUN` default **true** (lead/HS persist dry, not LLM skip) |
| Prompt version (pre-change) | `hs-concierge-v3.1-he` |
| Build marker (pre-change) | `v3.1-he-live` |

No model change is justified until measured. Configuration is adequate for conversational reasoning if the model is actually allowed to reason.

---

## 3. WHAT OPENAI RECEIVES

### System / developer instructions

Stacked every turn via `conciergeSystemPrompt()` plus extra blocks:

1. PERSONA (Panamanian Spanish, not a form)
2. POLÍTICAS (extract all facts; **“Una pregunta útil por turno”**; no invented prices/slots)
3. CONOCIMIENTO DE NEGOCIO (`conciergeKnowledge()` — hours/coverage/catalog from `site`)
4. HERRAMIENTAS (record_service_intelligence, remember_customer_facts, check_availability, create_appointment, …)
5. Extra: `playbookPromptBlock` + `questionEconomyBlock` + digital-lock block
6. Optional INTERRUPCIÓN system message
7. Optional CALENDAR_RESULT system message
8. ESTADO ACTUAL JSON (name, phone status, location, building, unit, service, facts, slots, readiness, nextAction, requiredMissing)
9. `readinessPromptHint` + `plannerPromptBlock` + NEXT_ACTION_ENGINE line

**Prompt size problem:** the same constraints are repeated 4–6 times (policy, playbook, question economy, ESTADO, planner, NEXT_ACTION). Contradictory pressure: “sound human” vs “ask ONE missing database field”.

### Conversation history

`recentMessages(conversationId, 10)` — **10 prior messages** (user+assistant), redacted phones/emails via `redactForModel`.

Not a full transcript. Long conversations rely on `facts._conversationSummary` (compact), not a true 50-turn window.

### Customer memory

`retrieveCustomerMemory` / `applyRetrievedMemory` run before the LLM. Prior jobs can be acknowledged. Memory Q&A (`answerMemoryQuestion`) **early-returns** and never reaches OpenAI.

### Active service / business state / pending action / required fields

Passed as ESTADO ACTUAL JSON + `determineNextAction`:

- `nextAction` e.g. ASK_LOCATION, ASK_PHONE, CHECK_AVAILABILITY, CONFIRM_OR_BOOK
- `requiredMissing` from appointment readiness
- `askField` — one field from fixed order: service → location → property_type → building → unit → contact → slot → customer_name

### Tools

`CONCIERGE_TOOLS` includes intelligence, memory, availability, lead/HS, appointment create/reschedule, cancel, escalate, customer context.

`ToolLoopGuard` + `isToolAllowed` block writes without explicit intent.

### Does OpenAI see tool observations?

**Yes, when the LLM path runs.** After `executeConciergeTool`, the engine pushes:

```
role: "tool"
tool_call_id
name
content: JSON.stringify(executed.result)
```

Then another `completeTurn` round (max 3). The model can observe results before the final Spanish reply.

**But:** calendar is often queried **before** OpenAI, then the turn **returns** `formatAvailabilityResults` without a generation pass. Those observations never reach the model.

### Does OpenAI reason before response?

Internally: `runCognitiveTurn` builds a planner summary (`goal`, `missingCritical`, `toolPlan`, `responseStrategy`). That is **not** chain-of-thought; it is an operational digest that mostly **mirrors `nextAction`**.

The model is not asked to think→act→observe as the primary loop. Deterministic layers already decided the ask.

---

## 4. OPENAI ROLE: A vs B

| Signal | Evidence |
| --- | --- |
| Early returns skip LLM | RESET, cancel, slot pick, calendar dump, injection, memory Q, ops Q, booking nudge, commercial stop |
| `determineNextAction` owns WHAT to ask | comment in `conversation-next-action.ts`: “LLM drafts language; this layer owns WHAT to ask” |
| `enforceDeterministicAsk` rewrites invented location asks to canned questions | `firstMissingQuestion` |
| Post-LLM templates | `formatAvailabilityResults`, `priceGuidanceReply`, `socialAckReply`, `bookingPauseReply`, `paintingFollowUpQuestion`, `requestFolioBookingConfirm` |
| Planner | `responseStrategy` derived from `nextDecision.action` |

**Pre-change classification: B — text formatter + tool caller after a form-like next-action engine.**

Backend remains correctly authoritative for HS/HA/calendar/cancel. That split must stay. What must change is: **language and interruption handling should not be stolen from the model by templates.**

---

## 5. WHY IT FEELS LIKE A BOT — IMPLEMENTATION CAUSES

Do not guess: these are the code paths.

### 5.1 Turns that never reach OpenAI

| Cause | File | Effect |
| --- | --- | --- |
| Calendar dump after direct request / busy slot | `concierge-engine.ts` early return with `formatAvailabilityResults` / `availability.message` | Mechanical slot lists every scheduling turn |
| Ops Q&A | `operations-qa.ts` → early return | Mid-booking “¿trabajan los domingos?” never resumes booking |
| Price Q&A | same, plus “Si quieres, reviso disponibilidad” | Asks permission after the customer already asked |
| Memory Q&A | `memory-truth.ts` | Truthful but template cadence |
| Booking nudge | “Perfecto. ¿Qué día y hora…” | Perfecto + permission |
| Slot selection | `formatSlotSelectionConfirmation` | “Perfecto, {slot} queda seleccionado…” |
| RESET | hardcoded “Entendido, empezamos de cero…” | Robotic opener |

### 5.2 Template mosaic after the LLM

Even when OpenAI generates a reply:

- `looksLikeAvailabilityLoop` replaces it with `priceGuidanceReply` / `socialAckReply` (and **re-dumps all slots**).
- `enforceAvailabilityIntegrity` / `shouldBlockAvailabilityOfferLoop` often **replace** grounded LLM Spanish with `formatAvailabilityResults`.
- Incompatible-response fallback concatenates `transitionAck` + `paintingFollowUpQuestion` / generic “¿Qué más necesitas?”.
- `detectRepeatedQuestion` rewrite: “Perfecto. Con los datos que ya tengo confirmo la visita.”

### 5.3 One-field interrogation

`determineNextAction` walks a **fixed field order** and `firstMissingQuestion` emits one canned question. Policy + `questionEconomyBlock` say “Una pregunta útil por turno”, interpreted as **one database field**. Name and phone are almost never asked together.

Packed extraction **does** pull all facts from one message (`applyPackedExtraction`). Re-asks happen when the **ask engine** ignores that the LLM could combine remaining fields, or when early returns ask again.

### 5.4 Acknowledgements and data echo

Hardcoded openings: “Entendido”, “Perfecto”, “Gracias, ya tengo tu contacto y zona”. Fallback AC path restates contact+zona. No style guard on consecutive identical openings. No detector that a reply restated name+location+phone unnecessarily.

### 5.5 Interruptions not modeled as a stack

`interpretTurnRoute.isInterruption` is true only when **slots are already offered**. “Edison Park. Oye, ¿también hacen pintura?” during **intake** (no slots yet) is not an interruption. Ops Q&A then steals the turn. Planner has no `interruptedGoal` resume.

### 5.6 Prompt contradiction

Persona: “No suenes a formulario.”  
Policy: “Haz UNA pregunta útil por turno.”  
NEXT_ACTION: “Solo puedes solicitar campos en requiredMissing.”

The model is trained by the prompt to interview.

### 5.7 Planner is not a reasoning loop

`planHomesteadTurn` maps perception + nextAction → labels. It does not decide “answer painting, persist Edison Park, then ask name+phone together.”

### 5.8 UI cards

`buildSessionSnapshot` attaches `requestCard` whenever an HS id exists (`buildRequestCard`). Slot chips appear while offers are active. Cards for HS/HA are appropriate; repeating a status mosaic every turn is a product of snapshot always including `requestCard` once HS exists — acceptable if the widget only shows the compact folio card, not a giant status dump.

---

## 6. THREE TRUTHS (CURRENT vs TARGET)

| Truth | Current owner | Gap |
| --- | --- | --- |
| Conversational | packed extraction + perception regex mix | Multi-intent questions often lost to early returns |
| Business | SQLite HS/HA, cancellation engine | Correct — must not move to LLM |
| World/tool | `checkAvailability`, appointment tools | Results often never returned to the model for natural speech |

LLM must reason over all three and must not merge them (e.g. invent that 14:00 is free).

---

## 7. PRODUCTION KNOWLEDGE ALLOWED TO THE PUBLIC AI

Authoritative source: `conciergeKnowledge()` from `site` + dictionary.

| Topic | Published? |
| --- | --- |
| Services catalog | Yes (formServices + descriptions) |
| Hours | Only if `contact.hours.isConfigured` |
| Service area | Only if `contact.serviceArea.isConfigured` |
| Pricing | **Explicitly unpublished** (`pricingPublished: false`) |
| WhatsApp | Flagged; public WhatsApp removed from UX |
| Process steps | Dictionary process copy |
| Not offered | 911 / heavy construction |

**Gap:** company history (“¿cuánto tiempo llevan?”), offices vs homes, Sunday policy beyond a canned ops sentence. No RAG. Unknown facts must say “Eso no lo tengo confirmado” rather than invent.

Ops Q&A currently answers Sundays with a canned line that is **not** the same as calendar authority.

---

## 8. HISTORY / MEMORY / ISOLATION (already certified — do not regress)

- Conversation isolation: cookie + conversationId (two tabs = two cookies unless shared).
- Refresh: GET `/api/concierge/chat` hydrates messages from server.
- Customer memory: retrieved, must not contaminate a new job with lock-photo speech (`response-compatibility.ts`).
- Anti-loop: `ToolLoopGuard`, `shouldBlockAvailabilityOfferLoop`, `detectRepeatedQuestion`.

---

## 9. TARGET ARCHITECTURE (this phase)

```
USER MESSAGE
  → SEMANTIC PERCEPTION (existing packed + perceive, not new keyword tables)
  → CONVERSATIONAL OBJECTIVE (primary / secondary / interrupted / phase)
  → BUSINESS WORLD STATE (HS/HA/readiness)
  → RESPONSE PLAN (compact, not 2k duplicated rules)
  → TOOL NEED? → execute → STRUCTURED OBSERVATION → back to model
  → NATURAL RESPONSE (OpenAI Spanish)
  → VALIDATORS (grounding, known-fact re-ask, style, stale context)
  → USER
```

Deterministic layers remain for: IDs, phone, dates, calendar math, cancellation, booking persistence, prompt-injection, OpenAI-down fallback.

Regex remains for validation and safe fallback — **not** as the NLU engine.

---

## 10. FILES THAT IMPLEMENT THE CURRENT PIPELINE

| File | Role |
| --- | --- |
| `src/app/api/concierge/chat/route.ts` | HTTP + cookie session |
| `src/lib/concierge-engine.ts` | Turn orchestrator |
| `src/lib/concierge-knowledge.ts` | System prompt |
| `src/lib/concierge-flags.ts` | Model / key / dry-run |
| `src/lib/concierge-tools.ts` | Tool schemas + execute |
| `src/lib/concierge/conversation-next-action.ts` | Field interview engine |
| `src/lib/concierge/cognitive-turn.ts` | Perception → plan |
| `src/lib/concierge/homestead-planner.ts` | Operational summary |
| `src/lib/concierge/conversation-perception.ts` | Intent composition |
| `src/lib/concierge-turn-routing.ts` | Interruption flags + canned replies |
| `src/lib/concierge/operations-qa.ts` | Early-return company Q&A |
| `src/lib/concierge/calendar-action.ts` | Calendar execute + slot dump text |
| `src/lib/concierge/packed-extraction.ts` | Multi-fact extraction |
| `src/lib/concierge/response-compatibility.ts` | Stale service / lock speech |

---

## 11. NON-GOALS OF THIS AUDIT

- Do not replace cancellation, calendar authority, HS identity, or isolation.
- Do not add hundreds of `if message.includes`.
- Do not deploy to production from this phase.
