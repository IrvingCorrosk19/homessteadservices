import { classifyPhone, extractEmbeddedPhone, looksLikePhoneAttempt } from "@/lib/phone";
import type { ConversationState } from "@/lib/concierge-store";
import {
  detectExplicitCorrection,
  isValidPersonName,
  mergeConfirmedFacts,
  sanitizeInferredUnit,
} from "@/lib/concierge/canonical-state";
import {
  applyLocationCorrection,
  choosePrimary,
  detectServices,
  detectUrgency,
  detectUnknownOpportunity,
  mergeDetectedServices,
} from "@/lib/concierge/playbook-engine";
import {
  isLocationExplicitCorrection,
  isScheduleOrTimeOnlyMessage,
  looksLikeScheduleLocationCandidate,
} from "@/lib/concierge/schedule-phrases";
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
  affectedUnits?: string;
  symptom?: string;
  duration?: string;
  activeLeak?: string;
  hazard?: string;
  building?: string;
  tower?: string;
  unit?: string;
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

function normalizeNameMarkers(text: string) {
  return text.replace(/\bmi\s+n(?:ombre|nomnre|nomre|nombr|omnre|omre)\s+es\b/gi, "mi nombre es");
}

function trimNameAtBoundary(raw: string) {
  let name = raw.trim();
  const stop = name.match(
    /^(.+?)(?:\s*,|\s+(?:casa|apartamento|apto|ph|ll[aá]mame|llamame|en la|mi n[uú]mero|al)\b)/i,
  );
  if (stop?.[1]) name = stop[1].trim();
  return name.slice(0, 80);
}

function extractName(text: string) {
  const normalized = normalizeNameMarkers(text);
  const explicitPatterns = [
    /\bmi\s+nombre\s+es\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})/i,
    /\ba\s+nombre\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})/i,
    /\b(?:soy|me llamo)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const candidate = trimNameAtBoundary(match[1]);
      if (isValidPersonName(candidate)) return candidate;
    }
  }
  const match =
    normalized.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+),?\s+(?:estoy|vivo|tengo)/i);
  if (match?.[1]) {
    const candidate = trimNameAtBoundary(match[1]);
    if (isValidPersonName(candidate)) return candidate;
  }
  // Trailing "… irving corro 67676767" in packed multi-fact messages
  const trailing = normalized.match(
    /(?:^|[\s,;])([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})\s+(\+?507[\s\-]?)?\d{7,8}\s*$/i,
  );
  if (trailing?.[1]) {
    const candidate = trimNameAtBoundary(trailing[1].trim());
    const bad =
      /^(mañana|hoy|viernes|lunes|martes|miércoles|miercoles|sabado|sábado|domingo|apartamento|unidad|pm|am|p\.?\s*m\.?|a\.?\s*m\.?|esquina|llamame|ll[aá]mame)$/i.test(
        candidate,
      ) ||
      /\b(pm|am|p\.?\s*m\.?|a\.?\s*m\.?|esquina|llamame|ll[aá]mame)\b/i.test(candidate);
    if (!bad && isValidPersonName(candidate)) return candidate;
    const cleaned = candidate
      .replace(/^(p\.?\s*m\.?|a\.?\s*m\.?|pm|am)\s+/i, "")
      .trim();
    if (cleaned.split(/\s+/).length >= 1 && cleaned.length >= 3 && isValidPersonName(cleaned)) {
      return cleaned.slice(0, 80);
    }
  }
  return "";
}

function extractHouseFacts(text: string): { unit?: string; reference?: string } {
  const casa = text.match(/\bcasa\s+(\d+[a-zA-Z]?)\b/i);
  const ref = text.match(/\ben\s+la\s+esquina\b/i);
  return {
    ...(casa ? { unit: casa[1].toUpperCase() } : {}),
    ...(ref ? { reference: "en la esquina" } : {}),
  };
}

