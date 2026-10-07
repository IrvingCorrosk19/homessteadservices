/**
 * Business contact channels — single approved source.
 * NEVER derive from customer conversation data, examples, or prior sessions.
 */
import {
  contact,
  isOfficialWhatsAppEnabled,
  OFFICIAL_WHATSAPP,
  phoneHref,
  whatsappHref,
} from "@/lib/site";

export type BusinessContactChannels = {
  brand: string;
  phone: string | null;
  phoneHref: string | null;
  whatsappDisplay: string | null;
  whatsappUrl: string | null;
  email: string | null;
  anyVerified: boolean;
};

export function getBusinessContactChannels(): BusinessContactChannels {
  // Read env at call time — never reuse customer numbers, prior turns, or stale module caches.
  const phoneLive = (process.env.NEXT_PUBLIC_PHONE || "").trim();
  const phone = phoneLive || null;
  const emailLive = (process.env.NEXT_PUBLIC_EMAIL || "").trim();
  const email = emailLive || (contact.email.isConfigured ? contact.email.value.trim() : null);
  const whatsappConfigured = isOfficialWhatsAppEnabled();
  const whatsappDisplay = whatsappConfigured ? OFFICIAL_WHATSAPP.display : null;
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : phoneHref();
  return {
    brand: "HOMESTEAD SERVICES",
    phone,
    phoneHref: telHref,
    whatsappDisplay,
    whatsappUrl: whatsappConfigured ? whatsappHref() : null,
    email,
    anyVerified: Boolean(phone || whatsappDisplay || email),
  };
}

/** Digits-only fingerprint of verified business numbers (for echo guards). */
export function businessContactDigitFingerprints(): string[] {
  const ch = getBusinessContactChannels();
  const out: string[] = [];
  for (const raw of [ch.phone, ch.whatsappDisplay]) {
    if (!raw) continue;
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 7) out.push(digits);
  }
  return out;
}

/**
 * User is asking for Homestead's phone / WhatsApp / how to call the business —
 * not providing or correcting their own contact.
 */
export function isBusinessContactQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  // Explicit company framing
  if (
    /\b(homestead|ustedes|su\s+(n[uú]mero|tel[eé]fono|whats?app)|el\s+de\s+(ustedes|homestead)|para\s+llamar(?:los|les)?|a\s+d[oó]nde\s+llamo|c[oó]mo\s+(los\s+)?contacto|c[oó]mo\s+los\s+llamo)\b/i.test(
      t,
    )
  ) {
    if (/\b(n[uú]mero|tel[eé]fono|whats?app|llamar|contacto|wa\.me|tel:)\b/i.test(t)) return true;
  }
  // "cuál es el número / teléfono" without self-reference
  if (
    /\b(cu[aá]l\s+es\s+(el\s+)?(n[uú]mero|tel[eé]fono)|me\s+(pasan|dan|pasan)\s+(el\s+)?(n[uú]mero|tel[eé]fono)|el\s+whats?app|n[uú]mero\s+de\s+whats?app)\b/i.test(
      t,
    )
  ) {
    if (/\b(mi\s+n[uú]mero|el\s+m[ií]o|para\s+que\s+me\s+(llamen|contacten)|te\s+paso)\b/i.test(t)) {
      return false;
    }
    return true;
  }
  if (/\b(quiero\s+llamar|necesito\s+llamar|llamo\s+yo)\b/i.test(t) && /\b(n[uú]mero|tel[eé]fono|whats?app)?\b/i.test(t)) {
    return true;
  }
  return false;
}

export function formatBusinessContactReply(): { handled: true; reply: string } {
  const ch = getBusinessContactChannels();
  const parts: string[] = [];
  if (ch.whatsappDisplay) {
    parts.push(`WhatsApp oficial de Homestead: ${ch.whatsappDisplay}`);
  }
  if (ch.phone && ch.phone.replace(/\D/g, "") !== (ch.whatsappDisplay || "").replace(/\D/g, "")) {
    parts.push(`Teléfono publicado: ${ch.phone}`);
  }
  if (!parts.length && ch.email) {
    parts.push(`Correo publicado: ${ch.email}`);
  }
  if (!parts.length) {
    return {
      handled: true,
      reply:
        "En este momento no tengo un teléfono o WhatsApp comercial verificado para compartir aquí. Seguimos atendiendo tu caso en este chat; no uses el número que me diste tú como si fuera de Homestead.",
    };
  }
  return {
    handled: true,
    reply: `${parts.join(". ")}. Si prefieres, seguimos coordinando tu solicitud por aquí.`,
  };
}

/** True if reply digits match the customer's phone and are NOT a verified business number. */
export function replyLeaksCustomerPhoneAsBusiness(reply: string, customerPhone: string | null | undefined): boolean {
  const customerDigits = String(customerPhone || "").replace(/\D/g, "");
  if (customerDigits.length < 7) return false;
  const replyDigits = (reply || "").replace(/\D/g, "");
  if (!replyDigits.includes(customerDigits.slice(-7)) && !replyDigits.includes(customerDigits)) {
    return false;
  }
  const business = businessContactDigitFingerprints();
  for (const b of business) {
    if (customerDigits === b || customerDigits.endsWith(b.slice(-8)) || b.endsWith(customerDigits.slice(-8))) {
      return false;
    }
  }
  // Framing as company contact / call us
  if (
    /\b(homestead|nuestro|nuestra|ll[aá]manos|cont[aá]ctanos|whats?app\s+(oficial|de\s+homestead)|tel[eé]fono\s+(oficial|de\s+homestead|publicado)|wa\.me\/)/i.test(
      reply,
    )
  ) {
    return true;
  }
  // Asking "cuál es el número" style answer that just dumps the only digits = customer
  if (/\b(el\s+n[uú]mero\s+es|nuestro\s+n[uú]mero|puedes\s+llamar|ll[aá]manos\s+al|whats?app)\b/i.test(reply)) {
    return true;
  }
  return false;
}

export function scrubCustomerPhoneLeak(
  reply: string,
  customerPhone: string | null | undefined,
): { reply: string; scrubbed: boolean } {
  if (!replyLeaksCustomerPhoneAsBusiness(reply, customerPhone)) {
    return { reply, scrubbed: false };
  }
  const business = formatBusinessContactReply();
  return { reply: business.reply, scrubbed: true };
}
