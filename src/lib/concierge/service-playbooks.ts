export const FACT_NEEDS = ["REQUIRED", "USEFUL", "OPTIONAL", "NOT_NEEDED"] as const;
export type FactNeed = (typeof FACT_NEEDS)[number];

export const BOOKING_STRATEGIES = [
  "DIRECT_BOOKING",
  "TECH_REVIEW_FIRST",
  "PHOTO_REVIEW_FIRST",
  "VISIT_ASSESSMENT",
] as const;
export type BookingStrategy = (typeof BOOKING_STRATEGIES)[number];

export const PLAYBOOK_SERVICE_IDS = [
  "locksmith",
  "ac",
  "plumbing",
  "electrical",
  "painting",
  "remodeling",
  "repairs",
  "other",
] as const;
export type PlaybookServiceId = (typeof PLAYBOOK_SERVICE_IDS)[number];

export type PlaybookFact = {
  need: FactNeed;
  label: string;
  hint: string;
};

export type ServicePlaybook = {
  serviceId: PlaybookServiceId;
  label: string;
  aliases: string[];
  objective: string;
  facts: Record<string, PlaybookFact>;
  requiredBeforeRequest: string[];
  requiredBeforeBooking: string[];
  recommendedQuestions: string[];
  photoGuidance: string;
  photoWhy: string;
  urgencySignals: string[];
  safetyRules: string;
  bookingStrategy: BookingStrategy;
  telegramFocus: string;
  unknownCatalog: boolean;
};

function fact(need: FactNeed, label: string, hint: string): PlaybookFact {
  return { need, label, hint };
}