/** Bare "Juan Alberto" when the bot just asked for the customer name. */
function extractBareNameReply(text: string, state: ConversationState) {
  const awaitingName =
    state.facts?.lastAskedField === "customer_name" ||
    state.facts?.lastAskedField === "name" ||
    /nombre|a nombre de qui[eé]n|c[oó]mo te llamas/i.test(state.facts?.lastBotQuestion || "");
  if (!awaitingName || state.name) return "";
  const trimmed = text.trim();
  if (!/^[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]*(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]*){0,3}$/.test(trimmed)) {
    return "";
  }
  if (looksLikePhoneAttempt(trimmed) || /^(si|sí|no|ok|hola|gracias|mañana|hoy)$/i.test(trimmed)) return "";
  return trimmed.slice(0, 80);
}

function titleCasePhrase(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

const KNOWN_ZONES: Array<{ re: RegExp; label: string }> = [
  { re: /\bedison\s+park\b/i, label: "Edison Park" },
  { re: /\bpanam[aá]\s+centro\b/i, label: "Panamá Centro" },
  { re: /\bbella\s+vista\b/i, label: "Bella Vista" },
  { re: /\bbetania\b/i, label: "Betania" },
  { re: /\bsan\s+miguelito\b/i, label: "San Miguelito" },
  { re: /\btocumen\b/i, label: "Tocumen" },
  { re: /\bjuan\s+d[ií]az\b/i, label: "Juan Díaz" },
  { re: /\bel\s+cangrejo\b/i, label: "El Cangrejo" },
  { re: /\bcosta\s+del\s+este\b/i, label: "Costa del Este" },
  { re: /\bpueblo\s+nuevo\b/i, label: "Pueblo Nuevo" },
  { re: /\bparque\s+lefevre\b/i, label: "Parque Lefevre" },
  { re: /\br[ií]o\s+abajo\b/i, label: "Río Abajo" },
  { re: /\bcalidonia\b/i, label: "Calidonia" },
  { re: /\blas\s+cumbres\b/i, label: "Las Cumbres" },
  { re: /\bsan\s+francisco\b/i, label: "San Francisco" },
  { re: /\bel\s+dorado\b/i, label: "El Dorado" },
  { re: /\bobarrio\b/i, label: "Obarrio" },
  { re: /\bpaitilla\b/i, label: "Paitilla" },
  { re: /\balbrook\b/i, label: "Albrook" },
  { re: /\bclayton\b/i, label: "Clayton" },
  { re: /\bchorrera\b/i, label: "Chorrera" },
  { re: /\barraij[aá]n\b/i, label: "Arraiján" },
];

const GREETING_WORD = /^(hola|buenas|buenos|hey|saludos|buen\s+d[ií]a)$/i;

function isGreetingLocationCandidate(candidate: string) {
  const trimmed = candidate.trim();
  return !trimmed || GREETING_WORD.test(trimmed);
}

function extractLocation(text: string, state?: ConversationState) {
  const trimmed = text.trim();
  const blob = fold(trimmed);

  if (/panam[aá]\s+centro[,\s]+edison\s+park|edison\s+park[,\s]+panam[aá]\s+centro/i.test(trimmed)) {
    return "Panamá Centro, Edison Park";
  }

  const zonesFound: string[] = [];
  for (const zone of KNOWN_ZONES) {
    if (zone.re.test(trimmed)) zonesFound.push(zone.label);
  }
  if (zonesFound.length) return zonesFound.join(", ");

  const betterIn = trimmed.match(/\bmejor\s+en\s+([^\n,.;]{3,80})/i);
  if (betterIn?.[1]) return titleCasePhrase(betterIn[1].trim());

  const patterns = [
    /\b(?:estoy en|vivo en|vivo por|me encuentro en|ubicad[oa] en)\s+([^\n,.;]{3,80})/i,
    /\ben\s+([^\n,.;]{3,60})\b/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1]?.trim() || "";
    if (candidate && !/\d{4}/.test(candidate) && !/^\d+$/.test(candidate)) {
      if (looksLikeScheduleLocationCandidate(candidate)) continue;
      if (isGreetingLocationCandidate(candidate)) continue;
      if (!/^\bph\b|apartamento|apto$/i.test(candidate)) {
        return titleCasePhrase(candidate);
      }
    }
  }

  const leading = trimmed.match(
    /^\s*([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})\s*,\s*(?:ph|edificio|apartamento|apto)\b/i,
  );
  if (leading?.[1] && !isGreetingLocationCandidate(leading[1])) return titleCasePhrase(leading[1]);

  const awaitingLocation =
    state?.facts?.lastAskedField === "location" ||
    /zona|ubicaci[oó]n|d[oó]nde ser[ií]a/i.test(state?.facts?.lastBotQuestion || "");
  if (
    awaitingLocation &&
    trimmed.length >= 3 &&
    trimmed.length <= 80 &&
    !looksLikePhoneAttempt(trimmed) &&
    !/^\d+$/.test(trimmed) &&
    !/^(si|sí|no|ok|hola|gracias)$/i.test(trimmed)
  ) {
    return titleCasePhrase(trimmed);
  }

  return "";
}

