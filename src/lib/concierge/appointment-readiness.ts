import type { ConversationState } from "@/lib/concierge-store";
import { classifyPhone } from "@/lib/phone";

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

function hasBuildingDetail(state: ConversationState) {
  const facts = state.facts || {};
  return Boolean(facts.building || facts.ph || facts.tower || facts.unit || facts.apartment);
}

function isPhOrApartment(propertyType: string) {
  const value = (propertyType || "").toLowerCase();
  return value === "ph" || value === "apartment" || value === "apartamento";
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

  const location = (state.location || state.facts?.location || "").trim();
  if (location && !WEAK_LOCATION.test(location)) known.push("location");
  else missing.push("location");

  const service = state.primaryService || state.service;
  const problem = (state.problem || state.facts?.need || state.facts?.what || "").trim();
  if ((service && service !== "unknown" && service !== "other") || problem.length >= 8) known.push("service");
  else missing.push("service");

  const activeSlot = slot || state.pendingSlot;
  if (activeSlot?.date && activeSlot?.time) known.push("slot");
  else if (state.preferredDate && state.preferredTime && state.awaitingSlotSelection === false && state.offeredSlots?.some((s) => s.date === state.preferredDate && s.time === state.preferredTime)) {
    known.push("slot");
  } else {
    missing.push("slot");
  }

  const propertyType = (state.propertyType || state.facts?.propertyType || "").trim();
  const requiresBuildingDetail = isPhOrApartment(propertyType);
  if (!propertyType) missing.push("property_type");
  else known.push("property_type");

  if (requiresBuildingDetail) {
    if (!hasBuildingDetail(state)) {
      if (!state.facts?.building && !state.facts?.ph) missing.push("building");
      if (!state.facts?.unit && !state.facts?.apartment) missing.push("unit");
    } else {
      known.push("building_detail");
    }
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
    return "APPOINTMENT_READINESS: ready=true. Puedes resumir y pedir confirmación final antes de create_appointment.";
  }
  const labels: Record<AppointmentMissingField, string> = {
    customer_name: "nombre del cliente",
    contact: "teléfono de contacto",
    location: "ubicación/dirección suficiente para llegar",
    service: "necesidad/servicio",
    slot: "fecha y hora elegidas",
    property_type: "tipo de inmueble (casa, apartamento, PH, oficina, local)",
    building: "nombre del PH/edificio",
    unit: "apartamento/unidad",
  };
  return `APPOINTMENT_READINESS: ready=false. Falta: ${readiness.missingFields.map((f) => labels[f]).join("; ")}. NO llames create_appointment. NO digas que la visita ya quedó agendada. Pregunta de forma natural UNA o dos cosas que falten.`;
}

export function firstMissingQuestion(readiness: AppointmentReadiness): string {
  const first = readiness.missingFields[0];
  switch (first) {
    case "customer_name":
      return "Antes de reservarlo, ¿a nombre de quién coordinamos la visita?";
    case "contact":
      return "¿Cuál es el mejor número para contactarte sobre la visita?";
    case "location":
      return "¿En qué zona o dirección sería el trabajo?";
    case "property_type":
      return "¿Es una casa, apartamento, PH, oficina o local?";
    case "building":
      return "Perfecto. ¿Cuál es el nombre del PH o edificio?";
    case "unit":
      return "¿Qué apartamento o unidad debemos visitar?";
    case "service":
      return "Cuéntame un poco más qué hay que revisar en la visita.";
    case "slot":
      return "¿Qué día y hora te quedan mejor?";
    default:
      return "Me falta un dato para poder confirmar la visita. ¿Me ayudas con eso?";
  }
}
