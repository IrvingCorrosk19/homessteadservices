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
