import { conciergeKnowledge, conciergeSystemPrompt } from "@/lib/concierge-knowledge";
import { parseConciergeOutput, stripHallucinatedPrices, type ConciergeAiOutput } from "@/lib/concierge-schema";
import {
  addEvent,
  addMessage,
  createConversation,
  endTurn,
  getConversation,
  photoCount,
  recentMessages,
  recordUsage,
  savePhoto,
  touchConversation,
  tryBeginTurn,
  type ConversationState,
} from "@/lib/concierge-store";
import { notifyN8n } from "@/lib/n8n";
import { saveServiceRequest } from "@/lib/service-requests";
import { recordLead } from "@/lib/marketing-store";
import { whatsappHref } from "@/lib/site";
import { logError, logInfo } from "@/lib/log";
import type { SniffedImage } from "@/lib/photos";

const SAFETY_RE = /chispa|humo|olor a quemado|electroc|incendio|gas(olina)?\s*(fug|olor)/i;
const EXIT_RE = /\bno gracias\b|\bno,? gracias\b|deja as[ií]|no quiero/i;
const HUMAN_RE = /persona|humano|asesor|hablar con alguien|un t[eé]cnico/i;
const INJECTION_RE = /ignore (all|previous)|olvida( tus)? instrucciones|system prompt|api key|act[úu]a como/i;

function model() {
  return process.env.OPENAI_CONCIERGE_MODEL?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o";
}

