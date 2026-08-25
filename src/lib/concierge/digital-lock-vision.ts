import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homesteadDataDir } from "@/lib/service-requests";
import { conciergeApiKey, conciergeModel } from "@/lib/concierge-flags";
import { logError, logInfo } from "@/lib/log";
import type { ConversationState } from "@/lib/concierge-store";

export type DigitalLockView = "front" | "inside" | "edge" | "unknown";
export type DigitalLockPhotoStatus = "PASS" | "MISSING" | "RETAKE";
export type DigitalLockQuality = "good" | "usable" | "poor";
export type DigitalLockCompatibility =
  | "UNKNOWN"
  | "NEEDS_MORE_INFO"
  | "LIKELY_COMPATIBLE"
  | "REQUIRES_TECHNICIAN_REVIEW";

export type DigitalLockPhotoEvidence = {
  photoId: string;
  status: DigitalLockPhotoStatus;
  imageType: DigitalLockView;
  quality: DigitalLockQuality;
  confidence: number;
  observations: string[];
  missingVisualInformation: string[];
  sha256?: string;
};

export type DigitalLockChecklist = {
  active: boolean;
  front: DigitalLockPhotoEvidence | null;
  inside: DigitalLockPhotoEvidence | null;
  edge: DigitalLockPhotoEvidence | null;
  measurementRequired: boolean;
  measurementComplete: boolean;
  compatibility: DigitalLockCompatibility;
  doorNotes: string;
  lockNotes: string;
  lastPhotoId: string;
};

export type VisionInspectionResult = {
  imageType: DigitalLockView;
  doorVisible: boolean;
  lockVisible: boolean;
  relevantAreaVisible: boolean;
  quality: DigitalLockQuality;
  blurred: boolean;
  tooDark: boolean;
  tooClose: boolean;
  tooFar: boolean;
  duplicateSuspected: boolean;
  confidence: number;
  observations: string[];
  missingVisualInformation: string[];
  doorTypeGuess: string;
  lockFeaturesObserved: string[];
  measurementNeeded: boolean;
  measurementSafeToInfer: boolean;
};

const DIGITAL_LOCK_INTENT =
  /\b(cerradura\s+digital|cerradura\s+inteligente|smart\s*lock|huella|fingerprint|teclado|keypad|quiero\s+(comprar|poner|instalar|cambiar).{0,40}cerradura|cerradura.{0,30}(digital|inteligente|huella))\b/i;

export function emptyDigitalLockChecklist(): DigitalLockChecklist {
  return {
    active: false,
    front: null,
    inside: null,
    edge: null,
    measurementRequired: false,
    measurementComplete: false,
    compatibility: "UNKNOWN",
    doorNotes: "",
    lockNotes: "",
    lastPhotoId: "",
  };
}

export function detectDigitalLockPurchaseIntent(text: string) {
  return DIGITAL_LOCK_INTENT.test(text);
}

