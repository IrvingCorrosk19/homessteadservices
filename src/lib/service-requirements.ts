/**
 * Central Service Requirement Policy — ONE source of truth for form + chatbot.
 * Photos for digital lock = valid visual evidence (Vision), not file count.
 */
import {
  detectDigitalLockPurchaseIntent,
  normalizeDigitalLockText,
  type DigitalLockView,
} from "@/lib/concierge/digital-lock-intent";

export const SERVICE_INTENT_IDS = [
  "digital_lock_purchase_install",
  "digital_lock_compatibility",
  "lock_repair",
  "lockout",
  "key_duplication",
  "locksmith_other",
  "generic",
] as const;

export type ServiceIntentId = (typeof SERVICE_INTENT_IDS)[number];

export type PhotoEvidenceType = "front" | "inside" | "edge" | "problem" | "general";

export type PhotoSlotSpec = {
  id: PhotoEvidenceType;
  label: string;
  hint: string;
};

export type ServiceRequirements = {
  intentId: ServiceIntentId;
  serviceId: string;
  label: string;
  requiredPhotos: boolean;
  photoTypes: PhotoEvidenceType[];
  minimumValidPhotos: number;
  visionValidation: boolean;
  /** Block creating a complete service request until evidence passes Vision. */
  blocksRequestCompletion: boolean;
  /** Soft CTA / guidance only — never block emergencies. */
  humanGuidance: string;
  slots: PhotoSlotSpec[];
  codeIncomplete: string;
};

const DIGITAL_SLOTS: PhotoSlotSpec[] = [
  {
    id: "front",
    label: "Frente",
    hint: "Exterior de la puerta con la cerradura o manija visibles.",
  },
  {
    id: "inside",
    label: "Interior",
    hint: "Parte interior de la puerta y el mecanismo.",
  },
  {
    id: "edge",
    label: "Canto / pestillo",
    hint: "Canto de la puerta donde se ve el pestillo o la placa.",
  },
];

const LOCKOUT_RE =
  /\b(qued[eé]\s+afuera|me\s+qued[eé]|no\s+puedo\s+entrar|estoy\s+afuera|afuera\s+de\s+(mi\s+)?(casa|apto|apartamento|oficina|local)|sin\s+llave|no\s+puedo\s+abrir|perd[ií]\s+la\s+llave|llave\s+adentro)\b/i;

const KEY_DUP_RE = /\b(copia\s+de\s+llave|duplicar\s+llave|sacar\s+copia|llave\s+extra)\b/i;
const REPAIR_RE = /\b(reparar|arregl|no\s+gira|se\s+trab[oó]|fallando|descompuest)\w*.{0,20}(cerradura|chapa|llav[ií]n)?|(cerradura|chapa).{0,20}(reparar|arregl)/i;

export function detectLockoutIntent(text: string) {
  const n = normalizeDigitalLockText(text || "");
  return LOCKOUT_RE.test(text || "") || LOCKOUT_RE.test(n);
}

export function detectKeyDuplicationIntent(text: string) {
  return KEY_DUP_RE.test(normalizeDigitalLockText(text || ""));
}

export function detectLockRepairIntent(text: string) {
  const n = normalizeDigitalLockText(text || "");
  if (detectDigitalLockPurchaseIntent(text) || detectLockoutIntent(text)) return false;
  return REPAIR_RE.test(text || "") || REPAIR_RE.test(n);
}

/** Explicit form/chat intent ids accepted from the client. */
export function normalizeDeclaredIntent(raw: string | null | undefined): ServiceIntentId | "" {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if ((SERVICE_INTENT_IDS as readonly string[]).includes(value)) return value as ServiceIntentId;
  if (value === "digital_lock" || value === "digital_lock_purchase") return "digital_lock_purchase_install";
  if (value === "emergency" || value === "locked_out") return "lockout";
  if (value === "repair") return "lock_repair";
  if (value === "key_copy" || value === "keys") return "key_duplication";
  return "";
}

export function resolveServiceIntent(input: {
  service?: string;
  intent?: string | null;
  subtype?: string | null;
  message?: string;
}): ServiceIntentId {
  const service = String(input.service || "").trim().toLowerCase();
  const message = String(input.message || "");
  const declared =
    normalizeDeclaredIntent(input.intent) || normalizeDeclaredIntent(input.subtype);

  // Lockout always wins over digital-lock photo gates (safety / UX).
  if (declared === "lockout" || detectLockoutIntent(message)) {
    if (service === "locksmith" || !service || declared === "lockout" || detectLockoutIntent(message)) {
      return "lockout";
    }
  }

  if (
    declared === "digital_lock_purchase_install" ||
    declared === "digital_lock_compatibility"
  ) {
    return declared;
  }

  if (detectDigitalLockPurchaseIntent(message)) {
    return "digital_lock_purchase_install";
  }

  if (declared === "lock_repair" || (service === "locksmith" && detectLockRepairIntent(message))) {
    return "lock_repair";
  }

  if (declared === "key_duplication" || detectKeyDuplicationIntent(message)) {
    return "key_duplication";
  }

  if (declared === "locksmith_other" || service === "locksmith") {
    return declared === "locksmith_other" ? "locksmith_other" : "locksmith_other";
  }

  return declared || "generic";
}

