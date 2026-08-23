import type { AttentionItem } from "@/lib/analytics-service";

export type AttentionVisual = {
  label: string;
  badgeClass: string;
  icon: string;
  actionLabel: string;
  priorityClass: string;
};

const KIND_MAP: Record<AttentionItem["kind"], AttentionVisual> = {
  SAFETY: {
    label: "Seguridad",
    badgeClass: "border-red-700/30 bg-red-50 text-red-900",
    icon: "⚠",
    actionLabel: "Atender ahora",
    priorityClass: "border-red-300/80 bg-red-50/60",
  },
  RECOVERY: {
    label: "Recovery",
    badgeClass: "border-accent/35 bg-accent/10 text-accent-deep",
    icon: "↻",
    actionLabel: "Ver trabajo",
    priorityClass: "border-accent/30 bg-white",
  },
  SLA: {
    label: "SLA",
    badgeClass: "border-red-700/25 bg-red-50 text-red-900",
    icon: "⏱",
    actionLabel: "Ver seguimientos",
    priorityClass: "border-red-200/80 bg-white",
  },
  APPOINTMENT: {
    label: "Cita",
    badgeClass: "border-navy/20 bg-navy/8 text-navy",
    icon: "📅",
    actionLabel: "Ver agenda",
    priorityClass: "border-navy/12 bg-white",
  },
  HOT_LEAD: {
    label: "Sin contacto",
    badgeClass: "border-accent/35 bg-accent/15 text-accent-deep",
    icon: "●",
    actionLabel: "Ver solicitudes",
    priorityClass: "border-accent/25 bg-white shadow-[0_8px_20px_rgba(193,122,74,0.08)]",
  },
  SYSTEM: {
    label: "Sistema",
    badgeClass: "border-mist/30 bg-mist/10 text-charcoal",
    icon: "⚙",
    actionLabel: "Revisar",
    priorityClass: "border-mist/25 bg-white",
  },
  CONTENT: {
    label: "Contenido",
    badgeClass: "border-mist/30 bg-mist/10 text-charcoal",
    icon: "✎",
    actionLabel: "Revisar",
    priorityClass: "border-mist/20 bg-white opacity-90",
  },
};

export function resolveAttentionVisual(kind: AttentionItem["kind"]): AttentionVisual {
  return KIND_MAP[kind] || KIND_MAP.SYSTEM;
}
