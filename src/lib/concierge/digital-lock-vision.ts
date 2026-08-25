import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homesteadDataDir } from "@/lib/service-requests";
import { conciergeApiKey, conciergeModel } from "@/lib/concierge-flags";
import { logError, logInfo } from "@/lib/log";
import type { ConversationState } from "@/lib/concierge-store";

export type DigitalLockView = "front" | "inside" | "edge" | "unknown";
export type DigitalLockPhotoStatus = "PASS" | "MISSING" | "RETAKE" | "REJECTED";
export type DigitalLockQuality = "good" | "usable" | "poor";
export type DigitalLockCompatibility =
  | "UNKNOWN"
  | "NEEDS_MORE_INFO"
  | "LIKELY_COMPATIBLE"
  | "REQUIRES_TECHNICIAN_REVIEW"
  | "PHOTO_PRECHECK_INCOMPLETE";

export type DigitalLockPhotoEvidence = {
  photoId: string;
  status: DigitalLockPhotoStatus;
  imageType: DigitalLockView;
  quality: DigitalLockQuality;
  confidence: number;
  observations: string[];
  missingVisualInformation: string[];
  sha256?: string;
  reasonIfRejected?: string;
  containsDoor?: boolean;
  containsLock?: boolean;
  usable?: boolean;
};

export type DigitalLockRejectedPhoto = {
  photoId: string;
  sha256?: string;
  reason: string;
  viewType: DigitalLockView;
  confidence: number;
};

export type DigitalLockChecklist = {
  active: boolean;
  front: DigitalLockPhotoEvidence | null;
  inside: DigitalLockPhotoEvidence | null;
  edge: DigitalLockPhotoEvidence | null;
  rejected: DigitalLockRejectedPhoto[];
  analyzedPhotoIds: string[];
  analysisByHash: Record<string, VisionInspectionResult>;
  measurementRequired: boolean;
  measurementComplete: boolean;
  compatibility: DigitalLockCompatibility;
  doorNotes: string;
  lockNotes: string;
  lastPhotoId: string;
};

export type VisionInspectionResult = {
  imageType: DigitalLockView;
  containsDoor: boolean;
  containsLock: boolean;
  containsLatchOrBolt: boolean;
  doorVisible: boolean;
  lockVisible: boolean;
  relevantAreaVisible: boolean;
  usableForDigitalLockAssessment: boolean;
  quality: DigitalLockQuality;
  blurred: boolean;
  tooDark: boolean;
  tooBright: boolean;
  tooClose: boolean;
  tooFar: boolean;
  criticalAreaCropped: boolean;
  duplicateSuspected: boolean;
  confidence: number;
  observations: string[];
  missingVisualInformation: string[];
  reasonIfRejected: string;
  doorTypeGuess: string;
  lockFeaturesObserved: string[];
  measurementNeeded: boolean;
  measurementSafeToInfer: boolean;
};

/** Configurable confidence gates */
export const DIGITAL_LOCK_VISION_ACCEPT_MIN = Number(process.env.DIGITAL_LOCK_VISION_ACCEPT_MIN || 0.62);
export const DIGITAL_LOCK_VISION_REVIEW_MIN = Number(process.env.DIGITAL_LOCK_VISION_REVIEW_MIN || 0.45);

const DIGITAL_LOCK_INTENT =
  /\b(cerradura\s+digital|cerradura\s+inteligente|smart\s*lock|huella|fingerprint|teclado|keypad|quiero\s+(comprar|poner|instalar|cambiar).{0,40}cerradura|cerradura.{0,40}(digital|inteligente|huella))\b/i;

export function emptyDigitalLockChecklist(): DigitalLockChecklist {
  return {
    active: false,
    front: null,
    inside: null,
    edge: null,
    rejected: [],
    analyzedPhotoIds: [],
    analysisByHash: {},
    measurementRequired: false,
    measurementComplete: false,
    compatibility: "UNKNOWN",
    doorNotes: "",
    lockNotes: "",
    lastPhotoId: "",
  };
}

/** Tolerate common typos: cerddaura digitapl → cerradura digital */
export function normalizeDigitalLockText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/cer+d+a+uras?/g, "cerradura")
    .replace(/cer+r?a?d+a?uras?/g, "cerradura")
    .replace(/digit+a+[pl]*|digit+al+/g, "digital")
    .replace(/intelig+ente/g, "inteligente");
}

