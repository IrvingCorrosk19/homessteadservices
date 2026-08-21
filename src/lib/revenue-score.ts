import config from "@/data/revenue-engine.json";
import { classifyPhone } from "@/lib/phone";

export const revenueConfig = config;

export const PIPELINE_STAGES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "SITE_VISIT_NEEDED",
  "QUOTE_PREPARATION",
  "QUOTE_SENT",
  "NEGOTIATION",
  "SCHEDULED",
  "JOB_IN_PROGRESS",
  "JOB_COMPLETED",
  "WON",
  "LOST",
  "NO_RESPONSE",
  "NOT_QUALIFIED",
  "CANCELLED",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type ScoreInput = {
  service: string;
  problem: string;
  phone: string;
  location: string;
  photoCount: number;
  returning: boolean;
  referral: boolean;
};

const VISIT = /visita|vengan|cotiz|presupuesto|mañana|hoy mismo|urgente|evaluaci[oó]n|reparar y pintar|pintar una pared/i;
const URGENCY = /urgente|hoy|ya no sirve|se inund|chispa|no enfría nada/i;
const TIMING = /mañana|tarde|después de|fin de semana|esta semana/i;
const LOC = /betania|san francisco|bella vista|paitilla|vía españa|panamá|tocumen|chorrera|corriente|zona/i;

const SITE_VISIT_SERVICES = new Set(["painting", "repairs", "remodeling", "ac", "multiple"]);

export function homesteadLeadScore(input: ScoreInput) {
  const w = revenueConfig.scoreWeights;
  const minChars = w.problemSpecificMinChars ?? 20;
  let score = 0;
  if (input.service && input.service !== "other") score += w.serviceIdentified;
  if ((input.problem || "").trim().length >= minChars) score += w.problemSpecific;
  if (VISIT.test(input.problem)) score += w.requestedVisitOrQuote;
  if (classifyPhone(input.phone).status === "VALID") score += w.providedPhone;
  if (input.location || LOC.test(input.problem)) score += w.providedLocation;
  if (SITE_VISIT_SERVICES.has(input.service)) score += w.siteVisitCategory ?? 0;
  if (input.photoCount > 0) score += w.providedPhotos;
  if (TIMING.test(input.problem)) score += w.desiredTiming;
  if (URGENCY.test(input.problem)) score += w.urgency;
  if (input.returning) score += w.returningCustomer;
  if (input.referral) score += w.referral;
  const temperature = score >= revenueConfig.hotScore ? "HOT" : score >= revenueConfig.warmScore ? "WARM" : "COLD";
  return { score, temperature };
}

export function isStopSignal(text: string) {
  return /\bno me interesa\b|\bno me escriban\b|\bya resolv[ií]\b|\bno me contacten\b|do not contact|unsubscribe|\bgracias,? no\b|\bno gracias\b/i.test(
    text,
  );
}

export function inboxToPipeline(status: string): PipelineStage {
  if (status === "CONTACTED") return "CONTACTED";
  if (status === "IN_PROGRESS") return "QUALIFIED";
  if (status === "COMPLETED") return "JOB_COMPLETED";
  if (status === "CANCELLED") return "CANCELLED";
  return "NEW";
}

export function nextActionFor(stage: PipelineStage, temperature: string, doNotContact: boolean, service = "") {
  if (doNotContact) return "NO_ACTION";
  if (stage === "LOST" || stage === "CANCELLED" || stage === "WON") return "NO_ACTION";
  if ((stage === "NEW" || stage === "QUALIFIED") && SITE_VISIT_SERVICES.has(service)) return "PROGRAM_SITE_VISIT";
  if (temperature === "HOT" && (stage === "NEW" || stage === "QUALIFIED")) return "CONTACT_HOT_LEAD";
  if (stage === "QUOTE_SENT" || stage === "NEGOTIATION") return "FOLLOW_UP_QUOTE";
  if (stage === "QUOTE_PREPARATION" || stage === "SITE_VISIT_NEEDED") return "PREPARE_QUOTE";
  if (stage === "SCHEDULED") return "CONFIRM_APPOINTMENT";
  if (stage === "JOB_COMPLETED") return "REQUEST_REVIEW";
  return temperature === "WARM" ? "FOLLOW_UP_QUOTE" : "NO_ACTION";
}

export function isRevenueEnabled() {
  return process.env.REVENUE_ENGINE_ENABLED !== "false";
}

export function isRevenueDryRun() {
  const value = process.env.REVENUE_ENGINE_DRY_RUN;
  if (value === undefined) return true;
  return value !== "false";
}

export function isAutoFollowUp() {
  return process.env.AUTO_FOLLOW_UP === "true";
}
