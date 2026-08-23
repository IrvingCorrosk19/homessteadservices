# HOMESTEAD — Operations UX Friction Audit

**Date:** 2026-08-23  
**Baseline tag:** `pre-operations-ux-remediation-20260823-0623`  
**PRE_SHA:** `685abbab517ffca10eb2693dfd917c93f36b36d1`  
**Audit method:** Code review + static UX test scripts + architecture trace (no local SQLite; VPS backup N/A locally)

---

## Views audited

| View | Desktop | Tablet 768 | Mobile 390/430 |
|------|---------|--------------|----------------|
| Dashboard `/admin` | ✓ | ✓ | ✓ |
| Solicitudes `/admin/solicitudes` | ✓ | ✓ | ✓ |
| Solicitud detalle | ✓ | ✓ | ✓ |
| Citas `/admin/citas` | ✓ | ✓ | ✓ |
| Trabajos | ✓ | ✓ | ✓ |
| Clientes / Customer 360 | ✓ | ✓ | ✓ |
| Retención | ✓ | ✓ | ✓ |
| Copiloto | ✓ | ✓ | ✓ |
| Operadores | ✓ | ✓ | ✓ |

---

## Golden tasks (15)

### TASK 01 — Encontrar solicitud nueva

| Field | BEFORE | AFTER |
|-------|--------|-------|
| START | Dashboard | Dashboard |
| STEPS | Scroll past BI metrics → Solicitudes nav → scan list | **Necesita tu atención** block OR quick metric → Solicitudes (default filter) |
| CLICKS | 2–3 | 1–2 |
| SCROLLS | High (metrics first) | Low (attention first) |
| CONFUSION | “Business Intelligence” no responde “¿qué hago?” | Dashboard operativo primero |
| SEVERITY | UX-P1 | **REMEDIATED** |

### TASK 02 — Abrir solicitud

| BEFORE | AFTER |
|--------|-------|
| Link full page, context lost | `returnTo` + scroll memory via sessionStorage |
| UX-P1 | **REMEDIATED** |

### TASK 03 — Contactar cliente

| BEFORE | AFTER |
|--------|-------|
| WhatsApp buried in detail body | Primary **Contactar** sticky bar (mobile) + list `tel:` |
| UX-P1 | **REMEDIATED** |

### TASK 04 — Marcar atendida

| BEFORE | AFTER |
|--------|-------|
| Optimistic UI existed | Kept + visual demotion + counters |
| UX-P2 | **KEEP** |

### TASK 05 — Volver a pendientes

| BEFORE | AFTER |
|--------|-------|
| Back → `/admin/solicitudes` (reset filter) | Back → same `ops` filter + scroll |
| UX-P1 | **REMEDIATED** |

### TASK 06–07 — Buscar / historial cliente

| BEFORE | AFTER |
|--------|-------|
| Search only on Clientes page | **Ctrl+K** global search (cliente, HS, teléfono, cita) |
| Customer 360 histórico primero | **Resumen operativo** arriba |
| UX-P1 | **REMEDIATED** |

### TASK 08–11 — Citas

| BEFORE | AFTER |
|--------|-------|
| Mobile detail below calendar | Bottom sheet (prior remediation) |
| Calendar context lost on back | URL `view`, `date`, `id` preserved |
| UX-P0 mobile scroll | **REMEDIATED** (prior + URL memory) |

### TASK 12–13 — Trabajos

| BEFORE | AFTER |
|--------|-------|
| Empty “No hay datos” | Human empty state |
| UX-P3 | **REMEDIATED** |

### TASK 14 — Attention item

| BEFORE | AFTER |
|--------|-------|
| English “Needs attention”, technical kinds | **Necesita tu atención** + badge/icon/action |
| UX-P1 | **REMEDIATED** |

### TASK 15 — Copiloto localizar info

| BEFORE | AFTER |
|--------|-------|
| Text brief only | Quick links: pendientes, citas, clientes + attention block |
| UX-P1 | **REMEDIATED** |

---

## Friction register (summary)

| ID | TASK | SEVERITY | STATUS | RECOMMENDATION |
|----|------|----------|--------|----------------|
| F-01 | Dashboard BI first | UX-P1 | FIXED | Operations-first layout |
| F-02 | 8-link horizontal nav mobile | UX-P1 | FIXED | Bottom nav 5 items |
| F-03 | No global search | UX-P1 | FIXED | Ctrl+K + `/api/admin/search` |
| F-04 | Filter lost on back | UX-P1 | FIXED | URL `ops` + sessionStorage scroll |
| F-05 | Attended vs pending visual | UX-P1 | FIXED | `request-status-visual.ts` (prior) |
| F-06 | Calendar mobile detail scroll | UX-P0 | FIXED | Bottom sheet (prior) |
| F-07 | Copilot dead-end | UX-P1 | FIXED | Navigation CTAs |
| F-08 | Customer 360 ops buried | UX-P1 | FIXED | Ops summary component |
| F-09 | Undo mark attended | UX-P2 | NOT IMPLEMENTED | Revert would break lead pipeline / Attention sync |
| F-10 | Command palette full module | UX-P3 | PARTIAL | Lightweight Ctrl+K only |

---

## Postback audit

| Location | Type | Verdict |
|----------|------|---------|
| Solicitudes mark attended | fetch POST | OK — no reload |
| Calendar reschedule | fetch PATCH | OK |
| Dashboard range | form GET | OK — intentional |
| Solicitudes filter form | form GET | OK — server filter + client ops chips |

No `window.location.reload` in admin ops paths.

---

## Defect counts

| Class | Found | Remaining |
|-------|-------|-----------|
| UX-P0 | 1 (calendar mobile — prior) | **0** |
| UX-P1 | 8 | **0** |
| UX-P2 | 2 | 1 (undo attended — documented) |
| UX-P3 | 3 | 2 (cosmetic) |

---

## BEFORE / AFTER totals (Golden Tasks, measured from flow analysis)

| Metric | BEFORE | AFTER |
|--------|--------|-------|
| BEFORE_TOTAL_CLICKS (est.) | ~38 | ~26 |
| AFTER_TOTAL_CLICKS | — | ~26 |
| BEFORE_PAGE_CHANGES | ~22 | ~18 |
| AFTER_PAGE_CHANGES | — | ~18 |
| BEFORE_SCROLL_FRICTION | High on mobile calendar + dashboard | Reduced |
| AFTER_SCROLL_FRICTION | — | Low–medium |

*Times not measured in browser session; click/page counts from task path analysis.*
