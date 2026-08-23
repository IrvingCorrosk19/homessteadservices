# HOMESTEAD COPILOT TOOLS

All tools are server-side, schema-validated, RBAC-gated. OpenAI never sees SQLite.

| Tool | Permission(s) | Backend |
| --- | --- | --- |
| `get_business_summary` | analytics.read / dashboard.read | `getExecutiveSummary`, `getBusinessBriefCounts` |
| `get_attention_items` | analytics.read / dashboard.read | `getAttentionItems` |
| `get_appointments` | appointments.read | `listAgenda` |
| `get_pending_requests` | requests.read / leads.read / dashboard.read | `listPendingRequests` |
| `get_request_detail` | requests.read / leads.read | `getRequestByPublicId` |
| `search_customers` | customers.read | `searchCustomersForTelegram` |
| `get_customer` | customers.read | `getCustomer360` |
| `get_service_performance` | analytics.read | `getServicePerformance` |
| `get_source_performance` | analytics.read | `getSourcePerformance` |
| `get_retention_metrics` | retention.read / analytics.read | `getRetentionMetrics` |
| `get_recovery_cases` | recovery.read | recovery SQL (Wave E states) |
| `get_content_pending` | content.read | Content Studio job list |
| `propose_mark_contacted` | leads.manage / requests.manage | confirmation → `markEntityContacted` |
| `propose_snooze` | leads.manage / requests.manage | confirmation → `snoozeEntity` |

## Forbidden

- `executeSql` / text-to-SQL
- shell / filesystem / arbitrary HTTP
- generic n8n workflow run
- Meta publish via NL (Wave D not certified)
- mass PII dump / export bypass

## Confirmations

High-impact writes use tokens bound to `operator_id + action + entity + expected_state + expiry`.  
Stale state → deny. Double confirm → one execution.
