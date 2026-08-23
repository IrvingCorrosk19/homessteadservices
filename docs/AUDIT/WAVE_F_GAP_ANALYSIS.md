# WAVE F — GAP ANALYSIS

Date: 2026-08-23 America/Panama  
HEAD: `9d76568` (== origin/main at audit start)  
Method: code + Wave E certification + live schema inspection patterns

## Precondition

| Foundation | Status |
| --- | --- |
| Wave E | **CERTIFIED** — Customer 360 may proceed |
| Wave D | **NOT CERTIFIED / NOT STARTED** |
| Multi-Operator | **NOT CERTIFIED** (second account pending) |

### WAVE_E_DEPENDENCY_STATUS

**CERTIFIED** — aftercare / recovery / retention states are trustworthy enough for Customer 360 timeline and Attention Center.

### WAVE_D_DEPENDENCY_STATUS

**NOT_CERTIFIED_NOT_STARTED** — do **not** invent Meta/content publish attribution. Use only `source_first` / `source_last` / `utm_json` / `source_detail` / retention `src=` query params when present. Mark publishing metrics `N/A_NOT_CERTIFIED`.

---

## Domain map

### CUSTOMER IDENTITY

| | |
| --- | --- |
| EXISTS | `revenue_customers.id` stable integer PK; upsert by phone variants |
| PARTIAL | phone match without dedicated `normalized_phone` column; email lower-case ad-hoc |
| MISSING | list UI `/admin/clientes`; duplicate detection states; last_activity derived field |
| REUSABLE | `upsertCustomer`, `getCustomer360`, `findCustomerIdByContact` |
| MUST_NOT_TOUCH | `customers_v2`; name-only merge |

### CUSTOMER TIMELINE

| | |
| --- | --- |
| EXISTS | Lite history (request/appointment/job) on detail page |
| PARTIAL | not chronological union with aftercare/recovery/review/retention |
| MISSING | unified timeline with entity pointers |
| REUSABLE | existing row sources |
| MUST_NOT_TOUCH | mega copy table unless proven necessary |

### LEAD FUNNEL

| | |
| --- | --- |
| EXISTS | `revenue_leads`, `service_requests`, pipeline stages, `todayMetrics` |
| PARTIAL | conversion % only solicitud→cita today |
| MISSING | documented funnel definitions + period BI |
| MUST_NOT_TOUCH | fake visitor stage |

### APPOINTMENTS / JOBS

| | |
| --- | --- |
| EXISTS | HA / HJ linked via `customer_id` |
| REUSABLE | Wave C stores |

### ATTRIBUTION

| | |
| --- | --- |
| EXISTS | lead `source`, `source_detail`, `utm_json`, customer `source_first`/`source_last` |
| PARTIAL | retention contact URLs carry `RETENTION_*` |
| MISSING | Wave D content→HS chain (Wave D not certified) |
| MUST_NOT_TOUCH | invented Instagram/Facebook publish attribution |

### RETENTION

| | |
| --- | --- |
| EXISTS | Wave E prefs, recovery, reviews, maintenance, reactivation |
| REUSABLE | `retentionDashboard`, recovery queue |

### REVENUE

| | |
| --- | --- |
| EXISTS | `quoted_amount`, `final_amount`, `payment_status` columns |
| MISSING | reliable invoiced/paid operational use |
| MUST_NOT_TOUCH | fake LTV / invented revenue dashboards |

### ANALYTICS / DASHBOARDS

| | |
| --- | --- |
| EXISTS | Command Center summary; solicitudes counts; retention page |
| MISSING | `/admin` executive BI; Attention Center; AnalyticsService layer |
| DUPLICATED | risk of scattering SQL in React — avoid |

### SEARCH / TELEGRAM

| | |
| --- | --- |
| EXISTS | Resumen `cc:s`; Clientes retention panel |
| MISSING | customer search by name/phone/HS; counts aligned to AnalyticsService |
| PARTIAL | RBAC without `customers.read` / `analytics.read` |

### PRIVACY

| | |
| --- | --- |
| EXISTS | admin cookie gate; Telegram deny-by-default |
| MISSING | export audit; aggregate PII discipline docs |

---

## Implementation plan (Wave F)

1. Evolve `revenue_customers` with `normalized_phone` / `email_normalized` (no new CRM table).
2. Expand Customer 360 + timeline query layer.
3. `AnalyticsService` for funnel / services / sources / attention / executive summary.
4. Admin `/admin` dashboard + `/admin/clientes` list + richer detail.
5. Telegram Resumen + customer search via same service.
6. Metric definitions doc. No text-to-SQL. No Wave G.
