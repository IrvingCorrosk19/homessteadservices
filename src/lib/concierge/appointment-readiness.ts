import type { ConversationState } from "@/lib/concierge-store";
import { classifyPhone } from "@/lib/phone";
import { isSlotConfirmed } from "@/lib/concierge/canonical-state";

export type AppointmentMissingField =
  | "customer_name"
  | "contact"
  | "location"
  | "service"
  | "slot"
  | "property_type"
  | "building"
  | "unit";

export type AppointmentReadiness = {
  ready: boolean;
  missingFields: AppointmentMissingField[];
  knownFields: string[];
  requiresBuildingDetail: boolean;
};

const GENERIC_NAMES = /^(cliente(\s+web)?|usuario|test|prueba)$/i;
const WEAK_LOCATION = /^(ciudad de panam[aá]|panam[aá]|panama city)$/i;

function isPhOrApartment(propertyType: string) {
  const value = (propertyType || "").toLowerCase();
  return value === "ph" || value === "apartment" || value === "apartamento";
}

function hasBuilding(state: ConversationState) {
  return Boolean(state.facts?.building || state.facts?.ph);
}

function hasUnit(state: ConversationState) {
  return Boolean(state.facts?.unit || state.facts?.apartment);
}

/**
 * Operational location gate — NOT street perfection.
 * - Named PH/edificio: zone + building + unit
 * - Apartment without building name: zone + unit is enough (e.g. Edison Park apt 3A)
 * - House/office: zone alone (4+ chars) is enough
 */
export function isLocationSufficient(state: ConversationState): boolean {
  const location = (state.location || state.facts?.location || "").trim();
  const building = (state.facts?.building || state.facts?.ph || "").trim();
  const unit = (state.facts?.unit || state.facts?.apartment || "").trim();
  const propertyType = (state.propertyType || state.facts?.propertyType || "").trim().toLowerCase();
  const namedPh = Boolean(building) || propertyType === "ph";
  const isApartment = propertyType === "apartment" || propertyType === "apartamento";

  if (location && !WEAK_LOCATION.test(location)) {
    if (namedPh) return Boolean(building && unit);
    if (isApartment) return Boolean(unit) || location.length >= 4;
    if (building || unit) return true;
    return location.length >= 4;
  }

  if (building && unit) return true;

  if (location && /\bph\b|apartamento|apto/i.test(location) && (building || unit || /\d/.test(location))) {
    return true;
  }

  return false;
}

/** User already named an exact date+time (e.g. "mañana a las 2 pm") before calendar offer. */
export function hasRequestedExactWhen(state: ConversationState): boolean {
  return Boolean(
    state.preferredDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(state.preferredDate) &&
      state.preferredTime &&
      /^\d{2}:\d{2}$/.test(state.preferredTime),
  );
}

