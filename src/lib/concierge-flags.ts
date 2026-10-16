export function conciergeModel() {
  return process.env.OPENAI_CONCIERGE_MODEL?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o";
}

export function conciergeApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

export function isConciergeEnabled() {
  return process.env.AI_CONCIERGE_ENABLED !== "false";
}

export function isConciergeDryRun() {
  const value = process.env.AI_CONCIERGE_DRY_RUN;
  if (value === undefined) return true;
  return value !== "false";
}

/** Conversation engine: legacy (in-process conciergeTurn) or n8n-coordinated. */
export type ConciergeEngine = "legacy" | "n8n";

export function conciergeEngine(): ConciergeEngine {
  const raw = (process.env.AI_CONCIERGE_ENGINE || "legacy").trim().toLowerCase();
  return raw === "n8n" ? "n8n" : "legacy";
}

/**
 * How the n8n engine runs tools:
 * - local: in-process coordinator (isolated / no remote n8n)
 * - remote: webhook to n8n, tools via /api/internal/concierge/*
 */
export type ConciergeN8nMode = "local" | "remote";

export function conciergeN8nMode(): ConciergeN8nMode {
  const raw = (process.env.AI_CONCIERGE_N8N_MODE || "local").trim().toLowerCase();
  return raw === "remote" ? "remote" : "local";
}

export function conciergeInternalSecret() {
  return process.env.CONCIERGE_INTERNAL_SECRET?.trim() || "";
}

export function conciergeN8nWebhookUrl() {
  return process.env.N8N_CONCIERGE_TURN_WEBHOOK_URL?.trim() || "";
}

export function conciergeTurnTimeoutMs() {
  const n = Number(process.env.AI_CONCIERGE_TURN_TIMEOUT_MS || "45000");
  return Number.isFinite(n) && n >= 5000 ? n : 45000;
}
