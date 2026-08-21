import { businessTimezone } from "@/lib/appointment-time";

export const REQUEST_STATUSES = [
  "NEW",
  "CONTACTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  NEW: "Nueva",
  CONTACTED: "Contactada",
  IN_PROGRESS: "En proceso",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export const PUBLIC_ID_PATTERN = /^HS-\d{4}-\d{6}$/;

export function isRequestStatus(value: string): value is RequestStatus {
  return REQUEST_STATUSES.includes(value as RequestStatus);
}

export function formatPanamaDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: businessTimezone(),
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatPanamaDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: businessTimezone(),
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
