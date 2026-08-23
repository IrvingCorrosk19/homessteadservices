# HOMESTEAD — Status Visual Language

**Single source of truth:** `src/lib/request-status-visual.ts`  
**UI component:** `src/components/admin/StatusPill.tsx`

## Service requests (HS)

| DB status | Operator label | Icon | Card emphasis |
|-----------|----------------|------|---------------|
| NEW | Pendiente | ● | Accent ring, shadow — **needs action** |
| NEW + SLA escalated | Urgente · SLA | ⚠ | Red — **exclusive urgent signal** |
| IN_PROGRESS | En gestión | ◐ | Navy intermediate |
| CONTACTED | Atendida | ✓ | Cream/muted — **low competition** |
| COMPLETED | Completada | ◼ | Muted secondary |
| CANCELLED | Cancelada | × | Muted secondary |

## Attention Center kinds

**Resolver:** `src/lib/attention-visual.ts`  
**Block:** `src/components/admin/NeedsAttentionBlock.tsx`

| Kind | Label | Icon | Use |
|------|-------|------|-----|
| SAFETY | Seguridad | ⚠ | Recovery URGENT |
| RECOVERY | Recovery | ↻ | Open recovery jobs |
| SLA | SLA | ⏱ | Overdue followups |
| APPOINTMENT | Cita | 📅 | Today’s appointments |
| HOT_LEAD | Sin contacto | ● | Rescue leads |
| SYSTEM | Sistema | ⚙ | Outbox failures |
| CONTENT | Contenido | ✎ | Content pending |

## Appointments (HA)

Uses `AppointmentCard` status badges + `APPOINTMENT_STATUS_LABELS`.  
Text truncation: `min-w-0`, `truncate`, overflow popover for +N days.

## Consistency rules

1. Same resolver on Solicitudes, detalle, Customer 360 timeline.
2. Color never alone — always badge + text + icon.
3. WCAG: contrast on navy/cream palette; `aria-label` on pills.
4. Mobile: badge visible without opening entity.

## Filter buckets (ops)

| Filter | Maps to |
|--------|---------|
| Necesitan atención | NEW |
| En gestión | IN_PROGRESS |
| Atendidas | CONTACTED |
| Todas | all (hide attended toggle default on) |
