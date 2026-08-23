import { STATUS_LABELS, type RequestStatus } from "@/lib/admin-format";

export type OpsFilter = "ALL" | "NEEDS_ATTENTION" | "IN_PROGRESS" | "ATTENDED" | "CLOSED";

export type RequestVisualKind = "urgent" | "pending" | "in_progress" | "attended" | "closed";

export type RequestVisualPresentation = {
  kind: RequestVisualKind;
  label: string;
  icon: string;
  badgeClass: string;
  pillClass: string;
  cardClass: string;
  ringClass: string;
  priority: number;
  ariaLabel: string;
};

const OPS_LABELS: Record<RequestStatus, string> = {
  NEW: "Pendiente",
  CONTACTED: "Atendida",
  IN_PROGRESS: "En gestión",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export function opsStatusLabel(status: RequestStatus) {
  return OPS_LABELS[status] || STATUS_LABELS[status] || status;
}

export function resolveRequestVisual(input: {
  status: RequestStatus;
  slaEscalatedAt?: string | null;
  slaFirstAlertedAt?: string | null;
}): RequestVisualPresentation {
  const { status } = input;
  const slaEscalated = Boolean(input.slaEscalatedAt);
  const slaBreached = Boolean(input.slaFirstAlertedAt) || slaEscalated;

  if (status === "NEW" && slaEscalated) {
    return {
      kind: "urgent",
      label: "Urgente · SLA",
      icon: "⚠",
      badgeClass: "border border-red-700/30 bg-red-50 text-red-900",
      pillClass: "border border-red-700/30 bg-red-50 text-red-900",
      cardClass: "border-red-300/80 bg-red-50/70 shadow-[0_0_0_1px_rgba(185,28,28,0.08)]",
      ringClass: "ring-2 ring-red-400/40",
      priority: 0,
      ariaLabel: "Solicitud urgente con SLA vencido",
    };
  }

  if (status === "NEW") {
    return {
      kind: "pending",
      label: slaBreached ? "Pendiente · SLA" : "Pendiente",
      icon: "●",
      badgeClass: "border border-accent/35 bg-accent/15 text-accent-deep",
      pillClass: "border border-accent/35 bg-accent/15 text-accent-deep",
      cardClass: "border-accent/35 bg-white shadow-[0_10px_24px_rgba(193,122,74,0.10)]",
      ringClass: "ring-2 ring-accent/25",
      priority: 1,
      ariaLabel: "Solicitud pendiente de atención",
    };
  }

  if (status === "IN_PROGRESS") {
    return {
      kind: "in_progress",
      label: "En gestión",
      icon: "◐",
      badgeClass: "border border-navy/20 bg-navy/8 text-navy",
      pillClass: "border border-navy/20 bg-navy/8 text-navy",
      cardClass: "border-navy/15 bg-white",
      ringClass: "ring-2 ring-navy/15",
      priority: 2,
      ariaLabel: "Solicitud en gestión",
    };
  }

  if (status === "CONTACTED") {
    return {
      kind: "attended",
      label: "Atendida",
      icon: "✓",
      badgeClass: "border border-navy/10 bg-cream-deep text-navy-soft",
      pillClass: "border border-navy/10 bg-cream-deep text-navy-soft",
      cardClass: "border-navy/8 bg-cream-deep/35 opacity-95",
      ringClass: "ring-1 ring-navy/10",
      priority: 4,
      ariaLabel: "Solicitud atendida",
    };
  }

  return {
    kind: "closed",
    label: OPS_LABELS[status],
    icon: status === "CANCELLED" ? "×" : "◼",
    badgeClass: "border border-mist/30 bg-mist/10 text-mist",
    pillClass: "border border-mist/30 bg-mist/10 text-mist",
    cardClass: "border-mist/25 bg-cream-deep/20 opacity-80",
    ringClass: "",
    priority: 5,
    ariaLabel: `Solicitud ${OPS_LABELS[status].toLowerCase()}`,
  };
}

export function matchesOpsFilter(status: RequestStatus, filter: OpsFilter) {
  if (filter === "ALL") return true;
  if (filter === "NEEDS_ATTENTION") return status === "NEW";
  if (filter === "IN_PROGRESS") return status === "IN_PROGRESS";
  if (filter === "ATTENDED") return status === "CONTACTED";
  if (filter === "CLOSED") return status === "COMPLETED" || status === "CANCELLED";
  return true;
}

export function opsFilterCounts(counts: Record<RequestStatus, number>) {
  return {
    all: counts.NEW + counts.CONTACTED + counts.IN_PROGRESS + counts.COMPLETED + counts.CANCELLED,
    needsAttention: counts.NEW,
    inProgress: counts.IN_PROGRESS,
    attended: counts.CONTACTED,
    closed: counts.COMPLETED + counts.CANCELLED,
  };
}

export const OPS_FILTERS: Array<{ id: OpsFilter; label: string }> = [
  { id: "ALL", label: "Todas" },
  { id: "NEEDS_ATTENTION", label: "Necesitan atención" },
  { id: "IN_PROGRESS", label: "En gestión" },
  { id: "ATTENDED", label: "Atendidas" },
];
