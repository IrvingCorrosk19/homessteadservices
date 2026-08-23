# OPERATIONS STATUS VISUAL CERTIFICATION

DATE: 2026-08-23 America/Panama  
METHOD: state audit + unified visual system + optimistic ops UI + unit checks

```text
OPERATIONS STATUS VISUAL CERTIFICATION

STATE_MODEL_AUDITED: PASS
  Real DB states: NEW, CONTACTED, IN_PROGRESS, COMPLETED, CANCELLED
  Operator "Atendida" maps to CONTACTED (no invented ATENDIDA status)
  Urgent/SLA: sla_escalated_at / sla_first_alerted_at on NEW only

PENDING_VISUAL: PASS
  Accent emphasis, ● icon, border+shadow, aria-label

IN_PROGRESS_VISUAL: PASS
  Navy intermediate, ◐ icon, distinct card surface

ATTENDED_VISUAL: PASS
  Calm cream/navy-soft, ✓ icon, badge "Atendida", reduced emphasis

URGENT_VISUAL: PASS
  Strong red reserved for NEW + sla_escalated_at

FILTERS: PASS
  Todas | Necesitan atención | En gestión | Atendidas

COUNTERS: PASS
  Live bucket counts on filter chips + status cards

OPTIMISTIC_UPDATE: PASS
  Marcar como atendida updates card + counts immediately

NO_RELOAD: PASS
  No window.location.reload / full postback

ATTENTION_CENTER_SYNC: PASS
  Web uses markEntityContacted (same as Telegram/Copilot)
  Sets CONTACTED + first_human_action_at + pipeline

CUSTOMER_360_SYNC: PASS
  Timeline HS rows use StatusPill via TimelineRequestStatus

MOBILE: PASS
  Badge+icon visible on list cards without opening detail

ACCESSIBILITY: PASS
  Icon + text + border; aria-label on pills

VISUAL_CONSISTENCY: PASS
  Single resolver: src/lib/request-status-visual.ts

P0: 0
P1: 0

VERDICT: PASS
```

## Files

- `src/lib/request-status-visual.ts` — single source of truth
- `src/components/admin/StatusPill.tsx`
- `src/components/admin/SolicitudesOperationsClient.tsx`
- `POST /api/admin/service-requests/[id]/contacted`
- `PATCH` CONTACTED → `markEntityContacted`

## Notes

- Default ops view: **Necesitan atención** (NEW).
- "Ocultar atendidas" enabled by default on vista Todas.
- Dashboard Attention Center aggregate counts refresh on next navigation (pending uses NEW count).
