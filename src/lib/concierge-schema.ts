export const INTENTS = [
  "EMERGENCY",
  "REPAIR",
  "MAINTENANCE",
  "INSTALLATION",
  "QUOTE",
  "INFORMATION",
  "COMPARISON",
  "SCHEDULING",
  "HUMAN_REQUEST",
  "OTHER",
] as const;

export const FUNNEL_STAGES = [
  "DISCOVERY",
  "PROBLEM_UNDERSTANDING",
  "SERVICE_MATCH",
  "QUALIFICATION",
  "INTENT_DETECTION",
  "CONTACT_CAPTURE",
  "CONTACT_PENDING",
  "HANDOFF",
  "LEAD_CREATED",
  "FAQ",
  "NOT_SUPPORTED",
  "SAFETY",
  "HUMAN_REQUEST",
  "ABANDONED",
] as const;

export const TEMPERATURES = ["COLD", "WARM", "HOT"] as const;
export const NEXT_ACTIONS = [
  "ASK_SERVICE_QUESTION",
  "ASK_LOCATION",
  "ASK_PHOTO",
  "ASK_TIMING",
  "ASK_CONTACT",
  "ASK_COMPLETE_CONTACT",
  "ASK_VISIT_PREFERENCE",
  "OFFER_WHATSAPP",
  "CREATE_LEAD",
  "ESCALATE_HUMAN",
  "ANSWER_BUSINESS_QUESTION",
  "CLOSE",
] as const;

export const SERVICES = [
  "ac",
  "plumbing",
  "painting",
  "electrical",
  "locksmith",
  "repairs",
  "remodeling",
  "multiple",
  "other",
  "unknown",
] as const;

export type ConciergeAiOutput = {
  reply: string;
  intent: (typeof INTENTS)[number];
  serviceCategory: (typeof SERVICES)[number];
  funnelStage: (typeof FUNNEL_STAGES)[number];
  leadTemperature: (typeof TEMPERATURES)[number];
  nextAction: (typeof NEXT_ACTIONS)[number];
  shouldAskContact: boolean;
  shouldOfferWhatsApp: boolean;
  requiresHuman: boolean;
  safetyFlag: boolean;
  quickReplies: string[];
  extracted: {
    name: string;
    phone: string;
    email: string;
    location: string;
    preferredTime: string;
    problemSummary: string;
  };
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function parseConciergeOutput(raw: unknown): ConciergeAiOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!reply) return null;
  const extractedRaw = (data.extracted && typeof data.extracted === "object" ? data.extracted : {}) as Record<
    string,
    unknown
  >;
  const replies = Array.isArray(data.quickReplies) ? data.quickReplies : [];
  return {
    reply: reply.slice(0, 1200),
    intent: oneOf(data.intent, INTENTS, "OTHER"),
    serviceCategory: oneOf(data.serviceCategory, SERVICES, "unknown"),
    funnelStage: oneOf(data.funnelStage, FUNNEL_STAGES, "DISCOVERY"),
    leadTemperature: oneOf(data.leadTemperature, TEMPERATURES, "COLD"),
    nextAction: oneOf(data.nextAction, NEXT_ACTIONS, "ASK_SERVICE_QUESTION"),
    shouldAskContact: Boolean(data.shouldAskContact),
    shouldOfferWhatsApp: Boolean(data.shouldOfferWhatsApp),
    requiresHuman: Boolean(data.requiresHuman),
    safetyFlag: Boolean(data.safetyFlag),
    quickReplies: replies
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/<[^>]+>/g, "").trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 4),
    extracted: {
      name: String(extractedRaw.name || "").slice(0, 80),
      phone: String(extractedRaw.phone || "").slice(0, 40),
      email: String(extractedRaw.email || "").slice(0, 120),
      location: String(extractedRaw.location || "").slice(0, 120),
      preferredTime: String(extractedRaw.preferredTime || "").slice(0, 80),
      problemSummary: String(extractedRaw.problemSummary || "").slice(0, 500),
    },
  };
}

const PRICE_CLAIM = /\$\s*\d|\b\d+\s*(usd|balboas?|d[oó]lares?)\b|\b(desde|cuesta|cobramos)\s+\d+/i;

export function stripHallucinatedPrices(reply: string) {
  if (!PRICE_CLAIM.test(reply)) return { text: reply, removed: false };
  return {
    text: "Depende del trabajo específico. Para no darte un precio que después cambie, cuéntame primero qué hay que revisar o instalar.",
    removed: true,
  };
}
