function positiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export const JOB_ID_PATTERN = /^HJ-\d{4}-\d{6}$/;

export const JOB_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SATISFACTION_RESPONSES = ["EXCELLENT", "GOOD", "NEEDS_HELP"] as const;
export type SatisfactionResponse = (typeof SATISFACTION_RESPONSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  SCHEDULED: "Programado",
  IN_PROGRESS: "En proceso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  NO_SHOW: "No se presentó",
};

export const SATISFACTION_LABELS: Record<SatisfactionResponse, string> = {
  EXCELLENT: "Excelente",
  GOOD: "Bien",
  NEEDS_HELP: "Necesito ayuda",
};

export function jobConfig() {
  return {
    followupDelayMinutes: positiveInt(process.env.POST_SERVICE_FOLLOWUP_DELAY_MINUTES, 120),
    tokenTtlHours: positiveInt(process.env.SATISFACTION_TOKEN_TTL_HOURS, 168),
    reviewReminderHours: positiveInt(process.env.HOMESTEAD_REVIEW_REMINDER_HOURS, 0),
    pageSize: 5,
  };
}

export function configuredReviewUrl() {
  const url = (process.env.HOMESTEAD_REVIEW_URL || "").trim();
  if (!/^https:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function isJobStatus(value: string): value is JobStatus {
  return JOB_STATUSES.includes(value as JobStatus);
}

export function isSatisfactionResponse(value: string): value is SatisfactionResponse {
  return SATISFACTION_RESPONSES.includes(value as SatisfactionResponse);
}

export function isPositiveSatisfaction(value: string) {
  return value === "EXCELLENT" || value === "GOOD";
}
