# WAVE G — GAP ANALYSIS

Date: 2026-08-23 America/Panama  
HEAD at audit: `34197666` (== origin/main)  
Method: code + Wave F certification + Telegram/content-handler inspection

## Precondition

| Foundation | Status |
| --- | --- |
| Wave F | **CERTIFIED** — Customer 360 + BI + Attention Center |
| Wave E | CERTIFIED |
| Wave D | **NOT CERTIFIED** — Copilot must not fake Meta publish success |
| Multi-Operator dual live | NOT CERTIFIED (second account pending) — session isolation still required in code |

### WAVE_F_DEPENDENCY_STATUS

**CERTIFIED** — Copilot may proceed. Tools must call `AnalyticsService` / `Customer360` / ops stores — never invent counts.

---

## Domain map

### AI ROUTING

| | |
| --- | --- |
| EXISTS | Customer concierge tool-calling (`concierge-engine` / `concierge-tools`); Content Studio OpenAI |
| PARTIAL | Hardcoded NL shortcuts in `content-handler` (pendiente → Command Center) |
| MISSING | Business Copilot orchestrator separate from customer chatbot |
| REUSABLE | OpenAI fetch pattern; Telegram private-chat gate; `gateOperator` |
| MUST_NOT_TOUCH | Customer concierge prompts/tools; text-to-SQL |

### SAFE TOOLS

| | |
| --- | --- |
| EXISTS | Wave F deterministic query layer; ops `markEntityContacted` / `snoozeEntity` |
| MISSING | Copilot-facing tool schemas + RBAC-gated executors |
| MUST_NOT_TOUCH | `executeSql`, generic update, shell, arbitrary HTTP |

### BUSINESS QUERIES / ATTENTION / ANALYTICS

| | |
| --- | --- |
| EXISTS | `getExecutiveSummary`, `getBusinessBriefCounts`, `getAttentionItems`, funnel/services/sources |
| REUSABLE | All of the above as tool backends |
| MUST_NOT_TOUCH | Inventing `revenueAvailable: true` |

### CUSTOMER LOOKUP

| | |
| --- | --- |
| EXISTS | `listCustomers`, `getCustomer360`, `searchCustomersForTelegram`, `/cliente`, `cc:cu` |
| PARTIAL | Ambiguous multi-match UX already in Telegram search |
| REUSABLE | Same search for Copilot tools |

### APPOINTMENTS

| | |
| --- | --- |
| EXISTS | `listAgenda`, Booking V2 / concierge availability |
| PARTIAL | Natural-language booking via Copilot not wired |
| MUST_NOT_TOUCH | Fake slots |

### MUTATIONS / CONFIRMATION

| | |
| --- | --- |
| EXISTS | CC callbacks with stale handling (`already`); content approve idempotency |
| MISSING | Copilot confirmation tokens bound to operator+entity+state+expiry |
| MUST_NOT_TOUCH | Destructive deletes via NL |

### TELEGRAM UX

| | |
| --- | --- |
| EXISTS | Same bot; `/homestead` Command Center |
| MISSING | `🤖 Copiloto` entry; session TTL; progress UX |
| REUSABLE | `sendTelegramMessage`, home keyboard pattern |

### RBAC / AUDIT / COST / SECURITY / OBSERVABILITY

| | |
| --- | --- |
| EXISTS | Role permissions incl. `analytics.read` / `customers.read`; operator audit; concierge usage tokens |
| MISSING | Copilot-specific audit events, usage channel `COPILOT`, metrics counters |
| MUST_NOT_TOUCH | Client-supplied role trust |

### ADMIN WEB

| | |
| --- | --- |
| EXISTS | `/admin` BI |
| PARTIAL | No `/admin/copilot` |
| REUSABLE | Same `CopilotService` if web added |

---

## Classification summary

| Area | Status |
| --- | --- |
| AI ROUTING | MISSING → implement |
| SAFE TOOLS | MISSING → implement on Wave F |
| BUSINESS QUERIES | REUSABLE |
| CUSTOMER LOOKUP | REUSABLE |
| ATTENTION | REUSABLE |
| APPOINTMENTS | PARTIAL (read reusable; write confirm) |
| ANALYTICS | REUSABLE |
| MUTATIONS | PARTIAL (domain services exist; need confirm tokens) |
| CONFIRMATION | MISSING |
| TELEGRAM UX | PARTIAL |
| RBAC | REUSABLE (enforce before tools) |
| AUDIT | PARTIAL |
| COST | PARTIAL (new COPILOT channel) |
| SECURITY | MUST enforce injection/secret/SQL/shell deny |
| OBSERVABILITY | MISSING metrics keys |

## Build order

1. Schema + session + confirmations  
2. Safe tools → Wave F / ops  
3. CopilotService (deterministic-first + optional OpenAI explain)  
4. Telegram entry + NL  
5. Minimal `/admin/copilot`  
6. Adversarial + live E2E → certify → STOP  
