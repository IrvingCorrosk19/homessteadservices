import { SERVICE_PLAYBOOKS, type PlaybookServiceId } from "@/lib/concierge/service-playbooks";

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function aliasHits(blob: string, alias: string) {
  const needle = fold(alias);
  if (!needle) return false;
  if (needle.length <= 4) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}`).test(blob);
  }
  return blob.includes(needle);
}

function detectServicesLocal(text: string): PlaybookServiceId[] {
  const blob = fold(text);
  const found: PlaybookServiceId[] = [];
  for (const playbook of SERVICE_PLAYBOOKS) {
    if (playbook.serviceId === "other") continue;
    if (playbook.aliases.some((alias) => aliasHits(blob, alias)) && !found.includes(playbook.serviceId)) {
      found.push(playbook.serviceId);
    }
  }
  return found;
}

const REPAIR_VERB = /\b(repar\w+|arregl\w+|se dañ[oó]|se dano|descompus\w*)\b/;
const PAINT_VERB = /\b(pint(ar|ura|ores|ado)|brocha|impermeabiliz)\b/;
const CEILING = /\b(cielo\s*raso|cielo\s*razo|falso\s+techo|drywall)\b/;

/** Intent from the latest user message — latest text wins over sticky conversation state. */
export function resolvePrimaryFromMessage(text: string): PlaybookServiceId | "" {
  const blob = fold(text);
  if (!blob.trim()) return "";

  const hasRepair = REPAIR_VERB.test(blob);
  const hasPaint = PAINT_VERB.test(blob);
  const hasCeiling = CEILING.test(blob);

  if (hasRepair && hasPaint) {
    if (/\bprimero\b.*\brepar|\brepar.*\bprimero\b|\bantes de pint/.test(blob)) return "repairs";
    if (/\bdespu[eé]s de repar|\brepar.*\b(y|e)\s+pint/.test(blob)) return "repairs";
    return "repairs";
  }
  if (hasRepair) return "repairs";
  if (hasPaint) return "painting";
  if (hasCeiling && /\b(grieta|filtr|gote|hund|ca[ií]|dañ|rot|moho|humeda|humedad)\b/.test(blob)) {
    return "repairs";
  }

  return detectServicesLocal(text)[0] || "";
}

export function serviceNeedDetail(problem: string, service = "") {
  const trimmed = problem.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const blob = fold(trimmed);
  if (CEILING.test(blob) && REPAIR_VERB.test(blob)) {
    return "Reparación de cielo raso";
  }
  if (CEILING.test(blob) && PAINT_VERB.test(blob)) {
    return "Pintura de cielo raso";
  }
  const stripped = trimmed
    .replace(/^\[Asistente web Homestead\]\s*/i, "")
    .replace(/^Necesidad:\s*/i, "")
    .replace(/^Servicio:\s*\w+\.?\s*/i, "")
    .trim();
  if (stripped.length >= 8 && stripped.length <= 160) return stripped.slice(0, 160);
  if (service === "repairs" && CEILING.test(blob)) return "Reparación de cielo raso";
  return "";
}

export function primaryServiceChanged(previous: string, next: string) {
  return Boolean(previous && next && previous !== next);
}
