import type { ContentStatus } from "@/lib/content-types";

export const CONTROL_DISPLAY_STATES = [
  "pending_approval",
  "approved_unscheduled",
  "scheduled",
  "partially_published",
  "published",
  "needs_review",
  "rejected",
  "cancelled",
  "processing",
  "other",
] as const;

export type ControlDisplayState = (typeof CONTROL_DISPLAY_STATES)[number];

export type PlatformPublicationView = {
  platform: string;
  status: string;
  dryRun: boolean;
  error: string;
  permalink: string;
};

export function controlDisplayLabel(state: ControlDisplayState) {
  switch (state) {
    case "pending_approval":
      return "Pendiente de aprobación";
    case "approved_unscheduled":
      return "Aprobado sin programar";
    case "scheduled":
      return "Programado";
    case "partially_published":
      return "Publicado parcialmente";
    case "published":
      return "Publicado";
    case "needs_review":
      return "Necesita revisión";
    case "rejected":
      return "Rechazado";
    case "cancelled":
      return "Cancelado";
    case "processing":
      return "En proceso";
    default:
      return "Otro estado";
  }
}

export function controlDisplayClass(state: ControlDisplayState) {
  switch (state) {
    case "pending_approval":
      return "border-amber-700/25 bg-amber-50 text-amber-950";
    case "approved_unscheduled":
      return "border-sky-800/20 bg-sky-50 text-sky-950";
    case "scheduled":
      return "border-navy/20 bg-navy/5 text-navy";
    case "partially_published":
      return "border-orange-800/25 bg-orange-50 text-orange-950";
    case "published":
      return "border-emerald-800/20 bg-emerald-50 text-emerald-950";
    case "needs_review":
      return "border-rose-800/25 bg-rose-50 text-rose-950";
    case "rejected":
    case "cancelled":
      return "border-navy/10 bg-cream-deep text-mist";
    case "processing":
      return "border-navy/15 bg-white text-navy-soft";
    default:
      return "border-navy/10 bg-white text-charcoal";
  }
}

function liveRows(publications: PlatformPublicationView[]) {
  return publications.filter((row) => !row.dryRun);
}

export function deriveControlDisplayState(input: {
  status: ContentStatus;
  publications: PlatformPublicationView[];
}): ControlDisplayState {
  const live = liveRows(input.publications);
  const published = live.filter((row) => row.status === "PUBLISHED");
  const failed = live.filter((row) => row.status === "FAILED");
  const uncertain = live.filter((row) => row.status === "UNCERTAIN" || row.status === "PUBLISHING");

  if (published.length > 0 && (failed.length > 0 || uncertain.length > 0)) {
    return "partially_published";
  }
  if (published.length === 1 && live.length >= 2) return "partially_published";
  if (input.status === "NEEDS_REVIEW" || input.status === "FAILED") return "needs_review";
  if (input.status === "PUBLISHED" || (published.length >= 2 && failed.length === 0)) {
    return "published";
  }
  if (input.status === "APPROVED") return "approved_unscheduled";
  if (input.status === "SCHEDULED") return "scheduled";
  if (input.status === "AWAITING_APPROVAL" || input.status === "READY_FOR_REVIEW") {
    return "pending_approval";
  }
  if (input.status === "REJECTED") return "rejected";
  if (input.status === "CANCELLED") return "cancelled";
  if (
    input.status === "PROCESSING" ||
    input.status === "PUBLISHING" ||
    input.status === "RECEIVING" ||
    input.status === "DRAFT"
  ) {
    return "processing";
  }
  if (input.status === "SIMULATED") return "published";
  return "other";
}

export function humanPublicationError(error: string) {
  const map: Record<string, string> = {
    simulated_facebook_denied: "Facebook simuló un rechazo. Instagram no se tocó.",
    simulated_instagram_denied: "Instagram simuló un rechazo. Facebook no se tocó.",
    simulated_graph_denied: "Ambas redes simularon un rechazo.",
    pages_read_engagement: "Meta rechazó la Page: faltan permisos de la Página.",
    image_missing: "No hay imagen aprobada para publicar.",
    stale_version: "La versión aprobada ya no es la vigente.",
    paused: "El estudio está en pausa.",
    locked: "Ya hay una publicación en curso.",
    unconfirmed_claims: "El texto tiene un claim comercial sin confirmar.",
  };
  const key = Object.keys(map).find((item) => error.includes(item));
  if (key) return map[key];
  if (!error.trim()) return "Sin detalle de error.";
  return error.replace(/access_token=[^&\s]+/gi, "[redactado]").slice(0, 180);
}
