/**
 * Homestead Content Studio V3 — natural language campaign intents.
 * Deterministic routing only. Approval policy lives outside the LLM.
 */

export type ContentCampaignIntent =
  | { kind: "AI_CAMPAIGN"; serviceHint: string; platformHint: string; raw: string }
  | { kind: "IDEATION"; raw: string }
  | { kind: "PREPARE_IDEA_YES"; raw: string }
  | { kind: "PREPARE_IDEA_NO"; raw: string }
  | { kind: "NONE" };

const SERVICES: Array<{ id: string; label: string; re: RegExp }> = [
  { id: "ac", label: "aire acondicionado", re: /\b(aire|a\/?c|climatizaci[oó]n|mantenimiento\s+de\s+aire)\b/i },
  { id: "locksmith", label: "cerrajería", re: /\b(cerrajer[ií]a|cerradura|llave)\b/i },
  { id: "plumbing", label: "plomería", re: /\b(plomer[ií]a|tuber[ií]a|fuga|desag[uü]e)\b/i },
  { id: "electrical", label: "electricidad", re: /\b(electricidad|el[eé]ctric|corto|tablero)\b/i },
  { id: "painting", label: "pintura", re: /\b(pintura|pintar|pintado)\b/i },
  { id: "repairs", label: "reparaciones", re: /\b(reparaci[oó]n|reparar|mantenimiento\s+general)\b/i },
  { id: "remodeling", label: "remodelación", re: /\b(remodel)\b/i },
];

function detectService(text: string) {
  for (const service of SERVICES) {
    if (service.re.test(text)) return service;
  }
  return null;
}

function detectPlatform(text: string) {
  if (/\b(instagram|ig)\b/i.test(text)) return "Instagram";
  if (/\b(facebook|fb)\b/i.test(text)) return "Facebook";
  if (/\b(historias?|stories)\b/i.test(text)) return "Instagram Story";
  return "Instagram";
}

export function interpretContentCampaignIntent(text: string): ContentCampaignIntent {
  const raw = text.trim();
  if (!raw || raw.startsWith("/")) return { kind: "NONE" };
  const lower = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  if (/^(si|s[ií]|dale|ok|okay|prep[aá]rala|preparala|hazla|quiero que la prepares)\b/.test(lower)) {
    return { kind: "PREPARE_IDEA_YES", raw };
  }
  if (/^(no|ahora no|despu[eé]s|cancelar)\b/.test(lower)) {
    return { kind: "PREPARE_IDEA_NO", raw };
  }

  if (
    /\b(que (podemos|podemos|puedo) (publicar|promocionar)|ideas? (de )?contenido|que promociono|que publico|dame ideas|que servicio (deber[ií]amos|podemos) (mover|promocionar))\b/.test(
      lower,
    ) ||
    /\b(investiga|investigar)\b.*\b(promocionar|publicar|semana)\b/.test(lower)
  ) {
    return { kind: "IDEATION", raw };
  }

  if (
    /\b(crea|cr[eé]ame|haz|hazme|genera|prep[aá]rame|quiero)\b.*\b(publicidad|anuncio|post|publicaci[oó]n|campa[nñ]a|promo)\b/.test(
      lower,
    ) ||
    /\b(publicidad|anuncio|post|campa[nñ]a)\b.*\b(de|para)\b/.test(lower) ||
    /\b(quiero (conseguir|atraer) clientes)\b/.test(lower) ||
    /\b(promocionar|promueve|promov[eé])\b/.test(lower)
  ) {
    const service = detectService(raw);
    return {
      kind: "AI_CAMPAIGN",
      serviceHint: service?.label || "",
      platformHint: detectPlatform(raw),
      raw,
    };
  }

  return { kind: "NONE" };
}

export function homesteadBrandProfile() {
  return {
    name: "Homestead Services",
    domain: "homestead.lat",
    market: "Panamá",
    voice: "profesional, cercano, resolutivo, sin presión",
    forbidden: [
      "precios inventados",
      "garantías no configuradas",
      "testimonios inventados",
      "urgencia/escasez falsa",
      "presentar AI como trabajo real",
    ],
    ctaDefaults: ["Agenda tu servicio en homestead.lat", "Escríbenos y te orientamos"],
  };
}

export function buildAiCampaignBrief(input: {
  serviceHint: string;
  platformHint: string;
  raw: string;
}) {
  const brand = homesteadBrandProfile();
  const service = input.serviceHint || "servicios del hogar";
  return {
    contentType: "AI_CAMPAIGN" as const,
    sourceType: "AI_GENERATED" as const,
    service,
    platform: input.platformHint || "Instagram",
    objective: "LEADS",
    audience: `hogares y propiedades en ${brand.market}`,
    tone: brand.voice,
    cta: brand.ctaDefaults[0],
    constraints: brand.forbidden,
    note: input.raw.slice(0, 500),
  };
}
