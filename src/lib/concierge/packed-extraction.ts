import { classifyPhone, extractEmbeddedPhone } from "@/lib/phone";
import type { ConversationState } from "@/lib/concierge-store";
import {
  applyLocationCorrection,
  choosePrimary,
  detectServices,
  detectUrgency,
  detectUnknownOpportunity,
  mergeDetectedServices,
} from "@/lib/concierge/playbook-engine";
import { getPlaybook } from "@/lib/concierge/service-playbooks";
import { resolvePrimaryFromMessage } from "@/lib/concierge/service-intent";

export type FactConfidence = "EXPLICIT" | "HIGH_CONFIDENCE" | "UNCERTAIN";

export type PackedExtraction = {
  name?: string;
  location?: string;
  phone?: string;
  contactPreference?: string;
  propertyType?: string;
  units?: string;
  symptom?: string;
  duration?: string;
  activeLeak?: string;
  hazard?: string;
  negated: string[];
  corrections: string[];
};

const WORD_NUM: Record<string, string> = {
  un: "1",
  uno: "1",
  una: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
};

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function negatedBefore(blob: string, index: number, window = 28) {
  const slice = blob.slice(Math.max(0, index - window), index);
  return /\b(no|nunca|sin|tampoco|ni siquiera)\b/.test(slice);
}

function extractName(text: string) {
  const match =
    text.match(/\b(?:soy|me llamo)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})/i) ||
    text.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+),?\s+(?:estoy|vivo|tengo)/i);
  return match?.[1]?.trim().slice(0, 80) || "";
}

function extractLocation(text: string) {
  const patterns = [
    /\b(?:estoy en|vivo en|me encuentro en|ubicad[oa] en)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+(?:de\s+la?\s+|del?\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i,
    /\ben\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+(?:de\s+la?\s+|del?\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && !/\d{4}/.test(match[1])) return match[1].trim();
  }
  return "";
}

function extractUnits(text: string) {
  const blob = fold(text);
  const digit = blob.match(/\b(\d+)\s+(?:aires?|equipos?|splits?|minisplits?)\b/);
  if (digit) return digit[1];
  const word = blob.match(
    /\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:aires?|equipos?|splits?|minisplits?)\b/,
  );
  if (word) return WORD_NUM[word[1]] || "";
  const de = blob.match(/\b(?:mantenimiento\s+)?(?:de|para)\s+(dos|tres|cuatro|cinco|\d+)\s+(?:aires?|equipos?)\b/);
  if (de) return WORD_NUM[de[1]] || de[1];
  return "";
}

function extractDuration(text: string) {
  const blob = fold(text);
  if (/desde ayer/.test(blob)) return "desde ayer";
  if (/desde hace|hace\s+\d+\s+d[ií]as?/.test(blob)) {
    const match = text.match(/(?:desde\s+)?hace\s+(\d+\s+d[ií]as?)/i);
    return match?.[1]?.trim() || "hace varios días";
  }
  if (/empez[oó]\s+ayer/.test(blob)) return "desde ayer";
  return "";
}

function extractContactPreference(text: string) {
  const blob = fold(text);
  if (/despues de las\s+\d{1,2}/.test(blob) || /después de las\s+\d{1,2}/i.test(text)) {
    const match = text.match(/despu[eé]s de las\s+(\d{1,2}(?::\d{2})?)/i);
    return match ? `después de las ${match[1]}` : "después de las 17:00";
  }
  if (/\ben la tarde\b/.test(blob)) return "en la tarde";
  if (/\ben la ma[nñ]ana\b/.test(blob)) return "en la mañana";
  if (/\bll[aá]mame\b/.test(blob) && /tarde|ma[nñ]ana|noche/.test(blob)) {
    const match = text.match(/ll[aá]mame\s+(?:en\s+)?(la tarde|la ma[nñ]ana|despu[eé]s de las \d{1,2}(?::\d{2})?)/i);
    return match?.[1]?.trim() || "preferencia de contacto indicada";
  }
  return "";
}