export function detectDigitalLockPurchaseIntent(text: string) {
  const raw = text || "";
  const n = normalizeDigitalLockText(raw);
  if (DIGITAL_LOCK_INTENT.test(raw) || DIGITAL_LOCK_INTENT.test(n)) return true;
  if (/\bcerradura\b/.test(n) && /\b(digital|inteligente|huella|smart\s*lock|teclado|keypad)\b/.test(n)) return true;
  // fuzzy: misspelled cerradura + digit*
  if (/cer\w{2,8}ura/.test(n) && /digit/.test(n)) return true;
  if (/\b(comprar|instalar|poner|cambiar).{0,30}cer\w{2,8}ura/.test(n) && /digit|intelig|huella|smart/.test(n)) {
    return true;
  }
  return false;
}

export function historySuggestsDigitalLockFlow(messages: Array<{ role: string; body: string }>) {
  const blob = messages
    .slice(-12)
    .map((item) => item.body)
    .join("\n");
  if (detectDigitalLockPurchaseIntent(blob)) return true;
  if (/frente.{0,40}interior.{0,40}canto|canto del pestillo|cerradura digital|instalaci[oó]n de (una )?cerradura digital/i.test(blob)) {
    return true;
  }
  return false;
}

export function getDigitalLockChecklist(state: ConversationState): DigitalLockChecklist {
  const raw = state.facts?.digitalLockChecklist;
  if (!raw) return emptyDigitalLockChecklist();
  try {
    const parsed = JSON.parse(raw) as DigitalLockChecklist;
    return {
      ...emptyDigitalLockChecklist(),
      ...parsed,
      rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
      analyzedPhotoIds: Array.isArray(parsed.analyzedPhotoIds) ? parsed.analyzedPhotoIds : [],
      analysisByHash: parsed.analysisByHash && typeof parsed.analysisByHash === "object" ? parsed.analysisByHash : {},
    };
  } catch {
    return emptyDigitalLockChecklist();
  }
}

export function setDigitalLockChecklist(state: ConversationState, checklist: DigitalLockChecklist): ConversationState {
  return {
    ...state,
    facts: {
      ...(state.facts || {}),
      digitalLockChecklist: JSON.stringify(checklist),
      digitalLockFlow: checklist.active ? "1" : "",
    },
  };
}

export function activateDigitalLockFlow(state: ConversationState): ConversationState {
  const current = getDigitalLockChecklist(state);
  if (current.active) return state;
  const next = emptyDigitalLockChecklist();
  next.active = true;
  next.compatibility = "PHOTO_PRECHECK_INCOMPLETE";
  let updated = setDigitalLockChecklist(state, next);
  updated = {
    ...updated,
    primaryService: "locksmith",
    service: "locksmith",
    bookingStrategy: "PHOTO_REVIEW_FIRST",
    bookingIntent: false,
    problem: updated.problem || "Compra/instalación de cerradura digital",
    facts: {
      ...(updated.facts || {}),
      need: "cerradura digital — compra/instalación",
    },
  };
  return updated;
}

export function resetDigitalLockEvidence(state: ConversationState): ConversationState {
  const current = getDigitalLockChecklist(state);
  if (!current.active) return state;
  return setDigitalLockChecklist(state, {
    ...emptyDigitalLockChecklist(),
    active: true,
    compatibility: "PHOTO_PRECHECK_INCOMPLETE",
  });
}

function passStatus(evidence: DigitalLockPhotoEvidence | null) {
  return evidence?.status === "PASS";
}

export function digitalLockMissingViews(checklist: DigitalLockChecklist): DigitalLockView[] {
  const missing: DigitalLockView[] = [];
  if (!passStatus(checklist.front)) missing.push("front");
  if (!passStatus(checklist.inside)) missing.push("inside");
  if (!passStatus(checklist.edge)) missing.push("edge");
  return missing;
}

export function digitalLockPhotosComplete(checklist: DigitalLockChecklist) {
  return digitalLockMissingViews(checklist).length === 0;
}

export function digitalLockValidEvidenceCount(checklist: DigitalLockChecklist) {
  return (["front", "inside", "edge"] as const).filter((view) => passStatus(checklist[view])).length;
}

function viewLabel(view: DigitalLockView) {
  if (view === "front") return "frente / exterior";
  if (view === "inside") return "parte interior";
  if (view === "edge") return "canto / pestillo";
  return "vista";
}

export function digitalLockIntroReply() {
  return "Claro, te ayudamos con la cerradura digital. Para revisar qué opción puede adaptarse a tu puerta necesito ver tres partes: una foto de frente, otra del interior y una del canto donde está el pestillo. Puedes mandármelas una por una; yo te digo si están bien o si necesito ver algo mejor.";
}

