# HOMESTEAD AI — AUTONOMOUS OPERATIONS ARCHITECTURE AUDIT

**Date:** 2026-08-31  
**Phase:** Wave AUTO-1  
**Git baseline:** fd0d898aaeb8dda2d248ef9a5251e5907ae1c536 + autonomous layer

---

## Executive Summary

Homestead already had reactive Operations AI and deterministic alert engines (`ops-engine.ts`). Autonomous Operations adds a canonical **OperationalSignal** layer with deduplication, resolution, policy routing, and proactive Centro de Operaciones + Telegram delivery — reusing existing outbox, scheduler, and confirmation infrastructure.

---

## Source of Truth

| Domain | Authority | Signal Types |
|--------|-----------|--------------|
| service_requests | SQLite | REQUEST_AGING, REQUEST_WITHOUT_NEXT_STEP, CUSTOMER_WAITING |
| revenue_appointments | Calendar | APPOINTMENT_UPCOMING, APPOINTMENT_TODAY, CONFLICT |
| automation_outbox | Outbox | AUTOMATION_FAILURE |
| service-requirements.ts | Policy | REQUIREMENT_MISSING_BEFORE_VISIT |

**Rule:** REAL STATE → SIGNAL → AI ANALYSIS. Never LLM → signal.

---

## Reuse Points

- `automation_outbox`, `scheduler-tick`, `ops-store`, `analytics-service`
- Operations AI + copilot confirmations (human writes unchanged)
- `telegram-operators` RBAC, `deliverOpsTelegram`

---

## Autonomy Levels

L1 NOTIFY + L2 RECOMMEND default. L3 low-risk off. L4/high-impact always human confirmation.

---

## Kill Switches

`AUTONOMOUS_OPERATIONS_ENABLED`, `AUTONOMOUS_NOTIFICATIONS_ENABLED`, `AUTONOMOUS_OPERATIONS_DRY_RUN`

---

## Files

`src/lib/autonomous/*`, API `/api/admin/autonomous/signals`, `AutonomousAlertsPanel.tsx`
