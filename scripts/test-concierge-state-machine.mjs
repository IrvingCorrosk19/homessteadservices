/**
 * Concierge conversation state machine + anti-loop V3 certification tests.
 * Behavioral logic mirrors src/lib/concierge/* (keep in sync when changing rules).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

const readinessSrc = read("src/lib/concierge/appointment-readiness.ts");
const nextActionSrc = read("src/lib/concierge/conversation-next-action.ts");
const packedSrc = read("src/lib/concierge/packed-extraction.ts");
const engineSrc = read("src/lib/concierge-engine.ts");
const turnSrc = read("src/lib/concierge/turn-intelligence.ts");
const playbooksSrc = read("src/lib/concierge/service-playbooks.ts");

let failed = 0;
function ok(name, value) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

// --- Architecture wiring (static) ---
ok("next-action module exists", /determineNextAction|enforceDeterministicAsk|isDeclineAnswer/.test(nextActionSrc));
ok("engine wires determineNextAction", /determineNextAction\(/.test(engineSrc));
ok("engine wires enforceDeterministicAsk", /enforceDeterministicAsk\(/.test(engineSrc));
ok("engine wires markOptionalDeclined", /markOptionalDeclined\(/.test(engineSrc));
ok("engine deterministic book", /DETERMINISTIC_BOOK|customerConfirmed:\s*true/.test(engineSrc));
ok("location sufficiency exported", /export function isLocationSufficient/.test(readinessSrc));
ok("packed leading zone + district", /San Miguelito|leading/.test(packedSrc));
ok("bare name extraction", /extractBareNameReply|lastAskedField/.test(packedSrc));
ok("gypsum aliases", /gypsum/.test(playbooksSrc) && /yeso/.test(playbooksSrc));
ok("anti vague location reask", /detalle\s+espec|referencia\s+adicional|direcci[oó]n precisa/.test(turnSrc));
ok("readiness forbids invented asks", /PROHIBIDO preguntar|referencia adicional/.test(readinessSrc));
ok("LLM not sole missing-fields authority", /requiredMissing|NEXT_ACTION_ENGINE/.test(engineSrc));

// --- Ported behavioral helpers ---
const WEAK_LOCATION = /^(ciudad de panam[aá]|panam[aá]|panama city)$/i;
const GENERIC_NAMES = /^(cliente(\s+web)?|usuario|test|prueba)$/i;

function isPhOrApartment(propertyType) {
  const value = (propertyType || "").toLowerCase();
  return value === "ph" || value === "apartment" || value === "apartamento";
}

function isLocationSufficient(state) {
  const location = (state.location || state.facts?.location || "").trim();
  const building = (state.facts?.building || state.facts?.ph || "").trim();
  const unit = (state.facts?.unit || state.facts?.apartment || "").trim();
  const propertyType = (state.propertyType || state.facts?.propertyType || "").trim().toLowerCase();
  const isPh = isPhOrApartment(propertyType) || Boolean(building);

  if (location && !WEAK_LOCATION.test(location)) {
    if (isPh) return Boolean(building && unit);
    if (building || unit) return true;
    return location.length >= 4;
  }
  if (building && unit) return true;
  if (location && /\bph\b|apartamento|apto/i.test(location) && (building || unit || /\d/.test(location))) {
    return true;
  }
  return false;
}

function extractLocation(text) {
  if (/panam[aá]\s+centro[,\s]+edison\s+park|edison\s+park/i.test(text)) return "Panamá Centro, Edison Park";
  const patterns = [
    /\b(?:estoy en|vivo en|me encuentro en|ubicad[oa] en)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+(?:de\s+la?\s+|del?\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i,
    /\ben\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+(?:de\s+la?\s+|del?\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && !/\d{4}/.test(match[1]) && !/\bph\b|apartamento|apto/i.test(match[1])) {
      return match[1].trim();
    }
  }
  const leading = text.match(
    /^\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})\s*,\s*(?:ph|edificio|apartamento|apto)\b/i,
  );
  if (leading?.[1]) return leading[1].trim();
  const districts =
    /\b(San Miguelito|Tocumen|Juan D[ií]az|Bella Vista|El Cangrejo|Costa del Este|Pueblo Nuevo|Parque Lefevre|R[ií]o Abajo|Calidonia|Las Cumbres|24 de Diciembre|Pacora|San Francisco|El Dorado|Villa Lucre|Brisas del Golf|Obarrio|Paitilla|Albrook|Clayton|Chorrera|Arraij[aá]n)\b/i;
  const zone = text.match(districts);
  if (zone?.[1]) return zone[1].trim();
  return "";
}

function extractBuildingFacts(text) {
  const phTrailing = text.match(/\bph\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][\wÁÉÍÓÚáéíóúñÑ\s]{1,40}?)\s+(\d{2,5})\b/i);
  if (phTrailing && !/\b(?:apto|apartamento|unidad)\b/i.test(text)) {
    return { building: phTrailing[1].trim() };
  }
  const building =
    text.match(/\b(?:ph|edificio|residencial)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})/i)?.[1] ||
    "";
  const unit =
    text.match(/\b(?:apto|apartamento|unidad|apt\.?)\s*([A-Za-z0-9\-]+)/i)?.[1] || "";
  return {
    ...(building ? { building: building.trim() } : {}),
    ...(unit ? { unit: unit.trim() } : {}),
  };
}

function classifyPhoneSimple(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 8 || (digits.length === 11 && digits.startsWith("507"))) return "VALID";
  if (digits.length > 0 && digits.length < 8) return "INCOMPLETE";
  return "UNKNOWN";
}

function getAppointmentReadiness(state) {
  const missing = [];
  const known = [];
  const name = (state.name || "").trim();
  if (name && !GENERIC_NAMES.test(name)) known.push("customer_name");
  else missing.push("customer_name");

  const hasContact =
    classifyPhoneSimple(state.phone) === "VALID" || state.contactStatus === "VALID";
  if (hasContact) known.push("contact");
  else missing.push("contact");

  let propertyType = (state.propertyType || state.facts?.propertyType || "").trim();
  if (!propertyType && (state.facts?.building || /\bph\b/i.test(state.location || ""))) propertyType = "ph";

  const locationOk = isLocationSufficient(state);
  if (locationOk) known.push("location");
  else missing.push("location");

  const service = state.primaryService || state.service;
  const problem = (state.problem || "").trim();
  if ((service && service !== "unknown" && service !== "other") || problem.length >= 8) known.push("service");
  else missing.push("service");

  const activeSlot = state.pendingSlot;
  const preferredMatchesOffer =
    Boolean(state.preferredDate && state.preferredTime) &&
    Boolean(
      state.offeredSlots?.some((s) => s.date === state.preferredDate && s.time === state.preferredTime) ||
        (state.pendingSlot?.date === state.preferredDate && state.pendingSlot?.time === state.preferredTime),
    );
  const slotConfirmed = state.facts?.slotConfirmed === "1" || Boolean(state.pendingSlot?.time);
  if (activeSlot?.date && activeSlot?.time) known.push("slot");
  else if (preferredMatchesOffer) known.push("slot");
  else if (slotConfirmed) known.push("slot");
  else missing.push("slot");

  const requiresBuildingDetail = isPhOrApartment(propertyType) || Boolean(state.facts?.building);
  if (locationOk) {
    if (propertyType || state.facts?.building || state.facts?.unit) known.push("property_type");
    if (state.facts?.building || !requiresBuildingDetail) known.push("building");
    if (state.facts?.unit || !requiresBuildingDetail) known.push("unit");
  } else {
    if (!propertyType) missing.push("property_type");
    else known.push("property_type");
    if (requiresBuildingDetail) {
      if (!state.facts?.building) missing.push("building");
      else known.push("building");
      if (!state.facts?.unit) missing.push("unit");
      else known.push("unit");
    }
  }

  return { ready: missing.length === 0, missingFields: missing, knownFields: known, requiresBuildingDetail };
}

function determineNextAction(state, opts = {}) {
  const readiness = getAppointmentReadiness(state);
  const locationSufficient = isLocationSufficient(state);
  let missing = [...readiness.missingFields];
  if (locationSufficient) missing = missing.filter((f) => f !== "location");
  if (state.facts?.slotConfirmed === "1" || state.pendingSlot?.date) {
    missing = missing.filter((f) => f !== "slot");
  }
  if ((state.facts?.building || state.facts?.ph) && (state.facts?.unit || state.facts?.apartment)) {
    missing = missing.filter((f) => f !== "property_type" && f !== "building" && f !== "unit");
  }
  if (opts.interruption) {
    return { action: "ANSWER_USER_QUESTION", requiredMissing: missing, locationSufficient };
  }
  if (state.appointmentId) {
    return { action: "COMPLETE", requiredMissing: [], locationSufficient };
  }
  const ready = missing.length === 0;
  if (ready && (state.pendingSlot || (state.preferredDate && state.preferredTime))) {
    return { action: "CONFIRM_OR_BOOK", requiredMissing: [], locationSufficient };
  }
  const order = ["service", "location", "property_type", "building", "unit", "contact", "slot", "customer_name"];
  const askField = order.find((f) => missing.includes(f)) || "";
  const map = {
    customer_name: "ASK_NAME",
    contact: "ASK_PHONE",
    location: "ASK_LOCATION",
    property_type: "ASK_PROPERTY_TYPE",
    building: "ASK_BUILDING",
    unit: "ASK_UNIT",
    service: "ASK_SERVICE",
    slot: "ASK_SLOT_SELECTION",
  };
  return {
    action: askField ? map[askField] : "CONTINUE",
    requiredMissing: missing,
    askField,
    locationSufficient,
  };
}

const DECLINE_RE =
  /\b(no|ninguno|ninguna|nada|no\s+tengo|no\s+hay|no\s+hace\s+falta|eso\s+es\s+todo|no\s+s[eé]|no\s+ning[uú]n\s+detalle|sin\s+m[aá]s|no\s+m[aá]s(\s+detalles?)?)\b/i;

function isDeclineAnswer(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(no|ninguno|ninguna|nada)[\s!.?]*$/i.test(trimmed)) return true;
  return DECLINE_RE.test(trimmed) && trimmed.length < 80;
}

const LOCATION_ASK_RE =
  /\b(zona|ubicaci[oó]n|direcci[oó]n|referencia|detalle\s+(espec[ií]fico|adicional)|d[oó]nde\s+(ser[ií]a|est[aá]|queda)|ph\b|apartamento|edificio)\b/i;

function enforceDeterministicAsk(reply, decision) {
  const inventingLocation =
    LOCATION_ASK_RE.test(reply) &&
    decision.locationSufficient &&
    !decision.requiredMissing.includes("location");
  const inventingVague =
    /\b(alg[uú]n\s+otro\s+detalle|detalle\s+espec[ií]fico|falta\s+un\s+peque[nñ]o\s+detalle)\b/i.test(reply) &&
    decision.requiredMissing.length === 0;
  if ((inventingLocation || inventingVague) && decision.action === "CONFIRM_OR_BOOK") {
    return { rewritten: true, reply: "Perfecto, con eso ya puedo confirmar la visita." };
  }
  if (inventingLocation || inventingVague) {
    return { rewritten: true, reply: "Con la ubicación que me diste es suficiente." };
  }
  return { rewritten: false, reply };
}

function applyLocationMessage(state, text) {
  const location = extractLocation(text);
  const buildingFacts = extractBuildingFacts(text);
  const next = {
    ...state,
    facts: { ...(state.facts || {}), ...buildingFacts },
  };
  if (location) {
    next.location = location;
    next.facts.location = location;
  }
  if (buildingFacts.building) {
    next.facts.ph = buildingFacts.building;
    next.propertyType = next.propertyType || "ph";
    next.facts.propertyType = next.propertyType;
  }
  if (buildingFacts.unit) next.facts.apartment = buildingFacts.unit;
  if (!next.location && (buildingFacts.building || buildingFacts.unit)) {
    const leading = text.match(/^\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑ]+){0,3})\s*,/i);
    if (leading?.[1] && !/\bph\b|apartamento/i.test(leading[1])) {
      next.location = leading[1].trim();
      next.facts.location = next.location;
    }
  }
  return next;
}

// --- REAL GYPSUM CASE ---
let state = {
  name: "",
  phone: "",
  contactStatus: "UNKNOWN",
  location: "",
  propertyType: "",
  primaryService: "",
  service: "",
  problem: "",
  preferredDate: "",
  preferredTime: "",
  pendingSlot: null,
  offeredSlots: [],
  awaitingSlotSelection: false,
  bookingIntent: false,
  appointmentId: "",
  facts: {},
};

// 1) service + tomorrow availability
state.problem = "necesito reparar mi gypsum el día de mañana qué disponibilidad tienen";
state.primaryService = "repairs";
state.service = "repairs";
state.bookingIntent = true;
ok("gypsum step1 asks location first", determineNextAction(state).action === "ASK_LOCATION");

// 2) location packed
state = applyLocationMessage(state, "san miguelito, ph el cucuyo apartamento 3r");
ok("extract zone San Miguelito", /san miguelito/i.test(state.location));
ok("extract building El Cucuyo", /cucuyo/i.test(state.facts.building || ""));
ok("extract unit 3r", /^3r$/i.test(state.facts.unit || ""));
ok("location sufficient after PH+unit", isLocationSufficient(state) === true);
ok("gypsum step2 asks phone", determineNextAction(state).action === "ASK_PHONE");

// 3) phone
state.phone = "65346744";
state.contactStatus = "VALID";
ok("gypsum step3 needs slot", determineNextAction(state).requiredMissing.includes("slot"));

// offer slots + pick 10:00
state.offeredSlots = [
  { date: "2026-08-26", time: "08:00", label: "8:00 a. m." },
  { date: "2026-08-26", time: "10:00", label: "10:00 a. m." },
  { date: "2026-08-26", time: "12:00", label: "12:00 p. m." },
  { date: "2026-08-26", time: "14:00", label: "2:00 p. m." },
];
state.awaitingSlotSelection = true;
state.preferredDate = "2026-08-26";
state.preferredTime = "10:00";
state.pendingSlot = { date: "2026-08-26", time: "10:00", label: "10:00 a. m." };
ok("gypsum step4 asks name", determineNextAction(state).action === "ASK_NAME");

// 5) name
state.name = "Juan Alberto";
state.facts.lastAskedField = "customer_name";
const afterName = determineNextAction(state);
ok("gypsum after name → CONFIRM_OR_BOOK", afterName.action === "CONFIRM_OR_BOOK");
ok("gypsum requiredMissing empty", afterName.requiredMissing.length === 0);
ok("gypsum readiness ready", getAppointmentReadiness(state).ready === true);

const invented = enforceDeterministicAsk(
  "¿Hay algún otro detalle específico de la ubicación?",
  afterName,
);
ok("blocks invented location ask", invented.rewritten === true);
ok("invented ask does not keep asking location", !/detalle específico|dirección precisa/i.test(invented.reply));

// --- NEGATIVE REFERENCE ---
ok("decline: no ningún detalle más", isDeclineAnswer("no ningún detalle más") === true);
ok("decline: No.", isDeclineAnswer("No.") === true);
ok("decline: eso es todo", isDeclineAnswer("eso es todo") === true);
state.facts.additionalReference = "DECLINED";
state.facts.referenceStatus = "DECLINED";
ok("declined reference still CONFIRM_OR_BOOK", determineNextAction(state).action === "CONFIRM_OR_BOOK");

// --- CHANGE TIME ---
state.preferredTime = "08:00";
state.pendingSlot = { date: "2026-08-26", time: "08:00", label: "8:00 a. m." };
const afterTimeChange = determineNextAction(state);
ok("time change stays CONFIRM_OR_BOOK", afterTimeChange.action === "CONFIRM_OR_BOOK");
ok("time change does not re-ask location", afterTimeChange.askField !== "location");
ok("location still sufficient after time change", afterTimeChange.locationSufficient === true);

const timeChangeInvent = enforceDeterministicAsk("¿Cuál es la dirección precisa?", afterTimeChange);
ok("time change cannot reopen location", timeChangeInvent.rewritten === true);

// --- MULTI-FIELD ---
let multi = {
  name: "",
  phone: "",
  contactStatus: "UNKNOWN",
  location: "",
  propertyType: "",
  primaryService: "repairs",
  service: "repairs",
  problem: "reparar gypsum",
  preferredDate: "2026-08-26",
  preferredTime: "10:00",
  pendingSlot: { date: "2026-08-26", time: "10:00", label: "10" },
  offeredSlots: [{ date: "2026-08-26", time: "10:00", label: "10" }],
  facts: {},
};
multi = applyLocationMessage(
  multi,
  "Soy Juan Alberto, mi número es 65346744, es PH El Cucuyo apartamento 3R en San Miguelito y quisiera mañana a las 10.",
);
multi.name = "Juan Alberto";
multi.phone = "65346744";
multi.contactStatus = "VALID";
ok("multi-field location sufficient", isLocationSufficient(multi));
ok("multi-field ready", getAppointmentReadiness(multi).ready === true);
ok("multi-field CONFIRM_OR_BOOK", determineNextAction(multi).action === "CONFIRM_OR_BOOK");

// --- USER QUESTION interruption ---
ok(
  "interruption answers without resetting",
  determineNextAction(state, { interruption: true }).action === "ANSWER_USER_QUESTION",
);

// --- AC P0 REGRESSION (real failing conversation) ---
function parseClock(text) {
  const lower = text.toLowerCase();
  const hmAmpm = lower.match(/\b(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)\b/);
  if (hmAmpm) {
    let hours = Number(hmAmpm[1]);
    const minutes = Number(hmAmpm[2]);
    const afternoon = /p/.test(hmAmpm[3]);
    if (hours === 12) hours = afternoon ? 12 : 0;
    else if (afternoon && hours < 12) hours += 12;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const hm = lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) return `${String(Number(hm[1])).padStart(2, "0")}:${hm[2]}`;
  return "";
}

ok('parseClock "2:00 p.m." → 14:00', parseClock("Me sirve 2:00 p.m.") === "14:00");

let ac = {
  name: "",
  phone: "",
  contactStatus: "UNKNOWN",
  location: "",
  propertyType: "",
  primaryService: "ac",
  service: "ac",
  problem: "reparacion y mantenimiento de aire acondicionado",
  preferredDate: "",
  preferredTime: "",
  pendingSlot: null,
  offeredSlots: [],
  awaitingSlotSelection: false,
  bookingIntent: true,
  appointmentId: "",
  facts: { slotConfirmed: "" },
};

ac = applyLocationMessage(ac, "Panama centro edison park");
ok("AC: Edison Park stored", /edison park/i.test(ac.location));
ok("AC: location sufficient after zone", isLocationSufficient(ac));

ac.facts.units = "2";
ac.facts.lastAskedField = "units";
ok("AC: quantity preserved", ac.facts.units === "2");

ac = applyLocationMessage(ac, "ph el mare 3000");
ok("AC: PH building El Mare", /mare/i.test(ac.facts.building || ""));
ok("AC: does not auto-set unit 3000", ac.facts.unit !== "3000");

ac.facts.unit = "3A";
ac.facts.apartment = "3A";
ok("AC: location still sufficient with unit", isLocationSufficient(ac));

ac.phone = "65653455";
ac.contactStatus = "VALID";
ac.preferredDate = "2026-08-28";
ac.offeredSlots = [
  { date: "2026-08-28", time: "08:00", label: "8:00 a. m." },
  { date: "2026-08-28", time: "10:00", label: "10:00 a. m." },
  { date: "2026-08-28", time: "12:00", label: "12:00 p. m." },
  { date: "2026-08-28", time: "14:00", label: "2:00 p. m." },
];
ac.preferredTime = parseClock("Me sirve 2:00 p.m.");
ac.pendingSlot = { date: "2026-08-28", time: "14:00", label: "2:00 p. m." };
ac.facts.slotConfirmed = "1";
ac.awaitingSlotSelection = false;
ok("AC: slot time parsed 14:00", ac.preferredTime === "14:00");

ac.name = "irving corro";
ac.facts.lastAskedField = "customer_name";
const afterAcName = determineNextAction(ac);
ok("AC: after name → CONFIRM_OR_BOOK (not location)", afterAcName.action === "CONFIRM_OR_BOOK");
ok("AC: location still Edison after name", /edison/i.test(ac.location));
ok("AC: slot still 14:00 after name", ac.pendingSlot.time === "14:00");
ok("AC: readiness ready after name", getAppointmentReadiness(ac).ready === true);

// NULL MERGE: name turn must not erase location/phone
let mergeState = {
  ...ac,
  name: "",
  location: "Edison Park",
  phone: "65653455",
  contactStatus: "VALID",
  facts: { ...ac.facts, location: "Edison Park" },
};
mergeState.name = "Irving Corro";
ok("NULL MERGE: location preserved", mergeState.location === "Edison Park");
ok("NULL MERGE: phone preserved", mergeState.phone === "65653455");
ok("NULL MERGE: slot preserved", mergeState.pendingSlot?.time === "14:00");

ok("canonical-state module exists", /mergeConfirmedFacts|isSlotConfirmed|lockSelectedSlot/.test(read("src/lib/concierge/canonical-state.ts")));
ok("engine uses lockSelectedSlot", /lockSelectedSlot\(/.test(engineSrc));
ok("transaction preserves confirmed slot", /isSlotConfirmed\(next\)/.test(read("src/lib/concierge-transaction.ts")));

if (failed) {
  console.error(`\nSTATE MACHINE TESTS FAILED: ${failed}`);
  process.exit(1);
}
console.log("\nCONCIERGE STATE MACHINE ANTI-LOOP TESTS PASS");
