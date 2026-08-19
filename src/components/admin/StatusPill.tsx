import { STATUS_LABELS, type RequestStatus } from "@/lib/admin-format";

const tones: Record<RequestStatus, string> = {
  NEW: "bg-accent/15 text-accent-deep",
  CONTACTED: "bg-navy/10 text-navy",
  IN_PROGRESS: "bg-navy-soft/15 text-navy-soft",
  COMPLETED: "bg-mist/20 text-mist",
  CANCELLED: "bg-charcoal/10 text-mist",
};

export function StatusPill({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[0.68rem] font-medium tracking-[0.12em] uppercase ${tones[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