function extractSymptoms(text: string): { symptom: string; negated: string[] } {
  const blob = fold(text);
  const negated: string[] = [];
  const rules: Array<{ key: string; re: RegExp; label: string }> = [
    { key: "waterLeak", re: /bota(?:ndo)?\s+agua|gotea|goteo|fuga de agua/, label: "bota agua" },
    { key: "notCooling", re: /no\s+enfr[ií]a|no\s+enfria|no\s+enfria nada/, label: "no enfría" },
    { key: "notStarting", re: /no\s+enciende/, label: "no enciende" },
    { key: "noise", re: /ruido|ruidos/, label: "ruido" },
    { key: "smell", re: /olor/, label: "olor" },
  ];
  const parts: string[] = [];
  for (const rule of rules) {
    const match = rule.re.exec(blob);
    if (!match) continue;
    if (negatedBefore(blob, match.index)) {
      negated.push(rule.key);
      continue;
    }
    parts.push(rule.label);
  }
  if (/simplemente\s+no\s+enfr/.test(blob) && !parts.includes("no enfría")) parts.push("no enfría");
  return { symptom: parts.join(", "), negated };
}

function extractPlumbing(text: string): { activeLeak?: string } {
  const blob = fold(text);
  if (/sigue\s+sal(iendo|e)|fuga\s+activa|bastante\s+agua|mucha\s+agua/.test(blob)) {
    return { activeLeak: "sí, activa" };
  }
  if (/debajo del fregad|fregador|fregao|lavamanos|tub(er[ií]a)?\s+rot/.test(blob)) {
    return { activeLeak: "reportada" };
  }
  return {};
}

function extractElectrical(text: string): { hazard?: string } {
  const blob = fold(text);
  if (/chispa|olor a quemado|humo|electroc/.test(blob)) return { hazard: "riesgo eléctrico" };
  if (/tomacorriente|toma corriente|interruptor|se fue la luz|se fue la lus/.test(blob)) {
    return { hazard: blob.includes("chispa") || blob.includes("quemado") ? "riesgo eléctrico" : "" };
  }
  return {};
}

function extractPropertyType(text: string) {
  if (/\bapartamento|apto\b/i.test(text)) return "apartment";
  if (/\bcasa\b/i.test(text)) return "house";
  if (/\boficina\b/i.test(text)) return "office";
  return "";
}

function extractSplitType(text: string) {
  if (/\bsplit\b/i.test(text)) return "split";
  return "";
}

export function extractPackedMessage(text: string): PackedExtraction {
  const { symptom, negated } = extractSymptoms(text);
  const plumbing = extractPlumbing(text);
  const electrical = extractElectrical(text);
  const correction = applyLocationCorrection(text, "");
  const corrections = correction ? [correction] : [];
  return {
    name: extractName(text),
    location: extractLocation(text) || correction,
    phone: extractEmbeddedPhone(text),
    contactPreference: extractContactPreference(text),
    propertyType: extractPropertyType(text),
    units: extractUnits(text),
    symptom,
    duration: extractDuration(text),
    activeLeak: plumbing.activeLeak,
    hazard: electrical.hazard,
    negated,
    corrections,
    ...(extractSplitType(text) ? { units: extractUnits(text) || "1" } : {}),
  };
}

function setConfidence(
  current: Record<string, FactConfidence>,
  key: string,
  level: FactConfidence,
): Record<string, FactConfidence> {
  return { ...current, [key]: level };
}

