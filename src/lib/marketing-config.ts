import config from "@/data/marketing-intelligence.json";

export const marketingConfig = config;

export function isMarketingShadow() {
  const value = process.env.MARKETING_INTELLIGENCE_SHADOW ?? process.env.MARKETING_INTELLIGENCE_DRY_RUN;
  if (value === undefined) return true;
  return value !== "false";
}

export type IntentSignals = {
  jobWon?: number | null;
  qualifiedLead?: number | null;
  lead?: number | null;
  whatsappClick?: number | null;
  dm?: number | null;
  callClick?: number | null;
  contactClick?: number | null;
  profileVisit?: number | null;
  linkClick?: number | null;
  share?: number | null;
  save?: number | null;
  comment?: number | null;
  follow?: number | null;
  like?: number | null;
  impression?: number | null;
  reach?: number | null;
};

export type Confidence = "LOW" | "MEDIUM" | "HIGH" | "INSUFFICIENT";
export type LearningStage = "STAGE_0_COLD_START" | "STAGE_1_EXPLORATION" | "STAGE_2_LEARNING" | "STAGE_3_OPTIMIZED";

export const SERVICE_MAP: Record<string, string> = {
  ac: "AIR_CONDITIONING",
  plumbing: "PLUMBING",
  painting: "PAINTING",
  electrical: "ELECTRICAL",
  locksmith: "GENERAL_SERVICES",
  repairs: "REPAIR",
  remodeling: "REMODELING",
  multiple: "GENERAL_SERVICES",
  other: "OTHER",
  mantenimiento: "MAINTENANCE",
};

export function mapServiceCategory(raw: string) {
  const key = raw.trim().toLowerCase();
  if (!key) return "UNKNOWN";
  return SERVICE_MAP[key] || SERVICE_MAP[key.replace(/\s+/g, "_")] || "UNKNOWN";
}

export function confidenceFromSample(n: number): Confidence {
  if (n < marketingConfig.minSamples.low) return "INSUFFICIENT";
  if (n >= marketingConfig.minSamples.high) return "HIGH";
  if (n >= marketingConfig.minSamples.medium) return "MEDIUM";
  return "LOW";
}

export function learningStage(publishedWithEvidence: number): LearningStage {
  if (publishedWithEvidence >= marketingConfig.stagePublished.optimized) return "STAGE_3_OPTIMIZED";
  if (publishedWithEvidence >= marketingConfig.stagePublished.learning) return "STAGE_2_LEARNING";
  if (publishedWithEvidence >= marketingConfig.stagePublished.exploration) return "STAGE_1_EXPLORATION";
  return "STAGE_0_COLD_START";
}