function extractBareQuantityReply(text: string, state: ConversationState) {
  const awaiting =
    state.facts?.lastAskedField === "units" ||
    /cu[aá]ntos aires|cu[aá]ntos equipos|cu[aá]ntas unidades/i.test(state.facts?.lastBotQuestion || "");
  if (!awaiting) return "";
  const trimmed = text.trim();
  if (/^\d{1,2}$/.test(trimmed)) return trimmed;
  const word = fold(trimmed).match(/^(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/);
  if (word) return WORD_NUM[word[1]] || "";
  return "";
}

/** Bare "3A" / "3 a" when bot asked for apartment/unit. */
function extractBareUnitReply(text: string, state: ConversationState) {
  const awaiting =
    state.facts?.lastAskedField === "unit" ||
    /apartamento|unidad|n[uú]mero de apartamento|qu[eé] apartamento/i.test(state.facts?.lastBotQuestion || "");
  if (!awaiting) return "";
  const trimmed = text.trim().replace(/\s+/g, "");
  if (/^(\d+[a-zA-Z]|[a-zA-Z]\d+|\d+)$/i.test(trimmed)) return trimmed.toUpperCase();
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
  const tengo = blob.match(/\btengo\s+(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d+)\b/);
  if (tengo && /\b(aire|equipo|split|minisplit|ac)\b/.test(blob)) {
    return WORD_NUM[tengo[1]] || tengo[1];
  }
  const de = blob.match(/\b(?:mantenimiento\s+)?(?:de|para)\s+(dos|tres|cuatro|cinco|\d+)\s+(?:aires?|equipos?)\b/);
  if (de) return WORD_NUM[de[1]] || de[1];
  return "";
}

function extractAffectedUnits(text: string): string {
  const blob = fold(text);
  if (/\b(?:es\s+)?uno\s+solo\b|\bsolo\s+uno\b|\bun[oa]?\s+(?:est[aá]|falla|mal)\b/.test(blob)) return "1";
  if (/\b(?:solo|solamente)\s+(\d+)\b/.test(blob)) {
    const m = blob.match(/\b(?:solo|solamente)\s+(\d+)\b/);
    return m?.[1] || "";
  }
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
    { key: "waterLeak", re: /bota(?:ndo)?\s+agua|gotea|goteo|fuga de agua|ca[eé]\s+agua/, label: "agua / goteo" },
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
  if (/\bph\b/i.test(text)) return "ph";
  if (/\bapartamento|apto\b/i.test(text)) return "apartment";
  if (/\bcasa\b/i.test(text)) return "house";
  if (/\boficina\b/i.test(text)) return "office";
  if (/\blocal\b/i.test(text)) return "commerce";
  return "";
}

function extractBuildingFacts(text: string): {
  building?: string;
  tower?: string;
  unit?: string;
  addressText?: string;
  inferredUnitCandidate?: string;
} {
  const phTrailing = text.match(/\bph\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\s]{1,40}?)\s+(\d{2,5})\b/i);
  if (phTrailing && !/\b(?:apto|apartamento|unidad|apt\.?)\b/i.test(text)) {
    const building = phTrailing[1].trim();
    return {
      building,
      addressText: `PH ${building} ${phTrailing[2]}`,
      inferredUnitCandidate: phTrailing[2],
    };
  }
  const elBuilding = text.match(/\ben\s+el\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\s]{1,30}?)\s+(\d+[a-zA-Z]?)\b/i);
  if (elBuilding) {
    return {
      building: elBuilding[1].trim(),
      unit: elBuilding[2].replace(/\s+/g, "").toUpperCase(),
    };
  }
  const building =
    text.match(/\b(?:ph|edificio|residencial)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\s]{1,40}?)(?:\s*,|\s*$|\s+(?:apto|apartamento|unidad))/i)?.[1]?.trim() ||
    text.match(/\ben\s+(?:el\s+)?ph\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\s]{1,40})/i)?.[1]?.trim() ||
    "";
  const tower = text.match(/\btorre\s+([A-Za-z0-9ÁÉÍÓÚáéíóúñÑ]+)/i)?.[1] || "";
  const unit =
    text.match(/\b(?:apto|apartamento|unidad|apt\.?)\s*(\d+)\s*([A-Za-z])\b/i)?.slice(1)?.join("") ||
    text.match(/\b(?:apto|apartamento|unidad|apt\.?)\s*([A-Za-z0-9\-]+)/i)?.[1] ||
    text.match(/\bapartamento\s+([A-Za-z0-9\-]+)/i)?.[1] ||
    "";
  const normalizedUnit = unit ? unit.replace(/\s+/g, "").toUpperCase() : "";
  return {
    ...(building ? { building } : {}),
    ...(tower ? { tower: tower.trim() } : {}),
    ...(normalizedUnit ? { unit: normalizedUnit } : {}),
  };
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
  const buildingFacts = extractBuildingFacts(text);
  const houseFacts = extractHouseFacts(text);
  return {
    name: extractName(text),
    location: extractLocation(text) || correction,
    phone: extractEmbeddedPhone(text),
    contactPreference: extractContactPreference(text),
    propertyType: extractPropertyType(text),
    units: extractUnits(text),
    affectedUnits: extractAffectedUnits(text),
    symptom,
    duration: extractDuration(text),
    activeLeak: plumbing.activeLeak,
    hazard: electrical.hazard,
    ...buildingFacts,
    ...houseFacts,
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
  const explicitCorrection = detectExplicitCorrection(text);
  let next: ConversationState = mergeConfirmedFacts(state, {}, { explicitCorrection });

  const rawLoc = packed.location || extractLocation(text, state);
  const locCandidate =
    rawLoc && !looksLikeScheduleLocationCandidate(rawLoc) && !isScheduleOrTimeOnlyMessage(text)
      ? rawLoc
      : "";
  const hasConfirmedLocation = Boolean(state.location || state.facts?.location);
  const shouldUpdateLocation =
    Boolean(locCandidate) &&
    !isScheduleOrTimeOnlyMessage(text) &&
    (!hasConfirmedLocation || isLocationExplicitCorrection(text));

  if (shouldUpdateLocation && locCandidate) {
    const location = applyLocationCorrection(text, locCandidate);
    if (!looksLikeScheduleLocationCandidate(location)) {
      next = mergeConfirmedFacts(next, {
        location,
        facts: { ...(next.facts || {}), location },
      });
      next.factConfidence = setConfidence(next.factConfidence || {}, "location", "EXPLICIT");
    }
  }

  if (packed.name) {
    next = mergeConfirmedFacts(next, { name: packed.name });
    next.factConfidence = setConfidence(next.factConfidence || {}, "name", "EXPLICIT");
  } else {
    const bare = extractBareNameReply(text, state);
    if (bare) {
      next = mergeConfirmedFacts(next, { name: bare });
      next.factConfidence = setConfidence(next.factConfidence || {}, "name", "EXPLICIT");
    }
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
  if (packed.propertyType) {
    next.propertyType = packed.propertyType;
    next.facts.propertyType = packed.propertyType;
  }
  if (/^\s*mejor no[\s!.?]*$/i.test(text.trim()) || /\bmejor no[,.]?\s*(gracias)?[\s!.?]*$/i.test(text.trim())) {
    if (next.primaryService || next.service) {
      next.facts = { ...(next.facts || {}), abandonedService: next.primaryService || next.service };
      next.primaryService = "";
      next.service = "";
      next.detectedServices = [];
      next.activeLeadId = "";
      next.offeredSlots = [];
      next.awaitingSlotSelection = false;
      next.bookingIntent = false;
    }
  }
  if (packed.building) {
    next.facts = { ...(next.facts || {}), building: packed.building, ph: packed.building };
    next.factConfidence = setConfidence(next.factConfidence || {}, "building", "EXPLICIT");
    if (!next.propertyType) {
      next.propertyType = "ph";
      next.facts.propertyType = "ph";
    }
  }
  if ((packed as { addressText?: string }).addressText) {
    next.facts.addressText = (packed as { addressText?: string }).addressText || "";
  }
  if ((packed as { inferredUnitCandidate?: string }).inferredUnitCandidate) {
    next.facts.inferredUnitCandidate = (packed as { inferredUnitCandidate?: string }).inferredUnitCandidate || "";
  }
  if (packed.tower) {
    next.facts.tower = packed.tower;
    next.factConfidence = setConfidence(next.factConfidence || {}, "tower", "EXPLICIT");
  }
  if ((packed as { reference?: string }).reference) {
    next.facts.reference = (packed as { reference?: string }).reference || "";
    next.factConfidence = setConfidence(next.factConfidence || {}, "reference", "EXPLICIT");
  }
  const bareUnit = extractBareUnitReply(text, state);
  const unitCandidate = bareUnit || packed.unit || (packed as { unit?: string }).unit || "";
  const safeUnit = sanitizeInferredUnit(text, unitCandidate, packed.building || next.facts?.building || "");
  if (safeUnit) {
    next.facts.unit = safeUnit;
    next.facts.apartment = safeUnit;
    next.factConfidence = setConfidence(next.factConfidence || {}, "unit", "EXPLICIT");
  }
  // If PH/unit known but zone empty, recover leading district from the same message
  if (!next.location && (packed.building || packed.unit)) {
    const leading = text.match(
      /^\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})\s*,/i,
    );
    if (leading?.[1] && !/\bph\b|apartamento|apto/i.test(leading[1])) {
      next.location = leading[1].trim();
      next.facts.location = next.location;
      next.factConfidence = setConfidence(next.factConfidence || {}, "location", "HIGH_CONFIDENCE");
    }
  }
  const bareQty = extractBareQuantityReply(text, state);
  const unitsVal = bareQty || packed.units;
  if (unitsVal) {
    next.facts.units = unitsVal;
    next.factConfidence = setConfidence(next.factConfidence || {}, "units", "EXPLICIT");
  }
  if (packed.affectedUnits) {
    next.facts.affectedUnits = packed.affectedUnits;
    next.factConfidence = setConfidence(next.factConfidence || {}, "affectedUnits", "EXPLICIT");
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
    next.facts = {
      ...(next.facts || {}),
      serviceRefinedFrom: previousPrimary,
      serviceRefinedTo: next.primaryService,
    };
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