export function digitalLockHumanReply(
  checklist: DigitalLockChecklist,
  last: VisionInspectionResult,
  assigned: DigitalLockView,
): string {
  const assignedPass = assigned !== "unknown" && checklist[assigned]?.status === "PASS";

  if (!last.containsDoor || !last.usableForDigitalLockAssessment || last.imageType === "unknown" || last.quality === "poor") {
    if (last.duplicateSuspected) {
      const missing = digitalLockMissingViews(checklist);
      if (missing.length) {
        return `Parece la misma vista que ya tengo. Solo me falta: ${missing.map(viewLabel).join(", ")}.`;
      }
    }
    if (last.blurred) {
      return "Esta foto salió un poco borrosa y no me deja ver bien la cerradura. ¿Puedes tomar otra más nítida, con buena luz?";
    }
    if (last.tooDark) {
      return "Esta está muy oscura. ¿Puedes tomar otra con más luz, mostrando la cerradura completa?";
    }
    if (last.tooClose) {
      return "Está demasiado cerca y no alcanzo a ver el contexto de la puerta. ¿Puedes tomar otra un poco más atrás?";
    }
    if (last.tooFar) {
      return "Está demasiado lejos; casi no se distingue la cerradura. ¿Puedes acercarte un poco más?";
    }
    if (assigned === "edge" && last.containsDoor) {
      return "Esta parece el canto, pero no alcanzo a ver bien el pestillo. ¿Puedes tomar otra mostrando el canto donde sale el pestillo?";
    }
    return "Parece que esta imagen no muestra la puerta o la cerradura que necesitamos revisar. Envíame una foto de frente de la puerta donde se vea completa la cerradura o el área donde quieres instalarla.";
  }

  if (last.duplicateSuspected && !assignedPass) {
    const missing = digitalLockMissingViews(checklist);
    if (missing.length) {
      return `Parece la misma vista que ya tengo. Ya cuento con lo que me sirve hasta ahora. Solo me falta: ${missing.map(viewLabel).join(", ")}.`;
    }
  }

  if (!assignedPass) {
    return "Esta no me deja ver bien la cerradura. ¿Puedes tomarla mostrando un poco más de la puerta y la cerradura completa?";
  }

  const missing = digitalLockMissingViews(checklist);
  if (!missing.length) {
    if (checklist.measurementRequired && !checklist.measurementComplete) {
      return "Perfecto, ya tengo las tres vistas. Para confirmar mejor la compatibilidad me falta una medida: el grosor de la puerta. ¿Me puedes indicar aproximadamente cuántos milímetros tiene?";
    }
    if (checklist.compatibility === "REQUIRES_TECHNICIAN_REVIEW") {
      return "Perfecto, ya tengo las tres vistas. Prefiero que uno de nuestros técnicos revise este tipo de instalación antes de recomendarte un modelo, para no venderte algo que no te sirva.";
    }
    return "Perfecto, ya tengo las tres vistas de la puerta y la cerradura. Con eso podemos orientar la mejor opción para tu caso.";
  }
  if (missing.length === 1) {
    return `Perfecto, esta me sirve como ${viewLabel(assigned)}. Solo me falta una foto del ${viewLabel(missing[0])}.`;
  }
  return `Perfecto, esta me sirve como ${viewLabel(assigned)}. Todavía me faltan: ${missing.map(viewLabel).join(" y ")}.`;
}

/**
 * CRITICAL: LLM must never claim PASS views the backend did not confirm.
 */
export function enforceDigitalLockReplyTruth(reply: string, checklist: DigitalLockChecklist): string {
  if (!checklist.active) return reply;
  const claimsComplete =
    /toda la (informaci[oó]n )?visual|completar(on)? las fotos|tengo las (tres|3)\b|ya (tenemos|tengo) toda|fotos completas|informaci[oó]n visual necesaria/i.test(
      reply,
    );
  const claimsFrontInterior =
    /tengo (las im[aá]genes del )?frente y (el )?interior|frente y el interior|ya tengo el frente y/i.test(reply);
  const claimsAnyAcceptedView =
    /me sirve como|ya tengo (el |la )?(frente|interior|canto)|recib[ií] (el |la )?(frente|interior|canto)/i.test(reply);

  if (claimsComplete && !digitalLockPhotosComplete(checklist)) {
    const missing = digitalLockMissingViews(checklist);
    const valid = digitalLockValidEvidenceCount(checklist);
    if (valid === 0) {
      return "Todavía no tengo fotos útiles de la puerta. Necesito el frente, el interior y el canto donde está el pestillo — fotos reales de la puerta, no capturas ni diagramas.";
    }
    return `Aún me falta evidencia visual válida. Solo me falta: ${missing.map(viewLabel).join(", ")}.`;
  }
  if (claimsFrontInterior) {
    const frontOk = passStatus(checklist.front);
    const insideOk = passStatus(checklist.inside);
    if (!frontOk || !insideOk) {
      const missing = digitalLockMissingViews(checklist);
      if (digitalLockValidEvidenceCount(checklist) === 0) {
        return "Todavía no tengo fotos útiles de la puerta. Envíame el frente, el interior y el canto con el pestillo.";
      }
      return `Voy con lo que sí pude validar. Todavía me falta: ${missing.map(viewLabel).join(", ")}.`;
    }
  }
  if (claimsAnyAcceptedView && digitalLockValidEvidenceCount(checklist) === 0) {
    return "Todavía no tengo fotos útiles de la puerta. Envíame el frente, el interior y el canto con el pestillo.";
  }
  return reply;
}