/** Deterministic gate: who / contact / where / what / when before CONFIRMED visit. */
export function getAppointmentReadiness(state: ConversationState, slot?: { date: string; time: string } | null): AppointmentReadiness {
  const missing: AppointmentMissingField[] = [];
  const known: string[] = [];

  const name = (state.name || "").trim();
  if (name && !GENERIC_NAMES.test(name)) known.push("customer_name");
  else missing.push("customer_name");

  const phone = classifyPhone(state.phone);
  const hasContact = phone.status === "VALID" || state.contactStatus === "VALID" || Boolean(state.email?.includes("@"));
  if (hasContact) known.push("contact");
  else missing.push("contact");

  let propertyType = (state.propertyType || state.facts?.propertyType || "").trim();
  if (!propertyType && (hasBuilding(state) || /\bph\b/i.test(state.location || ""))) {
    propertyType = "ph";
  } else if (!propertyType && (hasUnit(state) || /apartamento|apto/i.test(state.location || ""))) {
    propertyType = "apartment";
  }

  const locationOk = isLocationSufficient(state);
  const zoneKnown =
    Boolean((state.location || state.facts?.location || "").trim()) &&
    !WEAK_LOCATION.test((state.location || state.facts?.location || "").trim());
  if (locationOk) known.push("location");
  else if (zoneKnown) {
    // Zone is known; incompleteness is building/unit — do NOT re-ask "zona"
    known.push("location");
  } else missing.push("location");

  const service = state.primaryService || state.service;
  const problem = (state.problem || state.facts?.need || state.facts?.what || "").trim();
  if ((service && service !== "unknown" && service !== "other") || problem.length >= 8) known.push("service");
  else missing.push("service");

  const activeSlot = slot || state.pendingSlot;
  const preferredMatchesOffer =
    Boolean(state.preferredDate && state.preferredTime) &&
    Boolean(
      state.offeredSlots?.some((s) => s.date === state.preferredDate && s.time === state.preferredTime) ||
        (state.pendingSlot?.date === state.preferredDate && state.pendingSlot?.time === state.preferredTime),
    );
  // Exact user-requested when counts as scheduling intent; calendar must still query,
  // but we must NOT ask "qué día y hora" again (P0 Case B).
  if (activeSlot?.date && activeSlot?.time) known.push("slot");
  else if (preferredMatchesOffer) known.push("slot");
  else if (isSlotConfirmed(state)) known.push("slot");
  else if (hasRequestedExactWhen(state)) known.push("slot");
  else missing.push("slot");

  const namedPh = Boolean(hasBuilding(state)) || propertyType === "ph";
  const requiresBuildingDetail = namedPh;
  const requiresUnit = namedPh || propertyType === "apartment" || propertyType === "apartamento";

  if (locationOk) {
    if (propertyType || hasBuilding(state) || hasUnit(state)) known.push("property_type");
    if (hasBuilding(state) || !requiresBuildingDetail) known.push("building");
    if (hasUnit(state) || !requiresUnit) known.push("unit");
  } else {
    if (!propertyType && !hasBuilding(state) && !hasUnit(state)) missing.push("property_type");
    else known.push("property_type");

    if (requiresBuildingDetail && !hasBuilding(state)) missing.push("building");
    else known.push("building");

    if (requiresUnit && !hasUnit(state)) missing.push("unit");
    else known.push("unit");
  }

  return {
    ready: missing.length === 0,
    missingFields: missing,
    knownFields: known,
    requiresBuildingDetail,
  };
}

export function readinessPromptHint(readiness: AppointmentReadiness) {
  if (readiness.ready) {
    return "APPOINTMENT_READINESS: ready=true. Debes crear la cita con create_appointment YA (no inventes más preguntas: ni referencia, ni dirección precisa, ni 'algún otro detalle'). Luego confirma en lenguaje natural.";
  }
  const labels: Record<AppointmentMissingField, string> = {
    customer_name: "nombre del cliente",
    contact: "teléfono de contacto",
    location: "zona (ej. San Miguelito). Si ya hay PH + apartamento, NO pidas dirección de calle",
    service: "necesidad/servicio",
    slot: "fecha y hora elegidas",
    property_type: "tipo de inmueble (casa, apartamento, PH, oficina, local)",
    building: "nombre del PH/edificio",
    unit: "apartamento/unidad",
  };
  return `APPOINTMENT_READINESS: ready=false. Falta SOLO: ${readiness.missingFields.map((f) => labels[f]).join("; ")}. PROHIBIDO preguntar campos que no estén en esa lista. PROHIBIDO pedir "referencia adicional", "dirección precisa" o "algún otro detalle" si no aparecen arriba. NO llames create_appointment. NO digas que la visita ya quedó agendada. Pregunta UNA cosa que falte.`;
}

export function firstMissingQuestion(readiness: AppointmentReadiness, preferField?: AppointmentMissingField | ""): string {
  const first = preferField || readiness.missingFields[0];
  switch (first) {
    case "customer_name":
      return "¿A nombre de quién coordinamos la visita?";
    case "contact":
      return "¿Cuál es el mejor número para contactarte?";
    case "location":
      return "¿En qué zona sería el trabajo?";
    case "property_type":
      return "¿Es una casa, apartamento, PH, oficina o local?";
    case "building":
      return "¿Cuál es el nombre del PH o edificio?";
    case "unit":
      return "¿Qué apartamento o unidad debemos visitar?";
    case "service":
      return "Cuéntame un poco más qué hay que revisar en la visita.";
    case "slot":
      return "¿Qué día y hora te quedan mejor?";
    default:
      return "Me falta un dato para confirmar la visita. ¿Me ayudas con eso?";
  }
}
