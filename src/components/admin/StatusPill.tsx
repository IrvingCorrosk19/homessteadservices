import { type RequestStatus } from "@/lib/admin-format";
import { opsStatusLabel, resolveRequestVisual } from "@/lib/request-status-visual";

type StatusPillProps = {
  status: RequestStatus;
  slaEscalatedAt?: string | null;
  slaFirstAlertedAt?: string | null;
  compact?: boolean;
};

export function StatusPill({ status, slaEscalatedAt, slaFirstAlertedAt, compact = false }: StatusPillProps) {
  const visual = resolveRequestVisual({ status, slaEscalatedAt, slaFirstAlertedAt });
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[0.68rem] font-semibold tracking-[0.1em] uppercase ${visual.pillClass} ${compact ? "px-2 py-0.5 text-[0.62rem]" : ""}`}
      aria-label={visual.ariaLabel}
      title={visual.ariaLabel}
    >
      <span aria-hidden className="shrink-0 text-[0.72rem] leading-none">
        {visual.icon}
      </span>
      <span className="truncate">{visual.label || opsStatusLabel(status)}</span>
    </span>
  );
}