function digitalLockRequirements(intentId: ServiceIntentId): ServiceRequirements {
  return {
    intentId,
    serviceId: "locksmith",
    label: "Cerradura digital — compra / instalación",
    requiredPhotos: true,
    photoTypes: ["front", "inside", "edge"],
    minimumValidPhotos: 3,
    visionValidation: true,
    blocksRequestCompletion: true,
    humanGuidance:
      "Para verificar qué cerradura digital puede adaptarse a tu puerta necesitamos fotos del frente, el interior y el canto donde está el pestillo.",
    slots: DIGITAL_SLOTS,
    codeIncomplete: "DIGITAL_LOCK_PHOTO_REQUIREMENTS_INCOMPLETE",
  };
}

export function getServiceRequirements(input: {
  service?: string;
  intent?: string | null;
  subtype?: string | null;
  message?: string;
}): ServiceRequirements {
  const intentId = resolveServiceIntent(input);
  const service = String(input.service || "").trim().toLowerCase() || "other";

  if (intentId === "digital_lock_purchase_install" || intentId === "digital_lock_compatibility") {
    return digitalLockRequirements(intentId);
  }

  if (intentId === "lockout") {
    return {
      intentId,
      serviceId: "locksmith",
      label: "Apertura / quedé afuera",
      requiredPhotos: false,
      photoTypes: [],
      minimumValidPhotos: 0,
      visionValidation: false,
      blocksRequestCompletion: false,
      humanGuidance:
        "Priorizamos ayudarte a recuperar el acceso. Las fotos ayudan si puedes tomarlas, pero no bloqueamos la atención.",
      slots: [],
      codeIncomplete: "",
    };
  }

  if (intentId === "lock_repair") {
    return {
      intentId,
      serviceId: "locksmith",
      label: "Reparación de cerradura",
      requiredPhotos: false,
      photoTypes: ["problem"],
      minimumValidPhotos: 0,
      visionValidation: false,
      blocksRequestCompletion: false,
      humanGuidance: "Una foto de la cerradura o del problema ayuda al técnico, pero no es obligatoria para enviar la solicitud.",
      slots: [
        {
          id: "problem",
          label: "Foto del problema",
          hint: "Si puedes, muestra la cerradura o la zona que falla.",
        },
      ],
      codeIncomplete: "",
    };
  }

  if (intentId === "key_duplication") {
    return {
      intentId,
      serviceId: "locksmith",
      label: "Copia de llave",
      requiredPhotos: false,
      photoTypes: [],
      minimumValidPhotos: 0,
      visionValidation: false,
      blocksRequestCompletion: false,
      humanGuidance: "Cuéntanos el tipo de llave. Las fotos son opcionales.",
      slots: [],
      codeIncomplete: "",
    };
  }

  if (intentId === "locksmith_other") {
    return {
      intentId,
      serviceId: "locksmith",
      label: "Cerrajería",
      requiredPhotos: false,
      photoTypes: ["general"],
      minimumValidPhotos: 0,
      visionValidation: false,
      blocksRequestCompletion: false,
      humanGuidance: "Si puedes, agrega una foto de la puerta o la cerradura. No es obligatoria.",
      slots: [],
      codeIncomplete: "",
    };
  }

  return {
    intentId: "generic",
    serviceId: service,
    label: service,
    requiredPhotos: false,
    photoTypes: [],
    minimumValidPhotos: 0,
    visionValidation: false,
    blocksRequestCompletion: false,
    humanGuidance: "",
    slots: [],
    codeIncomplete: "",
  };
}

export function isDigitalLockEvidenceIntent(intentId: ServiceIntentId) {
  return intentId === "digital_lock_purchase_install" || intentId === "digital_lock_compatibility";
}

export function viewLabelEs(view: DigitalLockView | PhotoEvidenceType) {
  if (view === "front") return "frente";
  if (view === "inside") return "interior";
  if (view === "edge") return "canto / pestillo";
  if (view === "problem") return "problema";
  return "foto";
}

export function missingEvidenceHumanMessage(missing: Array<DigitalLockView | PhotoEvidenceType>) {
  if (!missing.length) return "";
  if (missing.length === 1) {
    return `Ya casi terminamos. Para revisar qué cerradura puede adaptarse a tu puerta nos falta la foto del ${viewLabelEs(missing[0])}.`;
  }
  const labels = missing.map(viewLabelEs);
  const last = labels.pop();
  return `Para continuar necesitamos fotos válidas de: ${labels.join(", ")} y ${last}.`;
}

/** Locksmith subtype options for the public form (not inventing catalog items). */
export const LOCKSMITH_FORM_INTENTS: Array<{ id: ServiceIntentId; label: string }> = [
  { id: "digital_lock_purchase_install", label: "Instalar / comprar cerradura digital" },
  { id: "lock_repair", label: "Reparar una cerradura" },
  { id: "lockout", label: "Estoy afuera / no puedo entrar" },
  { id: "key_duplication", label: "Copia de llave" },
  { id: "locksmith_other", label: "Otro servicio de cerrajería" },
];