function normalizeVision(raw: Record<string, unknown>): VisionInspectionResult {
  const typeRaw = String(raw.imageType || raw.viewType || "unknown")
    .toLowerCase()
    .replace(/exterior_front|front_exterior/, "front")
    .replace(/interior/, "inside")
    .replace(/door_edge|edge/, "edge")
    .replace(/other|invalid.*/, "unknown");
  const imageType: DigitalLockView =
    typeRaw === "front" || typeRaw === "inside" || typeRaw === "edge" ? typeRaw : "unknown";
  const qualityRaw = String(raw.quality || "poor").toLowerCase();
  const quality: DigitalLockQuality =
    qualityRaw === "good" || qualityRaw === "usable" || qualityRaw === "poor"
      ? qualityRaw
      : typeof raw.quality === "object" && raw.quality
        ? "poor"
        : "poor";
  const qualityObj = (typeof raw.quality === "object" && raw.quality ? raw.quality : {}) as Record<string, unknown>;
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const containsDoor = Boolean(raw.containsDoor ?? raw.doorVisible);
  const containsLock = Boolean(raw.containsLock ?? raw.lockVisible);
  const usable = Boolean(raw.usableForDigitalLockAssessment);
  return {
    imageType,
    containsDoor,
    containsLock,
    containsLatchOrBolt: Boolean(raw.containsLatchOrBolt),
    doorVisible: containsDoor,
    lockVisible: containsLock,
    relevantAreaVisible: Boolean(raw.relevantAreaVisible),
    usableForDigitalLockAssessment: usable,
    quality,
    blurred: Boolean(raw.blurred ?? qualityObj.blurred),
    tooDark: Boolean(raw.tooDark ?? qualityObj.tooDark),
    tooBright: Boolean(raw.tooBright ?? qualityObj.tooBright),
    tooClose: Boolean(raw.tooClose ?? qualityObj.tooClose),
    tooFar: Boolean(raw.tooFar ?? qualityObj.tooFar),
    criticalAreaCropped: Boolean(raw.criticalAreaCropped ?? qualityObj.criticalAreaCropped),
    duplicateSuspected: Boolean(raw.duplicateSuspected),
    confidence,
    observations: Array.isArray(raw.observations) ? raw.observations.map(String).slice(0, 8) : [],
    missingVisualInformation: Array.isArray(raw.missingVisualInformation)
      ? raw.missingVisualInformation.map(String).slice(0, 6)
      : [],
    reasonIfRejected: String(raw.reasonIfRejected || "").slice(0, 240),
    doorTypeGuess: String(raw.doorTypeGuess || "").slice(0, 120),
    lockFeaturesObserved: Array.isArray(raw.lockFeaturesObserved)
      ? raw.lockFeaturesObserved.map(String).slice(0, 8)
      : [],
    measurementNeeded: Boolean(raw.measurementNeeded),
    measurementSafeToInfer: false,
  };
}

export function visionFailedResult(reason: string): VisionInspectionResult {
  return {
    imageType: "unknown",
    containsDoor: false,
    containsLock: false,
    containsLatchOrBolt: false,
    doorVisible: false,
    lockVisible: false,
    relevantAreaVisible: false,
    usableForDigitalLockAssessment: false,
    quality: "poor",
    blurred: false,
    tooDark: false,
    tooBright: false,
    tooClose: false,
    tooFar: false,
    criticalAreaCropped: false,
    duplicateSuspected: false,
    confidence: 0,
    observations: [reason],
    missingVisualInformation: ["vision_analysis_failed"],
    reasonIfRejected: reason,
    doorTypeGuess: "",
    lockFeaturesObserved: [],
    measurementNeeded: false,
    measurementSafeToInfer: false,
  };
}

