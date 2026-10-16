# Concierge engine rollback — isolated proof

Global flag after rollback: `legacy`

| Scenario | After rollback |
| --- | --- |
| Legacy pinned | Stays **legacy**; resolve returns legacy |
| n8n pinned (+ HS + cita) | Stays **n8n** (pin preserved); data kept; no duplicate cita |
| In-flight turn INTERPRETING | Remains INTERPRETING/n8n until completed; flag flip does not rewrite turn |
| New conversation | Pins **legacy** |

Failed: **0** / 13

Do not restore an old SQLite over live data to “rollback”.
