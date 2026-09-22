export const locales = ["es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "es";

export const site = {
  name: "HOMESTEAD SERVICES",
  shortName: "HOMESTEAD",
  descriptor: "Repairs • Maintenance • Improvements",
  tagline: "Tu espacio en buenas manos.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://homestead.lat",
  region: "Panamá",
};

const EMPTY = "";

function envOrEmpty(value: string | undefined): {
  value: string;
  isConfigured: boolean;
} {
  const trimmed = value?.trim() ?? EMPTY;
  return { value: trimmed, isConfigured: trimmed.length > 0 };
}

/** Official Homestead WhatsApp — single source of truth for public CTAs. */
export const OFFICIAL_WHATSAPP = {
  display: "+507 6661-6580",
  localDisplay: "6661-6580",
  destination: "50766616580",
} as const;

const HS_PUBLIC_ID = /^HS-\d{4}-\d{6}$/;
const HA_PUBLIC_ID = /^HA-[a-f0-9]{8}$/i;

export const contact = {
  phone: envOrEmpty(process.env.NEXT_PUBLIC_PHONE),
  email: envOrEmpty(process.env.NEXT_PUBLIC_EMAIL),
  whatsapp: { value: OFFICIAL_WHATSAPP.display, isConfigured: true },
  hours: envOrEmpty(process.env.NEXT_PUBLIC_HOURS),
  serviceArea: envOrEmpty(process.env.NEXT_PUBLIC_SERVICE_AREA),
  instagram: envOrEmpty(process.env.NEXT_PUBLIC_INSTAGRAM),
  facebook: envOrEmpty(process.env.NEXT_PUBLIC_FACEBOOK),
};

/** Telegram/ops customer WhatsApp buttons. Unchanged: opt-in only. */
export function isPublicWhatsAppEnabled() {
  return process.env.NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED === "true";
}

/** Official Homestead WhatsApp on the public site. Kill switch: NEXT_PUBLIC_OFFICIAL_WHATSAPP=false. */
export function isOfficialWhatsAppEnabled() {
  return process.env.NEXT_PUBLIC_OFFICIAL_WHATSAPP !== "false";
}

export function officialWhatsAppDestination() {
  return OFFICIAL_WHATSAPP.destination;
}

/** Always official Homestead destination. Does not use customer/technician phones. */
export function buildWhatsAppUrl(message?: string) {
  const text = message?.trim()
    ? `?text=${encodeURIComponent(message.trim())}`
    : "";
  return `https://wa.me/${OFFICIAL_WHATSAPP.destination}${text}`;
}

export function phoneHref() {
  if (!contact.phone.isConfigured) return null;
  return `tel:${contact.phone.value.replace(/[^\d+]/g, "")}`;
}

export function emailHref() {
  if (!contact.email.isConfigured) return null;
  return `mailto:${contact.email.value}`;
}

export function whatsappHref(message?: string) {
  if (!isOfficialWhatsAppEnabled()) return null;
  return buildWhatsAppUrl(message);
}

export function whatsappDefaultMessage() {
  return "Hola, quisiera información sobre los servicios de Homestead.";
}

export function whatsappServiceMessage(serviceLabel?: string) {
  if (!serviceLabel?.trim()) return whatsappDefaultMessage();
  return `Hola, quisiera información sobre el servicio de ${serviceLabel.trim().toLowerCase()} de Homestead.`;
}

export function whatsappRequestMessage(publicId?: string) {
  const id = publicId?.trim().toUpperCase() || "";
  if (HS_PUBLIC_ID.test(id)) {
    return `Hola, quisiera consultar sobre mi solicitud ${id}.`;
  }
  return whatsappDefaultMessage();
}

export function whatsappAppointmentMessage(appointmentId?: string) {
  const id = appointmentId?.trim() || "";
  if (HA_PUBLIC_ID.test(id)) {
    return `Hola, quisiera consultar sobre mi cita ${id.startsWith("HA-") ? id : `HA-${id}`}.`;
  }
  return "Hola, quisiera consultar sobre mi cita de Homestead.";
}

export function instagramHref() {
  if (!contact.instagram.isConfigured) return null;
  const handle = contact.instagram.value.replace(/^@/, "");
  if (handle.startsWith("http")) return handle;
  return `https://instagram.com/${handle}`;
}

export function facebookHref() {
  if (!contact.facebook.isConfigured) return null;
  const handle = contact.facebook.value.replace(/^@/, "");
  if (handle.startsWith("http")) return handle;
  return `https://facebook.com/${handle}`;
}

export type SocialId = "instagram" | "facebook" | "whatsapp";

export type SocialPlatform = {
  id: SocialId;
  label: string;
  href: string | null;
};

export function getSocialPlatforms(): SocialPlatform[] {
  const platforms: SocialPlatform[] = [
    { id: "instagram", label: "Instagram", href: instagramHref() },
    { id: "facebook", label: "Facebook", href: facebookHref() },
  ];
  if (isOfficialWhatsAppEnabled()) {
    platforms.push({ id: "whatsapp", label: "WhatsApp", href: whatsappHref() });
  }
  return platforms;
}

export const serviceSlugs = [
  "ac",
  "plumbing",
  "painting",
  "electrical",
  "locksmith",
  "repairs",
  "remodeling",
] as const;

export type ServiceSlug = (typeof serviceSlugs)[number];

export const formServices = [
  ...serviceSlugs,
  "multiple",
  "other",
] as const;

export type FormService = (typeof formServices)[number];

export const propertyTypes = [
  "house",
  "apartment",
  "ph",
  "office",
  "commerce",
  "other",
] as const;

export type PropertyType = (typeof propertyTypes)[number];

export const navItems = [
  { href: "/", hash: "inicio", key: "home" as const },
  { href: "/services", hash: "servicios", key: "services" as const },
  { href: "/", hash: "como-funciona", key: "process" as const },
  { href: "/contact", hash: "contacto", key: "contact" as const },
];
