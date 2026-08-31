import type { AutonomyLevel } from "@/lib/autonomous/types";

function positiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function flag(value: string | undefined, defaultOn = false) {
  if (value === undefined) return defaultOn;
  return value === "true" || value === "1";
}

export function autonomousConfig() {
  return {
    enabled: flag(process.env.AUTONOMOUS_OPERATIONS_ENABLED, true),
    notificationsEnabled: flag(process.env.AUTONOMOUS_NOTIFICATIONS_ENABLED, true),
    lowRiskActionsEnabled: flag(process.env.AUTONOMOUS_LOW_RISK_ACTIONS_ENABLED, false),
    dryRun: flag(process.env.AUTONOMOUS_OPERATIONS_DRY_RUN, false),
    aiEnrichmentEnabled: flag(process.env.AUTONOMOUS_AI_ENRICHMENT, true),
    defaultAutonomyLevel: (process.env.AUTONOMOUS_DEFAULT_LEVEL ||
      "AUTONOMY_L2_RECOMMEND") as AutonomyLevel,
    requestAgingHours: positiveInt(process.env.AUTONOMOUS_REQUEST_AGING_HOURS, 24),
    upcomingWindowHours: positiveInt(process.env.AUTONOMOUS_UPCOMING_HOURS, 24),
    preVisitWindowHours: positiveInt(process.env.AUTONOMOUS_PREVISIT_HOURS, 24),
    notificationCooldownMinutes: positiveInt(process.env.AUTONOMOUS_NOTIFY_COOLDOWN_MINUTES, 60),
    ackReminderHours: positiveInt(process.env.AUTONOMOUS_ACK_REMINDER_HOURS, 24),
    morningBriefHour: positiveInt(process.env.AUTONOMOUS_MORNING_BRIEF_HOUR, 7),
    endOfDayBriefHour: positiveInt(process.env.AUTONOMOUS_EOD_BRIEF_HOUR, 18),
    maxSignalsPerScan: positiveInt(process.env.AUTONOMOUS_MAX_SIGNALS_PER_SCAN, 200),
    maxAiEnrichmentsPerScan: positiveInt(process.env.AUTONOMOUS_MAX_AI_ENRICH_PER_SCAN, 10),
    actionTokenTtlMinutes: positiveInt(process.env.AUTONOMOUS_ACTION_TOKEN_TTL_MINUTES, 30),
  };
}

export function isAutonomousEnabled() {
  const cfg = autonomousConfig();
  return cfg.enabled;
}