export function applyPackedExtraction(state: ConversationState, text: string): ConversationState {
  const packed = extractPackedMessage(text);
  const next: ConversationState = {
    ...state,
    facts: { ...(state.facts || {}) },
    factConfidence: { ...(state.factConfidence || {}) },
    corrections: [...(state.corrections || [])],
  };

  if (packed.name) {
    next.name = packed.name;
    next.factConfidence = setConfidence(next.factConfidence || {}, "name", "EXPLICIT");
  }
  if (packed.location) {
    next.location = applyLocationCorrection(text, packed.location);
    next.facts.location = next.location;
    next.factConfidence = setConfidence(next.factConfidence || {}, "location", "EXPLICIT");
  }
  if (packed.corrections.length) {
    next.corrections = [...new Set([...(next.corrections || []), ...packed.corrections])];
  }
  if (packed.phone) {
    const phone = classifyPhone(packed.phone);
    if (phone.status === "VALID") {
      next.phone = phone.e164 || phone.display;
      next.contactStatus = "VALID";
      next.factConfidence = setConfidence(next.factConfidence || {}, "phone", "EXPLICIT");
    } else if (phone.status === "INCOMPLETE") {
      next.contactStatus = "INCOMPLETE";
    }
  }
  if (packed.contactPreference) {
    next.preferredTime = packed.contactPreference;
    next.facts.contactPreference = packed.contactPreference;
    next.factConfidence = setConfidence(next.factConfidence || {}, "contactPreference", "EXPLICIT");
  }
  if (packed.propertyType) next.propertyType = packed.propertyType;
  if (packed.units) {
    next.facts.units = packed.units;
    next.factConfidence = setConfidence(next.factConfidence || {}, "units", "EXPLICIT");
  }
  if (packed.symptom && !packed.negated.includes("notCooling") && !packed.negated.includes("waterLeak")) {
    next.facts.symptom = packed.symptom;
    next.factConfidence = setConfidence(next.factConfidence || {}, "symptom", "HIGH_CONFIDENCE");
  } else if (packed.symptom) {
    const parts = packed.symptom.split(", ").filter((part) => {
      if (part.includes("enfría") && packed.negated.includes("notCooling")) return false;
      if (part.includes("agua") && packed.negated.includes("waterLeak")) return false;
      return true;
    });
    if (parts.length) {
      next.facts.symptom = parts.join(", ");
      next.factConfidence = setConfidence(next.factConfidence || {}, "symptom", "HIGH_CONFIDENCE");
    }
  }
  if (packed.duration) {
    next.facts.duration = packed.duration;
    next.factConfidence = setConfidence(next.factConfidence || {}, "duration", "EXPLICIT");
  }
  if (packed.activeLeak) {
    next.facts.activeLeak = packed.activeLeak;
    next.factConfidence = setConfidence(next.factConfidence || {}, "activeLeak", "HIGH_CONFIDENCE");
  }
  if (packed.hazard) {
    next.facts.hazard = packed.hazard;
    next.factConfidence = setConfidence(next.factConfidence || {}, "hazard", "HIGH_CONFIDENCE");
  }
  if (/\bsplit\b/i.test(text)) {
    next.facts.unitType = "split";
  }

  const detected = detectServices(text);
  next.detectedServices = mergeDetectedServices(next.detectedServices || [], detected);
  const previousPrimary = next.primaryService || next.service || "";
  next.primaryService = choosePrimary(next.detectedServices, previousPrimary, text);
  if (previousPrimary && next.primaryService && previousPrimary !== next.primaryService) {
    next.activeLeadId = "";
    next.appointmentId = "";
    next.offeredSlots = [];
    next.awaitingSlotSelection = false;
    next.slotOfferToken = "";
    next.bookingSuspended = false;
  }
  if (next.primaryService) next.service = next.primaryService;
  next.secondaryServices = next.detectedServices.filter((id) => id !== next.primaryService);

  const playbook = getPlaybook(next.primaryService || next.service);
  next.bookingStrategy = playbook.bookingStrategy;
  if (detectUnknownOpportunity(text) || next.primaryService === "other") next.needsReview = true;

  const urgency = detectUrgency(text, playbook);
  if (urgency !== "normal" || !next.urgency) next.urgency = urgency;
  if (/agend|cita|visita|disponib/i.test(text)) next.bookingIntent = true;

  if (text.trim().length > 12 && !/^te envi[eé] una foto/i.test(text)) {
    const intentFromMessage = resolvePrimaryFromMessage(text);
    if (intentFromMessage || !next.problem) {
      next.problem = text.trim().slice(0, 500);
    }
  }
  if (next.facts.symptom && !next.facts.need) next.facts.need = next.facts.symptom;

  for (const key of packed.negated) {
    if (key === "waterLeak") delete next.facts.waterLeak;
    if (key === "notCooling" && next.facts.symptom === "no enfría") delete next.facts.symptom;
  }

  return next;
}