function apiKey() {
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

function fallbackReply(message: string) {
  if (SAFETY_RE.test(message)) {
    return "Si hay chispas, humo o riesgo inmediato, aléjate y usa los servicios de emergencia. Cuando estés en un lugar seguro, dime qué ocurrió y en qué zona estás para dejarlo anotado al equipo.";
  }
  if (INJECTION_RE.test(message)) {
    return "Estoy aquí para ayudarte con los servicios de Homestead Services. Cuéntame qué necesitas resolver en tu propiedad.";
  }
  if (EXIT_RE.test(message)) {
    return "Claro, lo dejamos ahí. Cuando quieras retomar una reparación o mantenimiento, aquí estamos.";
  }
  return "Puedo seguir registrando tu solicitud. Cuéntame brevemente qué servicio necesitas y nuestro equipo podrá darle seguimiento.";
}

async function completeJson(messages: Array<{ role: string; content: unknown }>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model(),
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`openai_${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content || "";
    return {
      parsed: parseConciergeOutput(JSON.parse(content)),
      usage: data.usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

function mergeState(state: ConversationState, extracted: ConciergeAiOutput["extracted"], service: string) {
  return {
    ...state,
    service: state.service || (service === "unknown" ? "" : service),
    problem: extracted.problemSummary || state.problem,
    location: extracted.location || state.location,
    name: extracted.name || state.name,
    phone: extracted.phone || state.phone,
    email: extracted.email || state.email,
    preferredTime: extracted.preferredTime || state.preferredTime,
  };
}

function canCreateLead(state: ConversationState) {
  const digits = state.phone.replace(/\D/g, "");
  return Boolean(state.name.trim() && digits.length >= 7 && (state.problem || state.service));
}

function createLeadIfNeeded(conversationId: string, dryRun: boolean, state: ConversationState, summary: string) {
  const current = getConversation(conversationId);
  if (!current || current.leadPublicId) return current?.leadPublicId || "";
  if (!canCreateLead(state)) return "";
  if (dryRun) {
    const fake = `DRY-${conversationId.slice(0, 8)}`;
    touchConversation(conversationId, { leadPublicId: fake, state });
    addEvent(conversationId, "LEAD_CREATED");
    return fake;
  }
  const service = state.service && state.service !== "unknown" ? state.service : "other";
  const location = state.location ? `Zona: ${state.location}. ` : "";
  const when = state.preferredTime ? `Preferencia de horario: ${state.preferredTime}. ` : "";
  const message = [
    "[Asistente web Homestead]",
    summary || state.problem,
    location + when,
    `Servicio: ${service}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const saved = saveServiceRequest({
    name: state.name.trim(),
    phone: state.phone.trim(),
    email: state.email.trim() || conciergeKnowledge().email || "servicios@homestead.lat",
    property: "other",
    service: service === "unknown" ? "other" : service,
    message,
    photos: [],
  });
  touchConversation(conversationId, { leadPublicId: saved.publicId, state });
  addEvent(conversationId, "LEAD_CREATED");
  recordLead({ publicId: saved.publicId, channel: "website_ai_concierge", outcome: "CONTACT" });
  void notifyN8n(saved);
  logInfo("ConciergeLeadCreated", { contentJobId: saved.publicId, stage: conversationId.slice(0, 8) });
  return saved.publicId;
}

export async function conciergeTurn(input: {
  conversationId: string;
  message: string;
  utm?: Record<string, string>;
}) {
  const conversation = getConversation(input.conversationId);
  if (!conversation) return { ok: false as const, error: "session" };
  if (!tryBeginTurn(input.conversationId)) {
    return { ok: false as const, error: "busy" };
  }
  try {
    const text = input.message.trim().slice(0, 2000);
    addMessage(input.conversationId, "user", text);
    addEvent(input.conversationId, "CHAT_MESSAGE");
    const knowledge = conciergeKnowledge();
    let parsed: ConciergeAiOutput | null = null;
    if (apiKey()) {
      try {
        const history = recentMessages(input.conversationId, 12);
        const result = await completeJson([
          { role: "system", content: conciergeSystemPrompt(knowledge) },
          {
            role: "system",
            content: `Estado interno (no lo preguntes de nuevo si ya está): ${JSON.stringify({
              ...conversation.state,
              summary: conversation.summary,
              photos: photoCount(input.conversationId),
              lead: conversation.leadPublicId,
            })}`,
          },
          ...history.map((item) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            content: item.body,
          })),
        ]);
        parsed = result.parsed;
        if (result.usage) {
          recordUsage(
            input.conversationId,
            result.usage.prompt_tokens || 0,
            result.usage.completion_tokens || 0,
          );
        }
      } catch (error) {
        logError("ConciergeOpenAiFailed", {
          stage: error instanceof Error ? error.name : "error",
          contentJobId: input.conversationId.slice(0, 8),
        });
      }
    }

    if (INJECTION_RE.test(text)) {
      parsed = {
        ...(parsed || {
          reply: fallbackReply(text),
          intent: "OTHER",
          serviceCategory: "unknown",
          funnelStage: "DISCOVERY",
          leadTemperature: "COLD",
          nextAction: "ASK_SERVICE_QUESTION",
          shouldAskContact: false,
          shouldOfferWhatsApp: false,
          requiresHuman: false,
          safetyFlag: false,
          quickReplies: [],
          extracted: {
            name: "",
            phone: "",
            email: "",
            location: "",
            preferredTime: "",
            problemSummary: "",
          },
        }),
        reply: "Estoy aquí para ayudarte con los servicios de Homestead Services. Cuéntame qué necesitas resolver en tu propiedad.",
        nextAction: "ASK_SERVICE_QUESTION",
      };
    }
    if (SAFETY_RE.test(text)) {
      parsed = {
        ...(parsed as ConciergeAiOutput),
        reply:
          parsed?.reply && parsed.safetyFlag
            ? parsed.reply
            : fallbackReply(text),
        safetyFlag: true,
        leadTemperature: "HOT",
        funnelStage: "SAFETY",
        nextAction: "ESCALATE_HUMAN",
        intent: "EMERGENCY",
        quickReplies: parsed?.quickReplies?.length ? parsed.quickReplies : ["Ya estoy en un lugar seguro"],
        extracted: parsed?.extracted || {
          name: "",
          phone: "",
          email: "",
          location: "",
          preferredTime: "",
          problemSummary: "",
        },
        shouldAskContact: true,
        shouldOfferWhatsApp: false,
        requiresHuman: true,
        serviceCategory: parsed?.serviceCategory || "electrical",
      };
    }
    if (!parsed) {
      parsed = {
        reply: fallbackReply(text),
        intent: EXIT_RE.test(text) ? "OTHER" : HUMAN_RE.test(text) ? "HUMAN_REQUEST" : "OTHER",
        serviceCategory: "unknown",
        funnelStage: EXIT_RE.test(text) ? "ABANDONED" : "DISCOVERY",
        leadTemperature: "COLD",
        nextAction: EXIT_RE.test(text) ? "CLOSE" : "ASK_SERVICE_QUESTION",
        shouldAskContact: false,
        shouldOfferWhatsApp: false,
        requiresHuman: HUMAN_RE.test(text),
        safetyFlag: SAFETY_RE.test(text),
        quickReplies: EXIT_RE.test(text) ? [] : ["Aire acondicionado", "Plomería", "Electricidad"],
        extracted: {
          name: "",
          phone: "",
          email: "",
          location: "",
          preferredTime: "",
          problemSummary: "",
        },
      };
    }

    const priced = stripHallucinatedPrices(parsed.reply);
    parsed.reply = priced.text;
    const state = mergeState(conversation.state, parsed.extracted, parsed.serviceCategory);
    state.funnelStage = parsed.funnelStage;
    state.leadTemperature = parsed.leadTemperature;
    const summary =
      [
        state.problem && `Necesidad: ${state.problem}`,
        state.service && `Servicio: ${state.service}`,
        state.location && `Zona: ${state.location}`,
        state.name && `Nombre: ${state.name}`,
        state.preferredTime && `Horario: ${state.preferredTime}`,
      ]
        .filter(Boolean)
        .join(". ") || conversation.summary;

    let leadId = conversation.leadPublicId;
    const wantsLead =
      parsed.nextAction === "CREATE_LEAD" ||
      parsed.nextAction === "OFFER_WHATSAPP" ||
      parsed.nextAction === "ESCALATE_HUMAN" ||
      parsed.funnelStage === "LEAD_CREATED" ||
      parsed.funnelStage === "HANDOFF";
    if (wantsLead || (parsed.shouldAskContact && canCreateLead(state))) {
      if (canCreateLead(state)) {
        leadId = createLeadIfNeeded(input.conversationId, isConciergeDryRun(), state, summary);
      }
    }

    touchConversation(input.conversationId, { state, summary, leadPublicId: leadId });
    addMessage(input.conversationId, "assistant", parsed.reply);

    const wa =
      knowledge.whatsappConfigured && leadId && !leadId.startsWith("DRY-")
        ? whatsappHref(`Hola, vengo del asistente de Homestead Services. Mi solicitud es ${leadId}.`)
        : null;

    return {
      ok: true as const,
      reply: parsed.reply,
      chips: parsed.quickReplies,
      nextAction: parsed.nextAction,
      leadId: leadId && !leadId.startsWith("DRY-") ? leadId : null,
      dryLead: Boolean(leadId?.startsWith("DRY-")),
      whatsappUrl: parsed.shouldOfferWhatsApp || parsed.nextAction === "OFFER_WHATSAPP" ? wa : null,
      contactUrl: "/contact",
      ended: parsed.nextAction === "CLOSE",
      requiresHuman: parsed.requiresHuman,
    };
  } finally {
    endTurn(input.conversationId);
  }
}

export function attachConciergePhoto(conversationId: string, bytes: Buffer, sniffed: SniffedImage) {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;
  if (photoCount(conversationId) >= 4) return { error: "limit" as const };
  const stored = savePhoto(conversationId, bytes, sniffed);
  const state = { ...conversation.state, photoCount: conversation.state.photoCount + 1 };
  touchConversation(conversationId, { state });
  addEvent(conversationId, "PHOTO_ATTACHED");
  addMessage(conversationId, "user", `[Foto adjunta: ${stored}]`);
  return { stored };
}

export function startConcierge(ip: string, utm: Record<string, string>) {
  const id = createConversation(ip, utm, isConciergeDryRun());
  addEvent(id, "CHAT_OPENED");
  return id;
}
