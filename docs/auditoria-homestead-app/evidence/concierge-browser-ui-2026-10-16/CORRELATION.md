# Browser booking correlation (isolated UI)

## slot_taken diagnosis

Prior `Me sirve 12:00 p. m.` → `slot_taken` was **real contention** in `revenue_appointments` (CONFIRMED rows from parallel pending/HTTP tests), not a booking defect. After clearing exclusive isolated busy slots, the same widget path booked successfully.

## 12h → 24h (America/Panama labels)

Script `scripts/test-slot-12h24h-panama.mjs` (Node 24 / source import):

| Input | Expected | Result |
| --- | --- | --- |
| Me sirve 12:00 a. m. | 00:00 | PASS |
| Me sirve 12:00 p. m. | 12:00 | PASS |
| el de las 2:00 p. m. | 14:00 | PASS |
| Me sirve 4:00 p. m. | 16:00 | PASS |
| a las 2:00 (offered) | 14:00 | PASS |

Fix: bare `HH:MM` match skipped when meridiem follows; `12:00 a. m.` maps to `00:00`.

## UI journey (widget → n8n remote → SQLite)

| Step | UI | Turn | n8n exec | DB |
| --- | --- | --- | --- | --- |
| Ask slots | chips 8/10/12/2 | `b7c186f4-…` | 178 | offered exclusive slots |
| Book 2:00 p. m. | `Quedó reservada … 14:00` + card Visita confirmada | `795625ae-…` | **179** | `HA-3e64a4ea` CONFIRMED 2026-10-17 **14:00** HS-2026-000009 |
| Reload | transcript + Visita confirmada persist | — | — | same row |
| Reschedule ask | slots exclude 14:00 | `ecd069b3-…` | 180 | — |
| Pick 4:00 p. m. | `… 16:00` | `b4f1ccaf-…` | **181** | `HA-3e64a4ea` RESCHEDULED **16:00** v2 |
| Cancel + sí | `Cancelé la solicitud HS-2026-000009` | `d3c1dac9-…` | 182→ | status **CANCELLED** |

Conversation id: `7d1d1a6b-7794-4a12-a140-b9452c5e1128`

Screenshots: `04-booking-confirmed.png`, `05-booking-persisted-reload.png`, `06-reschedule-cancel.png`

## Contention UX (race after offer)

Workflow BOOK fail path re-offers `check_availability` + compose slots (no success copy). Prior UI contention showed `slot_taken` without success; pending remote suite asserts dual-book race. Full UI re-offer chips after live race not re-run (exclusive slots cleared for booking PASS).