export async function analyzeDigitalLockPhoto(input: {
  conversationId: string;
  photoId: string;
  knownViews: Array<{ view: DigitalLockView; photoId: string; sha256?: string }>;
  cachedByHash?: Record<string, VisionInspectionResult>;
}): Promise<{ vision: VisionInspectionResult; sha256: string; cached: boolean } | null> {
  const key = conciergeApiKey();
  if (!key) return null;
  const abs = join(homesteadDataDir(), "concierge", input.conversationId, input.photoId);
  if (!existsSync(abs)) return null;
  const bytes = readFileSync(abs);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const cached = input.cachedByHash?.[sha256];
  if (cached) {
    logInfo("PHOTO_VISION_CACHED", {
      contentJobId: input.conversationId.slice(0, 8),
      stage: cached.imageType,
      phone: sha256.slice(0, 12),
    });
    return { vision: cached, sha256, cached: true };
  }

  const known = input.knownViews
    .map((item) => `${item.view}:${item.photoId}${item.sha256 ? `:${item.sha256.slice(0, 12)}` : ""}`)
    .join(", ");

  const prompt = `Eres un inspector visual de Homestead Services (Panamá) para COMPRA/INSTALACIÓN de cerradura digital.
Analiza UNA imagen. Primero decide si es evidencia de puerta/cerradura REAL.
RECHAZA siempre: logos, diagramas, capturas de software, automations, AI workflows, selfies sin puerta, gatos, autos, recibos, pantallas, memes.
NO inventes medidas. NO inventes marca/modelo/precio.
Vistas ya aceptadas: ${known || "ninguna"}.
Devuelve SOLO JSON:
{
  "containsDoor": false,
  "containsLock": false,
  "containsLatchOrBolt": false,
  "imageType": "front|inside|edge|unknown",
  "usableForDigitalLockAssessment": false,
  "doorVisible": false,
  "lockVisible": false,
  "relevantAreaVisible": false,
  "quality": "good|usable|poor",
  "blurred": false,
  "tooDark": false,
  "tooBright": false,
  "tooClose": false,
  "tooFar": false,
  "criticalAreaCropped": false,
  "duplicateSuspected": false,
  "confidence": 0.0,
  "observations": [],
  "missingVisualInformation": [],
  "reasonIfRejected": "",
  "doorTypeGuess": "",
  "lockFeaturesObserved": [],
  "measurementNeeded": false,
  "measurementSafeToInfer": false
}
Reglas:
- Si no hay puerta/cerradura física clara: containsDoor=false, imageType=unknown, usable=false, quality=poor.
- front = exterior con cerradura/manija visible y contexto.
- inside = interior con mecanismo/manija visible.
- edge = canto con pestillo/placa visibles.
- usable=true solo si sirve para evaluar instalación de cerradura digital.
- measurementSafeToInfer siempre false.`;

  logInfo("PHOTO_VISION_STARTED", {
    contentJobId: input.conversationId.slice(0, 8),
    stage: input.photoId.slice(0, 24),
    phone: sha256.slice(0, 12),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: conciergeModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Analiza esta foto (${input.photoId}). sha256=${sha256.slice(0, 16)}` },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` },
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(json.error?.message || `openai_${response.status}`);
    const content = json.choices?.[0]?.message?.content || "{}";
    const parsed = normalizeVision(JSON.parse(content) as Record<string, unknown>);
    logInfo(parsed.usableForDigitalLockAssessment && parsed.containsDoor ? "PHOTO_VISION_ACCEPTED" : "PHOTO_VISION_REJECTED", {
      contentJobId: input.conversationId.slice(0, 8),
      stage: parsed.imageType,
      phone: String(Math.round(parsed.confidence * 100)),
    });
    return { vision: parsed, sha256, cached: false };
  } catch (error) {
    logError("DIGITAL_LOCK_VISION_FAILED", {
      contentJobId: input.conversationId.slice(0, 8),
      stage: error instanceof Error ? error.message.slice(0, 80) : "fail",
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isAssignedView(view: DigitalLockView): view is "front" | "inside" | "edge" {
  return view === "front" || view === "inside" || view === "edge";
}

export function applyDigitalLockVision(
  state: ConversationState,
  photoId: string,
  vision: VisionInspectionResult,
  sha256?: string,
): { state: ConversationState; assigned: DigitalLockView; reply: string; accepted: boolean } {
  let checklist = getDigitalLockChecklist(state);
  if (!checklist.active) {
    checklist = { ...emptyDigitalLockChecklist(), active: true, compatibility: "PHOTO_PRECHECK_INCOMPLETE" };
  }

  if (sha256) {
    checklist.analysisByHash = { ...checklist.analysisByHash, [sha256]: vision };
  }
  if (!checklist.analyzedPhotoIds.includes(photoId)) {
    checklist.analyzedPhotoIds = [...checklist.analyzedPhotoIds, photoId].slice(-40);
  }

  const assigned: DigitalLockView = vision.imageType;
  const sameShaDuplicate =
    Boolean(sha256) &&
    (["front", "inside", "edge"] as const).some((view) => {
      const slot = checklist[view];
      return slot?.status === "PASS" && slot.sha256 && slot.sha256 === sha256;
    });

  const duplicateOfAccepted =
    vision.duplicateSuspected ||
    sameShaDuplicate ||
    (assigned !== "unknown" && checklist[assigned]?.status === "PASS" && checklist[assigned]?.photoId !== photoId);

  const edgeIncomplete =
    assigned === "edge" &&
    (!vision.containsLatchOrBolt ||
      !vision.relevantAreaVisible ||
      vision.missingVisualInformation.some((item) => /pestillo|latch|placa|cerrojo/i.test(item)));

  // HARD GATE: never PASS without a real door + usable assessment + confidence
  const passesDoorGate =
    vision.containsDoor &&
    vision.containsLock &&
    vision.usableForDigitalLockAssessment &&
    vision.relevantAreaVisible &&
    !vision.blurred &&
    !vision.tooDark &&
    !vision.criticalAreaCropped &&
    vision.quality !== "poor" &&
    vision.confidence >= DIGITAL_LOCK_VISION_ACCEPT_MIN &&
    assigned !== "unknown" &&
    !edgeIncomplete &&
    !duplicateOfAccepted;

  const needsRetake =
    vision.containsDoor &&
    !passesDoorGate &&
    assigned !== "unknown" &&
    vision.confidence >= DIGITAL_LOCK_VISION_REVIEW_MIN;

  const effectiveVision: VisionInspectionResult = {
    ...vision,
    duplicateSuspected: duplicateOfAccepted || vision.duplicateSuspected,
    usableForDigitalLockAssessment: passesDoorGate,
    relevantAreaVisible: edgeIncomplete ? false : vision.relevantAreaVisible,
    quality: passesDoorGate ? vision.quality : "poor",
    reasonIfRejected:
      vision.reasonIfRejected ||
      (!vision.containsDoor
        ? "no_door_or_lock"
        : duplicateOfAccepted
          ? "duplicate_view"
          : edgeIncomplete
            ? "edge_without_latch"
            : "not_usable"),
  };

  const evidence: DigitalLockPhotoEvidence = {
    photoId,
    status: passesDoorGate ? "PASS" : needsRetake ? "RETAKE" : "REJECTED",
    imageType: assigned,
    quality: effectiveVision.quality,
    confidence: vision.confidence,
    observations: vision.observations,
    missingVisualInformation: vision.missingVisualInformation,
    sha256,
    reasonIfRejected: effectiveVision.reasonIfRejected,
    containsDoor: vision.containsDoor,
    containsLock: vision.containsLock,
    usable: passesDoorGate,
  };

  if (passesDoorGate && isAssignedView(assigned)) {
    const current = checklist[assigned];
    if (!current || current.status !== "PASS") {
      checklist = { ...checklist, [assigned]: evidence };
    }
  } else if (needsRetake && isAssignedView(assigned)) {
    const current = checklist[assigned];
    if (!current || current.status !== "PASS") {
      checklist = { ...checklist, [assigned]: evidence };
    }
  } else {
    checklist.rejected = [
      ...checklist.rejected,
      {
        photoId,
        sha256,
        reason: effectiveVision.reasonIfRejected || "invalid_evidence",
        viewType: assigned,
        confidence: vision.confidence,
      },
    ].slice(-20);
  }

  checklist.lastPhotoId = photoId;
  if (vision.measurementNeeded) checklist.measurementRequired = true;
  if (vision.doorTypeGuess && vision.containsDoor) checklist.doorNotes = vision.doorTypeGuess.slice(0, 160);
  if (vision.lockFeaturesObserved.length && vision.containsLock) {
    checklist.lockNotes = vision.lockFeaturesObserved.join(", ").slice(0, 200);
  }

  if (digitalLockPhotosComplete(checklist)) {
    const lowConfidence =
      (checklist.front?.confidence || 0) < 0.55 ||
      (checklist.inside?.confidence || 0) < 0.55 ||
      (checklist.edge?.confidence || 0) < 0.55;
    if (lowConfidence) checklist.compatibility = "REQUIRES_TECHNICIAN_REVIEW";
    else if (checklist.measurementRequired && !checklist.measurementComplete) {
      checklist.compatibility = "NEEDS_MORE_INFO";
    } else checklist.compatibility = "LIKELY_COMPATIBLE";
  } else {
    checklist.compatibility = "PHOTO_PRECHECK_INCOMPLETE";
  }

  logInfo("DIGITAL_LOCK_EVIDENCE_UPDATED", {
    contentJobId: photoId.slice(0, 16),
    stage: `${assigned}:${evidence.status}`,
    phone: String(digitalLockValidEvidenceCount(checklist)),
  });
  if (digitalLockPhotosComplete(checklist)) {
    logInfo("DIGITAL_LOCK_EVIDENCE_COMPLETE", {
      contentJobId: photoId.slice(0, 16),
      stage: checklist.compatibility,
    });
  }

  const nextState = setDigitalLockChecklist(state, checklist);
  return {
    state: nextState,
    assigned,
    reply: digitalLockHumanReply(checklist, effectiveVision, assigned),
    accepted: passesDoorGate,
  };
}

export function maybeCompleteDigitalLockMeasurement(state: ConversationState, text: string): ConversationState {
  const checklist = getDigitalLockChecklist(state);
  if (!checklist.active || !checklist.measurementRequired || checklist.measurementComplete) return state;
  if (!/\b\d{2,3}\s*(mm|mil[ií]metros?)\b/i.test(text) && !/\bgrosor\b.{0,20}\b\d{2,3}\b/i.test(text)) {
    return state;
  }
  const next = {
    ...checklist,
    measurementComplete: true,
    compatibility:
      checklist.compatibility === "REQUIRES_TECHNICIAN_REVIEW"
        ? checklist.compatibility
        : digitalLockPhotosComplete(checklist)
          ? "LIKELY_COMPATIBLE"
          : checklist.compatibility,
  };
  return setDigitalLockChecklist(state, next);
}

export function digitalLockPromptBlock(checklist: DigitalLockChecklist) {
  if (!checklist.active) return "";
  const missing = digitalLockMissingViews(checklist);
  return `FLUJO ESPECIAL DIGITAL_LOCK_PURCHASE_INSTALLATION — EVIDENCIA DETERMINÍSTICA (OBLIGATORIO):
Checklist REAL: frente=${checklist.front?.status || "MISSING"}, interior=${checklist.inside?.status || "MISSING"}, canto=${checklist.edge?.status || "MISSING"}
Válidas: ${digitalLockValidEvidenceCount(checklist)}/3 — Rechazadas: ${checklist.rejected.length}
Compatibilidad: ${checklist.compatibility}
Falta: ${missing.map(viewLabel).join(", ") || "ninguna vista"}
PROHIBIDO afirmar que tienes frente/interior/canto o que las fotos están completas si el checklist no dice PASS.
PROHIBIDO usar solo el número de archivos subidos.
Si el cliente envió diagramas/capturas/logos: dilo con naturalidad y pide fotos reales de la puerta.
No inventes mm/marca/precio/stock. No agendes visita solo porque hubo 3 uploads.`;
}

export function knownDigitalLockViews(checklist: DigitalLockChecklist) {
  return (["front", "inside", "edge"] as const)
    .filter((view) => checklist[view]?.status === "PASS")
    .map((view) => ({
      view,
      photoId: checklist[view]!.photoId,
      sha256: checklist[view]!.sha256,
    }));
}

export function digitalLockAdminRows(checklist: DigitalLockChecklist) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Flujo", value: "Cerradura digital" },
    {
      label: "Evidencia visual",
      value: `Válidas ${digitalLockValidEvidenceCount(checklist)}/3 · Recibidas analizadas ${checklist.analyzedPhotoIds.length} · Rechazadas ${checklist.rejected.length}`,
    },
    {
      label: "Foto frente",
      value: checklist.front?.status === "PASS" ? "✅ PASS" : checklist.front?.status === "RETAKE" ? "↺ RETAKE" : "❌ Falta",
    },
    {
      label: "Foto interior",
      value: checklist.inside?.status === "PASS" ? "✅ PASS" : checklist.inside?.status === "RETAKE" ? "↺ RETAKE" : "❌ Falta",
    },
    {
      label: "Foto canto",
      value: checklist.edge?.status === "PASS" ? "✅ PASS" : checklist.edge?.status === "RETAKE" ? "↺ RETAKE" : "❌ Falta",
    },
    { label: "Compatibilidad", value: checklist.compatibility },
  ];
  if (checklist.doorNotes) rows.push({ label: "Puerta (obs.)", value: checklist.doorNotes });
  if (checklist.lockNotes) rows.push({ label: "Cerradura (obs.)", value: checklist.lockNotes });
  if (checklist.measurementRequired) {
    rows.push({
      label: "Medida",
      value: checklist.measurementComplete ? "Completa" : "Pendiente (grosor de puerta)",
    });
  }
  return rows;
}

export function digitalLockTelegramLines(checklist: DigitalLockChecklist) {
  if (!checklist.active) return [];
  const mark = (slot: DigitalLockPhotoEvidence | null, label: string) => {
    if (slot?.status === "PASS") return `✅ ${label}`;
    if (slot?.status === "RETAKE") return `⚠ ${label} (retake)`;
    return `❌ ${label} pendiente`;
  };
  return [
    "🔐 CERRADURA DIGITAL",
    "Evidencia visual:",
    mark(checklist.front, "Frente"),
    mark(checklist.inside, "Interior"),
    mark(checklist.edge, "Canto"),
    `Válidas: ${digitalLockValidEvidenceCount(checklist)}/3` +
      (checklist.rejected.length ? ` · Rechazadas: ${checklist.rejected.length}` : ""),
    `Estado: ${
      checklist.compatibility === "REQUIRES_TECHNICIAN_REVIEW"
        ? "LISTO PARA REVISIÓN TÉCNICA"
        : digitalLockPhotosComplete(checklist)
          ? checklist.compatibility
          : "PHOTO_PRECHECK_INCOMPLETE"
    }`,
  ];
}

export function buildAdminPhotoEvidenceMap(
  photos: Array<{ storedAs: string; sourceStoredAs?: string }>,
  factsJson?: string,
): Record<string, { tone: "pass" | "retake" | "reject" | "pending"; title: string; detail: string }> {
  const out: Record<string, { tone: "pass" | "retake" | "reject" | "pending"; title: string; detail: string }> = {};
  let checklist: {
    active?: boolean;
    front?: { photoId?: string; status?: string; reasonIfRejected?: string };
    inside?: { photoId?: string; status?: string; reasonIfRejected?: string };
    edge?: { photoId?: string; status?: string; reasonIfRejected?: string };
    rejected?: Array<{ photoId?: string; reason?: string }>;
    analyzedPhotoIds?: string[];
  } | null = null;
  try {
    const parsed = JSON.parse(factsJson || "{}") as { facts?: Record<string, string> };
    if (parsed.facts?.digitalLockChecklist) {
      checklist = JSON.parse(parsed.facts.digitalLockChecklist);
    }
  } catch {
    checklist = null;
  }
  if (!checklist?.active) return out;

  for (const photo of photos) {
    const source = photo.sourceStoredAs || photo.storedAs;
    let matched = false;
    for (const view of [
      { key: "front", label: "Frente" },
      { key: "inside", label: "Interior" },
      { key: "edge", label: "Canto" },
    ] as const) {
      const slot = checklist[view.key];
      if (slot?.photoId === source || slot?.photoId === photo.storedAs) {
        matched = true;
        if (slot.status === "PASS") {
          out[photo.storedAs] = { tone: "pass", title: view.label, detail: "Aprobada por análisis visual" };
        } else if (slot.status === "RETAKE") {
          out[photo.storedAs] = {
            tone: "retake",
            title: "Revisar",
            detail: slot.reasonIfRejected || "Necesita otra toma",
          };
        }
        break;
      }
    }
    if (matched) continue;
    const rejected = (checklist.rejected || []).find(
      (item) => item.photoId === source || item.photoId === photo.storedAs,
    );
    if (rejected) {
      out[photo.storedAs] = {
        tone: "reject",
        title: "No válida",
        detail: rejected.reason || "No se detectó puerta/cerradura",
      };
      continue;
    }
    if ((checklist.analyzedPhotoIds || []).includes(source) || (checklist.analyzedPhotoIds || []).includes(photo.storedAs)) {
      out[photo.storedAs] = {
        tone: "reject",
        title: "No válida",
        detail: "No aportó evidencia de cerradura",
      };
    } else {
      out[photo.storedAs] = { tone: "pending", title: "Sin analizar", detail: "Pendiente de revisión visual" };
    }
  }
  return out;
}
