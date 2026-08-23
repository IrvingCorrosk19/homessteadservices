# Homestead Customer 360

Stable identity: `revenue_customers.id` (integer). No `customers_v2`.

- List: `/admin/clientes`
- Detail: `/admin/clientes/[id]`
- Timeline: projection from HS / HA / jobs / aftercare / recovery / reviews / retention_actions
- Duplicate detection: phone/email only — **no auto-merge**
- Repeat customer: ≥2 COMPLETED jobs on same `customer_id`

Telegram: `/cliente <query>` requires `customers.read`.

See `docs/AUDIT/WAVE_F_GAP_ANALYSIS.md`.
