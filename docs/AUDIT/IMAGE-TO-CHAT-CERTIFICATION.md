# HOMESTEAD IMAGE-TO-CHAT CERTIFICATION

Date: 2026-08-25  
Scope: Public WhatsApp temporarily disabled + service/project images as conversational entry points.

## BACKUP

| Field | Value |
| --- | --- |
| COMMIT_BEFORE | `3c5ce72` (`fix(concierge): real vision gates for digital lock photos`) |
| SAFETY_TAG | `backup/pre-image-to-chat-20260825` → `3c5ce72` |

## WHATSAPP_PUBLIC_UI_REMOVED

| Check | Result |
| --- | --- |
| WHATSAPP_PUBLIC_UI_REMOVED | PASS — gated by `isPublicWhatsAppEnabled()` (`NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED === "true"` only) |
| WHATSAPP_LINKS_DISABLED | PASS — `whatsappHref()` returns `null` when flag off; header/footer/contact/social omit WA |
| PERSONAL_NUMBER_EXPOSED | PASS — no `62594210` / active `wa.me` Homestead CTA on public home/contact surfaces |
| Infra preserved | PASS — admin/Telegram `customerWhatsAppUrl` retained for ops contact to *customer* phones |

## IMAGE_CHAT_ENTRY

| Check | Result |
| --- | --- |
| IMAGE_CHAT_ENTRY | PASS — `ServiceConsultButton` on Services + AC feature; Hero/FinalCTA/MobileBar → “Hablar con Homestead” |
| STRUCTURED_CONTEXT | PASS — `WebsiteImageChatContext` (`source`, `serviceId`, `itemId`, `imageId`, `pagePath`, …) |
| CHAT_CONTEXT_CARD | PASS — widget card: thumbnail + title + “Consultando este servicio” |
| CONTEXT_STARTED API | PASS — POST `event: "CONTEXT_STARTED"` → greeting + state; **no** HS-* / appointment |

## SERVICE FLOWS

| Service | Result |
| --- | --- |
| DIGITAL_LOCK | PASS — `intentHint: "digital_lock"` → `activateDigitalLockFlow` + specialized greeting; Vision Validation unchanged |
| PAINTING | PASS — contextual greeting (casa/apto/oficina/local) |
| AIR_CONDITIONING | PASS — preventivo vs problema |
| PLUMBING | PASS — contextual greeting |
| OTHER_SERVICES | PASS — electrical / repairs / remodeling / locksmith generic CTAs |

## CONTEXT / MEMORY

| Check | Result |
| --- | --- |
| CONTEXT_SWITCHING | PASS — open chat + other card → confirm chips; mid-chat text can change `primaryService` + `ServiceContextChanged`; DL checklist cleared when leaving DL |
| CUSTOMER_MEMORY | PASS — name used once in greeting when known (`Claro, {name}`) |
| CURRENT_TRANSACTION | PASS — image entry clears active booking transaction / `activeLeadId`; does not invent new HS-* |
| REQUEST_SOURCE_TRACKING | PASS — `facts.entryPoint=service_image`, `entrySource=website`, item/image ids |
| ANALYTICS | PASS — `ServiceImageChatOpened`, `ChatContextStarted`, `ServiceContextChanged`, `RequestCreatedFromImage` |

## UX / A11Y

| Check | Result |
| --- | --- |
| DESKTOP | PASS — hover/focus overlay “Consultar” on service cards + body CTA |
| MOBILE | PASS — always-visible overlay CTA + text CTA; MobileBar “Hablar” |
| ACCESSIBILITY | PASS — semantic `<button>` + `aria-label`; keyboard activatable |

## REGRESSIONS (static / design)

| Check | Result |
| --- | --- |
| TELEGRAM_REGRESSION | PASS — no Telegram ops code paths altered for this feature |
| N8N_REGRESSION | PASS — untouched |
| APPOINTMENT_REGRESSION | PASS — image open does not book; booking flow unchanged |
| CUSTOMER360_REGRESSION | PASS — admin WA-to-customer links retained |

## BUILD / TESTS

| Check | Result |
| --- | --- |
| BUILD | PASS — `tsc --noEmit` clean |
| TESTS | PASS — `node scripts/test-image-to-chat.mjs` (+ existing digital-lock / chat-image suites) |

## GATES

| Severity | Count | Notes |
| --- | --- | --- |
| P0 | 0 | |
| P1 | 0 | Works gallery remains `enabled: false` (no public project tiles); when enabled, add Consultar CTAs |

## HARD GATE REVIEW

- WhatsApp not visible publicly when flag unset: **PASS**
- Personal number not exposed as Homestead CTA: **PASS**
- Image opens chat **with** structured context: **PASS**
- No “¿qué servicio?” when entering from a known service: **PASS**
- Click does not create request/appointment: **PASS**
- Context switch does not contaminate prior lead transaction: **PASS**
- Digital lock still requires Vision Validation: **PASS** (prior cert + this activation path)
- Telegram preserved: **PASS**

## FINAL VERDICT

**IMAGE-TO-CHAT CERTIFIED**

Principle held: the public site feels conversational without WhatsApp —  
`IMAGE → INTEREST → CONTEXTUAL CHAT → QUALIFICATION → REQUEST → APPOINTMENT → OPS`.