export function getDigitalLockChecklist(state: ConversationState): DigitalLockChecklist {
  const raw = state.facts?.digitalLockChecklist;
  if (!raw) return emptyDigitalLockChecklist();
  try {
    return { ...emptyDigitalLockChecklist(), ...(JSON.parse(raw) as DigitalLockChecklist) };
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
  next.compatibility = "NEEDS_MORE_INFO";
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
  return setDigitalLockChecklist(state, { ...emptyDigitalLockChecklist(), active: true, compatibility: "NEEDS_MORE_INFO" });
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

function viewLabel(view: DigitalLockView) {
  if (view === "front") return "frente / exterior";
  if (view === "inside") return "parte interior";
  if (view === "edge") return "canto / pestillo";
  return "vista";
}

export function digitalLockIntroReply() {
  return "Claro, te ayudamos con la cerradura digital. Para revisar qué opción puede adaptarse a tu puerta necesito ver tres partes: una foto de frente, otra del interior y una del canto donde está el pestillo. Puedes mandármelas una por una; yo te digo si están bien o si necesito ver algo mejor.";
}

export function digitalLockHumanReply(checklist: DigitalLockChecklist, last: VisionInspectionResult, assigned: DigitalLockView): string {
  const assignedPass = assigned !== "unknown" && checklist[assigned]?.status === "PASS";

  if (last.duplicateSuspected && !assignedPass) {
    const missing = digitalLockMissingViews(checklist);
    if (missing.length) {
      return `Parece la misma vista que ya tengo. Ya cuento con lo que me sirve hasta ahora. Solo me falta: ${missing.map(viewLabel).join(", ")}.`;
    }
  }

  if (!assignedPass || last.quality === "poor" || !last.relevantAreaVisible) {
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
    if (assigned === "edge") {
      return "Esta parece el canto, pero no alcanzo a ver bien el pestillo. ¿Puedes tomar otra mostrando el canto donde sale el pestillo?";
    }
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

function normalizeVision(raw: Record<string, unknown>): VisionInspectionResult {
  const typeRaw = String(raw.imageType || "unknown").toLowerCase();
  const imageType: DigitalLockView =
    typeRaw === "front" || typeRaw === "inside" || typeRaw === "edge" ? typeRaw : "unknown";
  const qualityRaw = String(raw.quality || "poor").toLowerCase();
  const quality: DigitalLockQuality =
    qualityRaw === "good" || qualityRaw === "usable" || qualityRaw === "poor" ? qualityRaw : "poor";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return {
    imageType,
    doorVisible: Boolean(raw.doorVisible),
    lockVisible: Boolean(raw.lockVisible),
    relevantAreaVisible: Boolean(raw.relevantAreaVisible),
    quality,
    blurred: Boolean(raw.blurred),
    tooDark: Boolean(raw.tooDark),
    tooClose: Boolean(raw.tooClose),
    tooFar: Boolean(raw.tooFar),
    duplicateSuspected: Boolean(raw.duplicateSuspected),
    confidence,
    observations: Array.isArray(raw.observations) ? raw.observations.map(String).slice(0, 6) : [],
    missingVisualInformation: Array.isArray(raw.missingVisualInformation)
      ? raw.missingVisualInformation.map(String).slice(0, 6)
      : [],
    doorTypeGuess: String(raw.doorTypeGuess || "").slice(0, 120),
    lockFeaturesObserved: Array.isArray(raw.lockFeaturesObserved)
      ? raw.lockFeaturesObserved.map(String).slice(0, 8)
      : [],
    measurementNeeded: Boolean(raw.measurementNeeded),
    // CRITICAL: never trust visual mm estimates for compatibility decisions
    measurementSafeToInfer: false,
  };
}

export async function analyzeDigitalLockPhoto(input: {
  conversationId: string;
  photoId: string;
  knownViews: Array<{ view: DigitalLockView; photoId: string; sha256?: string }>;
}): Promise<VisionInspectionResult | null> {
  const key = conciergeApiKey();
  if (!key) return null;
  const abs = join(homesteadDataDir(), "concierge", input.conversationId, input.photoId);
  if (!existsSync(abs)) return null;
  const bytes = readFileSync(abs);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const known = input.knownViews
    .map((item) => `${item.view}:${item.photoId}${item.sha256 ? `:${item.sha256.slice(0, 12)}` : ""}`)
    .join(", ");

  const prompt = `Eres un asesor técnico de Homestead Services (Panamá) revisando fotos para COMPRA/INSTALACIÓN de cerradura digital.
Clasifica UNA sola imagen. No inventes medidas exactas. Si no puedes ver algo, márcalo unknown/false.
Vistas ya aceptadas: ${known || "ninguna"}.
Devuelve SOLO JSON:
{
  "imageType":"front|inside|edge|unknown",
  "doorVisible":true,
  "lockVisible":true,
  "relevantAreaVisible":true,
  "quality":"good|usable|poor",
  "blurred":false,
  "tooDark":false,
  "tooClose":false,
  "tooFar":false,
  "duplicateSuspected":false,
  "confidence":0.0,
  "observations":[],
  "missingVisualInformation":[],
  "doorTypeGuess":"",
  "lockFeaturesObserved":[],
  "measurementNeeded":false,
  "measurementSafeToInfer":false
}
Reglas:
- front = exterior/frente con cerradura o manija visible
- inside = interior/trasero con mecanismo/manija visible
- edge = canto/costado con pestillo/placa visibles
- duplicateSuspected=true si parece la misma vista ya aceptada
- quality=poor si no sirve para evaluación
- measurementSafeToInfer siempre false salvo referencia métrica clara en la foto
- no inventes marca/modelo/precio`;

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
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "text", text: `Analiza esta foto (${input.photoId}). sha256=${sha.slice(0, 16)}` },
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
    logInfo("DIGITAL_LOCK_VISION", {
      contentJobId: input.conversationId.slice(0, 8),
      stage: parsed.imageType,
      phone: String(Math.round(parsed.confidence * 100)),
    });
    return { ...parsed, observations: [...parsed.observations, `sha:${sha.slice(0, 16)}`] };
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

export function applyDigitalLockVision(
  state: ConversationState,
  photoId: string,
  vision: VisionInspectionResult,
): { state: ConversationState; assigned: DigitalLockView; reply: string } {
  let checklist = getDigitalLockChecklist(state);
  if (!checklist.active) {
    checklist = { ...emptyDigitalLockChecklist(), active: true, compatibility: "NEEDS_MORE_INFO" };
  }

  const shaObs = vision.observations.find((item) => item.startsWith("sha:"));
  const sha256 = shaObs?.slice(4);
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

  // Edge without latch/relevant area must retake even if type guessed
  const edgeIncomplete =
    assigned === "edge" &&
    (!vision.relevantAreaVisible ||
      vision.missingVisualInformation.some((item) => /pestillo|latch|placa|cerrojo/i.test(item)));

  const effectiveVision: VisionInspectionResult = {
    ...vision,
    duplicateSuspected: duplicateOfAccepted || vision.duplicateSuspected,
    relevantAreaVisible: edgeIncomplete ? false : vision.relevantAreaVisible,
    quality: edgeIncomplete && vision.quality === "good" ? "poor" : vision.quality,
  };

  const usable =
    !duplicateOfAccepted &&
    assigned !== "unknown" &&
    effectiveVision.relevantAreaVisible &&
    vision.lockVisible &&
    effectiveVision.quality !== "poor" &&
    vision.confidence >= 0.45 &&
    !vision.blurred &&
    !vision.tooDark;

  const evidence: DigitalLockPhotoEvidence = {
    photoId,
    status: usable ? "PASS" : assigned === "unknown" ? "MISSING" : "RETAKE",
    imageType: assigned,
    quality: effectiveVision.quality,
    confidence: vision.confidence,
    observations: vision.observations,
    missingVisualInformation: vision.missingVisualInformation,
    sha256,
  };

  if (!duplicateOfAccepted && assigned !== "unknown") {
    const current = checklist[assigned];
    if (!current || current.status !== "PASS" || evidence.status === "PASS") {
      checklist = { ...checklist, [assigned]: evidence };
    }
  }

  checklist.lastPhotoId = photoId;
  if (vision.measurementNeeded) {
    checklist.measurementRequired = true;
  }
  if (vision.doorTypeGuess) checklist.doorNotes = vision.doorTypeGuess.slice(0, 160);
  if (vision.lockFeaturesObserved.length) {
    checklist.lockNotes = vision.lockFeaturesObserved.join(", ").slice(0, 200);
  }

  if (digitalLockPhotosComplete(checklist)) {
    const lowConfidence =
      (checklist.front?.confidence || 0) < 0.5 ||
      (checklist.inside?.confidence || 0) < 0.5 ||
      (checklist.edge?.confidence || 0) < 0.5 ||
      vision.confidence < 0.55;
    if (lowConfidence) {
      checklist.compatibility = "REQUIRES_TECHNICIAN_REVIEW";
    } else if (checklist.measurementRequired && !checklist.measurementComplete) {
      checklist.compatibility = "NEEDS_MORE_INFO";
    } else {
      checklist.compatibility = "LIKELY_COMPATIBLE";
    }
  } else {
    checklist.compatibility = "NEEDS_MORE_INFO";
  }

  const nextState = setDigitalLockChecklist(state, checklist);
  return {
    state: nextState,
    assigned,
    reply: digitalLockHumanReply(checklist, effectiveVision, assigned),
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
  return `FLUJO ESPECIAL DIGITAL_LOCK_PURCHASE_INSTALLATION (NO usar cerrajería genérica ni agendar visita prematura):
Checklist: frente=${checklist.front?.status || "MISSING"}, interior=${checklist.inside?.status || "MISSING"}, canto=${checklist.edge?.status || "MISSING"}
Compatibilidad: ${checklist.compatibility}
Medida: ${checklist.measurementRequired ? (checklist.measurementComplete ? "COMPLETE" : "MISSING") : "NOT_REQUIRED"}
Falta: ${missing.map(viewLabel).join(", ") || "ninguna vista"}
Reglas: pide SOLO lo que falta; no digas PHOTO_*; no inventes mm/marca/precio/stock; si baja confianza → revisión técnica; no marques COMPATIBLE absoluto.`;
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
    { label: "Foto frente", value: checklist.front?.status === "PASS" ? "✅ PASS" : checklist.front?.status === "RETAKE" ? "↺ RETAKE" : "○ Falta" },
    { label: "Foto interior", value: checklist.inside?.status === "PASS" ? "✅ PASS" : checklist.inside?.status === "RETAKE" ? "↺ RETAKE" : "○ Falta" },
    { label: "Foto canto", value: checklist.edge?.status === "PASS" ? "✅ PASS" : checklist.edge?.status === "RETAKE" ? "↺ RETAKE" : "○ Falta" },
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
  return [
    "🔐 CERRADURA DIGITAL",
    `Fotos: Frente ${checklist.front?.status === "PASS" ? "✅" : "○"} · Interior ${checklist.inside?.status === "PASS" ? "✅" : "○"} · Canto ${checklist.edge?.status === "PASS" ? "✅" : "○"}`,
    `Estado: ${checklist.compatibility === "REQUIRES_TECHNICIAN_REVIEW" ? "LISTO PARA REVISIÓN TÉCNICA" : checklist.compatibility}`,
  ];
}