const LOCKSMITH: ServicePlaybook = {
  serviceId: "locksmith",
  label: "Cerrajería",
  aliases: [
    "cerradura",
    "cerraduras",
    "cerrajer",
    "llavin",
    "llavín",
    "llave",
    "llaves",
    "chapa",
    "no abre la puerta",
    "no cierra la puerta",
    "perdí la llave",
    "perdi la llave",
    "quedé afuera",
    "quede afuera",
    "cerradura digital",
    "smart lock",
    "locksmith",
  ],
  objective: "Para compra/instalación de cerradura digital: revisar frente, interior y canto con visión; para cerrajería general: fotos útiles y acceso.",
  facts: {
    need: fact("USEFUL", "Necesidad", "cambio, no abre, quedó afuera, digital, copia de llave"),
    photos: fact("USEFUL", "Fotos", "frente, interior y canto si es cerradura digital; puerta/cerradura si es genérico"),
    lockedOut: fact("USEFUL", "Acceso", "si la persona está afuera o no puede asegurar"),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", "zona general, no dirección exacta al inicio"),
    propertyType: fact("OPTIONAL", "Tipo de propiedad", ""),
    brand: fact("NOT_NEEDED", "Marca", "no exigir modelo"),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: [
    "Fotos de la puerta y la cerradura",
    "Si no puede entrar o asegurar",
  ],
  photoGuidance:
    "Si es cerradura digital (compra/instalación): pide frente, interior y canto del pestillo, una por una, y solo lo que falte. Si es cerrajería general: fotos de la puerta y la cerradura ayudan al técnico.",
  photoWhy: "el técnico o la revisión visual puede ver el herraje antes de recomendar o coordinar",
  urgencySignals: ["no puedo entrar", "quedé afuera", "quede afuera", "no puedo asegurar", "perdí la llave", "perdi la llave"],
  safetyRules: "No orientar a forzar la puerta ni a desarmar la cerradura. No inventar medidas, compatibilidad absoluta, marcas, precios ni stock de cerraduras digitales.",
  bookingStrategy: "PHOTO_REVIEW_FIRST",
  telegramFocus: "cerradura digital: checklist frente/interior/canto; genérico: fotos y acceso",
  unknownCatalog: false,
};

const AC: ServicePlaybook = {
  serviceId: "ac",
  label: "Aire acondicionado",
  aliases: [
    "aire",
    "a/c",
    "ac",
    "split",
    "minisplit",
    "no enfría",
    "no enfria",
    "bota agua",
    "condens",
    "filtro",
    "mantenimiento de aire",
  ],
  objective: "Entender el síntoma y cuántas unidades hay, preguntando de a poco.",
  facts: {
    symptom: fact("USEFUL", "Síntoma", "no enfría, bota agua, no enciende, ruido, olor, mantenimiento"),
    units: fact("USEFUL", "Unidades", "cuántos equipos"),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
    photos: fact("OPTIONAL", "Fotos", "útil pero no bloquear"),
    propertyType: fact("OPTIONAL", "Tipo de propiedad", ""),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Si enciende y no enfría u otro síntoma", "Cuántas unidades si habla de mantenimiento"],
  photoGuidance: "Si tienes una foto del equipo o de la fuga, el técnico llega con mejor contexto.",
  photoWhy: "ver el equipo o la condensación",
  urgencySignals: ["bota mucha agua", "huele a quemado", "chispa"],
  safetyRules: "No diagnosticar capacitor, gas o tarjeta. No dar instrucciones de abrir el equipo.",
  bookingStrategy: "DIRECT_BOOKING",
  telegramFocus: "síntoma",
  unknownCatalog: false,
};

const PLUMBING: ServicePlaybook = {
  serviceId: "plumbing",
  label: "Plomería",
  aliases: ["plom", "fuga", "fregador", "tuber", "inodoro", "sanitario", "grifo", "grifer", "ducha", "cisterna", "se sale agua"],
  objective: "Saber qué ocurre, dónde, y si el agua sigue saliendo.",
  facts: {
    what: fact("USEFUL", "Qué ocurre", "fuga, no baja, se tapa"),
    where: fact("USEFUL", "Dónde", "fregador, baño, tubería"),
    activeLeak: fact("USEFUL", "Fuga activa", "si sigue saliendo agua"),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
    photos: fact("OPTIONAL", "Fotos", ""),
    propertySize: fact("NOT_NEEDED", "Tamaño de propiedad", "no preguntar al inicio"),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Si el agua sigue saliendo", "Dónde se ve la fuga"],
  photoGuidance: "Una foto de la fuga o la zona mojada ayuda a priorizar.",
  photoWhy: "ver de dónde sale el agua",
  urgencySignals: ["sigue saliendo", "inund", "no para", "tubería rota", "tuberia rota"],
  safetyRules: "Si hay inundación grave, priorizar contacto. No pedir que abra paredes.",
  bookingStrategy: "DIRECT_BOOKING",
  telegramFocus: "fuga y urgencia",
  unknownCatalog: false,
};

const ELECTRICAL: ServicePlaybook = {
  serviceId: "electrical",
  label: "Electricidad",
  aliases: [
    "eléctric",
    "electric",
    "tomacorriente",
    "toma",
    "interruptor",
    "breaker",
    "corto",
    "no hay luz",
    "lámpara",
    "lampara",
    "chispa",
    "chispas",
    "olor a quemado",
  ],
  objective: "Entender qué dejó de funcionar y detectar señales de peligro.",
  facts: {
    what: fact("USEFUL", "Qué falló", "toma, zona, toda la propiedad"),
    scope: fact("USEFUL", "Alcance", "un punto o toda la casa"),
    hazard: fact("USEFUL", "Señal de riesgo", "chispas, olor a quemado, humo"),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
    photos: fact("OPTIONAL", "Fotos", "nunca si hay riesgo activo"),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Si afecta un punto o toda la propiedad", "Si hay olor a quemado o chispas"],
  photoGuidance: "Si ya está seguro, una foto del tomacorriente o tablero ayuda. No te acerques si hay chispas o humo.",
  photoWhy: "ver el punto afectado cuando no hay peligro",
  urgencySignals: ["chispa", "chispas", "humo", "olor a quemado", "electroc"],
  safetyRules:
    "Si hay chispas, humo u olor a quemado: no dar instrucciones técnicas. Pedir alejarse y, si hay peligro, emergencia. Priorizar contacto humano.",
  bookingStrategy: "TECH_REVIEW_FIRST",
  telegramFocus: "riesgo y qué dejó de funcionar",
  unknownCatalog: false,
};

const PAINTING: ServicePlaybook = {
  serviceId: "painting",
  label: "Pintura",
  aliases: ["pintar", "pintura", "pintores", "brocha", "impermeabiliz"],
  objective: "Entender interior/exterior, alcance y estado de superficie.",
  facts: {
    interiorExterior: fact("USEFUL", "Interior o exterior", ""),
    spaces: fact("USEFUL", "Espacios", "una sala vs toda la casa"),
    surface: fact("OPTIONAL", "Superficie", "humedad, descascarado"),
    photos: fact("USEFUL", "Fotos", "el área a pintar"),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Interior o exterior", "Un espacio o varios"],
  photoGuidance: "Si me envías una foto del área, entendemos mucho mejor el trabajo antes de coordinar.",
  photoWhy: "ver el alcance y el estado de la superficie",
  urgencySignals: [],
  safetyRules: "No cotizar metros ni galones inventados.",
  bookingStrategy: "VISIT_ASSESSMENT",
  telegramFocus: "alcance y fotos",
  unknownCatalog: false,
};

const REMODELING: ServicePlaybook = {
  serviceId: "remodeling",
  label: "Pequeñas remodelaciones",
  aliases: ["remodel", "renovar", "transformar", "cocina", "baño completo", "drywall", "decorar", "decoraci", "renovaci", "hacerlo todo", "lo hagan todo"],
  objective: "Entender qué desea transformar y que casi siempre hace falta una visita.",
  facts: {
    space: fact("USEFUL", "Espacio", "baño, cocina, habitación"),
    goal: fact("USEFUL", "Qué quiere lograr", ""),
    photos: fact("USEFUL", "Fotos", ""),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Qué espacio quiere transformar", "Fotos del estado actual"],
  photoGuidance: "Con fotos del espacio actual el equipo estima mejor si podemos ayudarte y qué visita hace falta.",
  photoWhy: "ver el alcance real",
  urgencySignals: [],
  safetyRules: "No cotizar un proyecto complejo con una sola frase. No afirmar obra nueva pesada.",
  bookingStrategy: "VISIT_ASSESSMENT",
  telegramFocus: "espacio y expectativa",
  unknownCatalog: false,
};

const REPAIRS: ServicePlaybook = {
  serviceId: "repairs",
  label: "Reparaciones",
  aliases: ["reparar", "arreglar", "se dañó", "se dano", "descompus", "cielo raso", "cielo razo", "falso techo"],
  objective: "Entender el objeto/zona dañada sin forzar un oficio si aún no está claro.",
  facts: {
    what: fact("USEFUL", "Qué hay que reparar", ""),
    photos: fact("USEFUL", "Fotos", ""),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Qué se dañó", "Una foto si es posible"],
  photoGuidance: "Una foto del daño suele bastar para orientar al técnico.",
  photoWhy: "ver el daño",
  urgencySignals: [],
  safetyRules: "Si encaja mejor en otro oficio, reasignar el playbook.",
  bookingStrategy: "DIRECT_BOOKING",
  telegramFocus: "qué se dañó",
  unknownCatalog: false,
};

const OTHER: ServicePlaybook = {
  serviceId: "other",
  label: "Por revisar",
    aliases: ["portón", "porton", "portones", "cámara", "camara", "jardín", "jardin", "limpieza", "carpinter", "otro"],
  objective: "Capturar la oportunidad sin inventar que sí o que no está en catálogo.",
  facts: {
    what: fact("USEFUL", "Qué necesita", ""),
    photos: fact("USEFUL", "Fotos", ""),
    contact: fact("REQUIRED", "Contacto", "teléfono válido"),
    location: fact("USEFUL", "Zona", ""),
  },
  requiredBeforeRequest: [],
  requiredBeforeBooking: [],
  recommendedQuestions: ["Qué está pasando", "Una foto para confirmar si podemos ayudar"],
  photoGuidance: "Cuéntame un poco y, si puedes, envía una foto. Así confirmamos si podemos ayudarte.",
  photoWhy: "confirmar si el trabajo entra en Homestead",
  urgencySignals: [],
  safetyRules: "No decir 'no ofrecemos eso' ni 'sí, seguro'. Capturar y marcar NEEDS_REVIEW.",
  bookingStrategy: "TECH_REVIEW_FIRST",
  telegramFocus: "oportunidad por revisar",
  unknownCatalog: true,
};

export const SERVICE_PLAYBOOKS: ServicePlaybook[] = [
  LOCKSMITH,
  AC,
  PLUMBING,
  ELECTRICAL,
  PAINTING,
  REMODELING,
  REPAIRS,
  OTHER,
];

const BY_ID = new Map(SERVICE_PLAYBOOKS.map((item) => [item.serviceId, item]));

export function getPlaybook(serviceId: string | undefined | null): ServicePlaybook {
  if (serviceId && BY_ID.has(serviceId as PlaybookServiceId)) {
    return BY_ID.get(serviceId as PlaybookServiceId)!;
  }
  return OTHER;
}

export function playbookById(serviceId: string): ServicePlaybook | undefined {
  return BY_ID.get(serviceId as PlaybookServiceId);
}
