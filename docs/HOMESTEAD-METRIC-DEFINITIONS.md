# Homestead Metric Definitions

Timezone: America/Panama unless noted.

| Metric | Definition | Numerator | Denominator | Source | Exclusions |
| --- | --- | --- | --- | --- | --- |
| leads | revenue_leads created in range | count | — | revenue_leads | is_test=1 when includeTest=false |
| hs | service_requests created in range | count | — | service_requests | test via linked lead |
| ha | appointments created in range | count | — | revenue_appointments | test via lead |
| jobs | jobs created in range | count | — | revenue_jobs | is_test |
| completed | jobs COMPLETED with completed_at in range | count | — | revenue_jobs | is_test |
| lead→hs | HS / leads | hs | leads | computed | null if den=0 |
| hs→ha | HA / HS | ha | hs | computed | null if den=0 |
| ha→job | jobs / HA | jobs | ha | computed | null if den=0 |
| job→completed | completed / jobs | completed | jobs | computed | null if den=0 |
| repeat_customers | customers with ≥2 COMPLETED jobs | count | — | revenue_jobs | is_test |
| recovery_open | jobs recovery OPEN/CONTACTED | count | — | revenue_jobs | is_test |
| first_touch_source | customer.source_first for leads in range | count by source | — | customers+leads | — |
| last_touch_source | lead.source (fallback customer.source_last) | count by source | — | leads | — |
| revenue | — | — | — | — | **NOT AVAILABLE** |

No OpenAI involvement in counts.
