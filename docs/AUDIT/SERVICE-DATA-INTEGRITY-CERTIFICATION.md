# HOMESTEAD — SERVICE DATA INTEGRITY REMEDIATION

**Date:** 2026-08-23  
**Incident:** HS-2026-000026  
**User intent:** "Repara mi cielo razo"

---

## FORENSIC EVIDENCE (production SQLite)

| Field | Value |
|-------|-------|
| REQUEST `service` | **painting** |
| REQUEST `message` | "Necesidad: **Pintura exterior**. Servicio: painting" |
| REQUEST `created_at` | **2026-08-21** (predates ceiling repair chat) |
| LEAD `service_category` | **painting** |
| LEAD `problem_summary` | **Pintura exterior** |
| APPOINTMENT `service` | **painting** (HA-bc81d901 CONFIRMED 2026-08-24 16:00) |
| CONVERSATION | `39350adf-16af-4159-829f-3158020f9522` |

**Chat interpretation (user report):** correctly understood repair of ceiling.  
**Persisted data:** stale **Pintura exterior** from prior transaction.

---

## ROOT CAUSE

| Layer | Finding |
|-------|---------|
| WAS_STALE_STATE | **YES** — `activeLeadId` / HS-2026-000026 from Aug 21 painting session |
| WAS_CLASSIFIER | **PARTIAL** — `choosePrimary()` sticky: kept `painting` when new message detected `repairs` |
| WAS_APPOINTMENT_MAPPING | **YES** — `createAppointment()` copies frozen `lead.service` |
| WAS_OUTBOX | **NO** — outbox reflects DB (upstream bug) |
| WAS_N8N | **NOT SHOWN** — Homestead DB already had painting |
| WAS_TELEGRAM_TEMPLATE | **NO** — renders persisted `serviceLabel` |

**Chain:** sticky `choosePrimary` → no `activeLeadId` reset → `createLeadFromConcierge` early-return on existing HS → appointment inherits painting → Telegram shows Pintura.

---

## FIX

1. **`service-intent.ts`** — `resolvePrimaryFromMessage()` with repair/paint disambiguation + typo `razo`
2. **`choosePrimary()`** — latest user message intent overrides stale category
3. **`packed-extraction.ts`** — clears `activeLeadId`/booking on service change; refreshes `problem`
4. **`concierge-transaction.ts`** — detects intent change without requiring "otra cosa"
5. **`concierge-handoff.ts`** — refuses to reuse HS when service slug mismatches; creates new request
6. **`revenue-telegram.ts`** — optional `📝` detail line from problem text
7. **Observability** — `REQUEST_SERVICE_PERSISTED`, `APPOINTMENT_SERVICE_SNAPSHOTTED`, `SERVICE_INTENT_RESOLVED`

**HS-2026-000026 not modified** — retained as diagnostic evidence.

---

## CERTIFICATION

| Check | Status |
|-------|--------|
| REPAIR_CEILING | **PASS** |
| PAINT_CEILING | **PASS** |
| CHOOSE_PRIMARY_OVERRIDE | **PASS** |
| CHANGE_OF_INTENT | **PASS** |
| STALE_LEAD_BLOCK | **PASS** |
| BUILD | **PASS** |
| TESTS (SDI-01..21) | **PASS** |

| Priority | Count |
|----------|-------|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 0 |

## FINAL VERDICT

### **SERVICE DATA INTEGRITY CERTIFIED** (forward path)

Historical HS-2026-000026 remains painting in DB by design (evidence). New conversations with repair intent will classify as **Reparaciones** with detail preserved.
