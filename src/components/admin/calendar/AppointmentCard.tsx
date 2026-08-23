"use client";

import {
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentClock,
  type AppointmentStatus,
} from "@/lib/appointment-time";
import type { CalendarItem } from "@/components/admin/AppointmentCalendar";

const DRAGGABLE_STATUSES = new Set(["REQUESTED", "PROPOSED", "CONFIRMED", "RESCHEDULED"]);

export function canDragAppointment(status: string) {
  return DRAGGABLE_STATUSES.has(status);
}

export function customerDisplay(item: CalendarItem) {
  const name = item.customerName?.trim();
  const first = item.customerFirst?.trim();
  if (!name || name === "Cliente" || first === "Cliente" || !first) return "Cliente pendiente";
  return first;
}

function statusClass(status: string) {
  if (status === "CONFIRMED") return "border-navy/30 bg-navy text-cream";
  if (status === "RESCHEDULED") return "border-accent/40 bg-accent/15 text-navy";
  if (status === "PROPOSED" || status === "REQUESTED") return "border-navy/15 bg-white text-navy";
  if (status === "CANCELLED") return "border-mist/40 bg-cream-deep text-mist line-through";
  if (status === "COMPLETED") return "border-navy/15 bg-cream-deep text-navy-soft";
  return "border-line bg-white text-charcoal";
}

function statusBadgeClass(status: string) {
  if (status === "CONFIRMED") return "bg-cream/20 text-cream";
  if (status === "RESCHEDULED") return "bg-accent/25 text-navy";
  return "bg-navy/8 text-navy-soft";
}

type AppointmentCardProps = {
  item: CalendarItem;
  compact?: boolean;
  dragging?: boolean;
  saving?: boolean;
  dragEnabled?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
};

export function AppointmentCard({
  item,
  compact = false,
  dragging = false,
  saving = false,
  dragEnabled = false,
  selected = false,
  onOpen,
  onDragStart,
  onDragEnd,
}: AppointmentCardProps) {
  const statusLabel = APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatus] || item.status;
  const customer = customerDisplay(item);

  return (
    <button
      type="button"
      draggable={dragEnabled && canDragAppointment(item.status)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`group relative box-border flex w-full min-h-11 min-w-0 max-w-full flex-col gap-0.5 overflow-hidden rounded-lg border px-2 py-2 text-left transition-all duration-200 md:min-h-0 md:py-1.5 ${statusClass(item.status)} ${
        dragging ? "scale-[1.02] opacity-60 shadow-lg ring-2 ring-accent/40" : "shadow-sm hover:shadow-md"
      } ${selected ? "ring-2 ring-accent" : ""} ${saving ? "animate-pulse opacity-80" : ""}`}
      aria-label={`${formatAppointmentClock(item.startTime)} ${item.serviceLabel} ${customer} ${statusLabel}`}
    >
      {dragEnabled && canDragAppointment(item.status) ? (
        <span
          className="absolute right-1 top-1 hidden cursor-grab text-[0.55rem] tracking-widest text-current/40 group-hover:inline active:cursor-grabbing"
          aria-hidden
        >
          ⋮⋮
        </span>
      ) : null}
      <span className="min-w-0 max-w-full truncate text-[0.68rem] font-semibold leading-tight">
        {formatAppointmentClock(item.startTime)}
      </span>
      <span className="min-w-0 max-w-full truncate text-[0.66rem] leading-tight">{item.serviceLabel}</span>
      <span className="min-w-0 max-w-full truncate text-[0.62rem] leading-tight opacity-85">{customer}</span>
      <span
        className={`mt-0.5 inline-block max-w-full truncate rounded px-1 py-0.5 text-[0.52rem] font-medium uppercase tracking-[0.06em] ${statusBadgeClass(item.status)}`}
      >
        {statusLabel}
      </span>
      {saving ? (
        <span className="text-[0.58rem] tracking-[0.08em] uppercase opacity-80">Reprogramando…</span>
      ) : null}
      {!compact && item.appointmentId ? (
        <span className="sr-only">{item.appointmentId}</span>
      ) : null}
    </button>
  );
}

export function statusSurfaceClass(status: string) {
  return statusClass(status);
}
