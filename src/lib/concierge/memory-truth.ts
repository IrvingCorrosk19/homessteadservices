import type { ConversationState } from "@/lib/concierge-store";

export type MemoryAnswer = {
  handled: boolean;
  reply: string;
};

const MEMORY_Q =
  /\b(sabes?|conoces?|tienes?|recuerdas?)\b.{0,40}\b(c[oó]mo me llamo|mi nombre|d[oó]nde (es|queda|est[aá])|ubicaci[oó]n|direcci[oó]n|si es (ph|apartamento|casa|oficina)|tipo de (propiedad|inmueble)|es ph)\b/i;

const NAME_Q = /\b(c[oó]mo me llamo|mi nombre)\b/i;
const LOCATION_Q = /\b(d[oó]nde (es|queda|est[aá])|ubicaci[oó]n|direcci[oó]n)\b/i;
const PROPERTY_Q = /\b(si es (ph|apartamento|casa|oficina)|tipo de (propiedad|inmueble)|es ph)\b/i;

function knownName(state: ConversationState) {
  const name = (state.name || "").trim();
  if (!name || /^(cliente(\s+web)?|usuario)$/i.test(name)) return "";
  return name;
}

function knownLocation(state: ConversationState) {
  return (state.location || state.facts?.location || "").trim();
}

function propertyLabel(state: ConversationState) {
  const raw = (state.propertyType || state.facts?.propertyType || "").toLowerCase();
  const map: Record<string, string> = {
    house: "casa",
    casa: "casa",
    apartment: "apartamento",
    apartamento: "apartamento",
    ph: "PH",
    office: "oficina",
    oficina: "oficina",
    commerce: "local",
    local: "local",
  };
  return map[raw] || "";
}

const REQUEST_Q = /\b(cu[aá]l es mi solicitud|mi solicitud|n[uú]mero de solicitud|mi referencia|mi folio|hs-\d)/i;

/** Deterministic truthful answers to memory / reference questions. */
export function answerMemoryQuestion(text: string, state: ConversationState, activeRequestId = ""): MemoryAnswer {
  const hs = activeRequestId || state.activeLeadId || "";
  if (REQUEST_Q.test(text) && /\?|cu[aá]l|n[uú]mero|referencia|folio/.test(text.toLowerCase())) {
    return hs && !hs.startsWith("DRY-")
      ? { handled: true, reply: `Tu solicitud activa es ${hs}.` }
      : { handled: true, reply: "Todavía no tengo una solicitud registrada. Cuéntame qué servicio necesitas y la abro enseguida." };
  }

  if (!MEMORY_Q.test(text) && !(NAME_Q.test(text) && /\?|sabes|conoces|tienes/.test(text.toLowerCase()))) {
    if (!(NAME_Q.test(text) || LOCATION_Q.test(text) || PROPERTY_Q.test(text)) || !/\?|sabes|conoces|tienes|pero/.test(text.toLowerCase())) {
      return { handled: false, reply: "" };
    }
  }

  const asksName = NAME_Q.test(text);
  const asksLocation = LOCATION_Q.test(text);
  const asksProperty = PROPERTY_Q.test(text);
  const multi = [asksName, asksLocation, asksProperty].filter(Boolean).length >= 2 || /demas|demás|etc/.test(text.toLowerCase());

  if (!asksName && !asksLocation && !asksProperty) {
    return { handled: false, reply: "" };
  }

  const name = knownName(state);
  const location = knownLocation(state);
  const property = propertyLabel(state);
  const parts: string[] = [];

  if (asksName || multi) {
    parts.push(name ? `Sí, tengo tu nombre como ${name}.` : "Todavía no tengo tu nombre.");
  }
  if (asksLocation || multi) {
    if (location && !/^(ciudad de panam[aá]|panam[aá])$/i.test(location)) {
      parts.push(`Tengo la ubicación como ${location}.`);
    } else if (location) {
      parts.push(`Tengo que es en ${location}, pero todavía me falta la ubicación exacta para que el técnico pueda llegar.`);
    } else {
      parts.push("Todavía no tengo la ubicación exacta.");
    }
  }
  if (asksProperty || multi) {
    if (property) {
      const building = state.facts?.building || state.facts?.ph || "";
      const unit = state.facts?.unit || state.facts?.apartment || "";
      const detail = [building, unit].filter(Boolean).join(", ");
      parts.push(detail ? `Tengo que es ${property}: ${detail}.` : `Tengo que es ${property}.`);
    } else {
      parts.push("No todavía. ¿Es una casa, apartamento, PH, oficina o local?");
    }
  }

  const nextAsk = !name
    ? " Empecemos por tu nombre: ¿cómo te llamas?"
    : !location || /^(ciudad de panam[aá]|panam[aá])$/i.test(location)
      ? " ¿En qué zona o dirección sería la visita?"
      : !property
        ? " ¿Es casa, apartamento, PH, oficina o local?"
        : "";

  return {
    handled: true,
    reply: `${parts.join(" ")}${nextAsk}`.trim(),
  };
}

export function stripFalseThankYou(reply: string, userText: string) {
  const userGaveFacts =
    /\b(soy|me llamo|vivo|estoy en|mi (n[uú]mero|tel[eé]fono)|ph\b|apto|apartamento|casa|oficina)\b/i.test(userText) ||
    /\d{6,}/.test(userText);
  if (userGaveFacts) return reply;
  if (/gracias por la informaci[oó]n/i.test(reply) && (/\?|sabes|conoces|tienes/.test(userText) || MEMORY_Q.test(userText))) {
    return reply.replace(/gracias por la informaci[oó]n[^.!]*[.!]?\s*/gi, "").trim();
  }
  return reply;
}
