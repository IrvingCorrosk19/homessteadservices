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

export const contact = {
  phone: envOrEmpty(process.env.NEXT_PUBLIC_PHONE),
  email: envOrEmpty(process.env.NEXT_PUBLIC_EMAIL),
  whatsapp: envOrEmpty(process.env.NEXT_PUBLIC_WHATSAPP),
  hours: envOrEmpty(process.env.NEXT_PUBLIC_HOURS),
  serviceArea: envOrEmpty(process.env.NEXT_PUBLIC_SERVICE_AREA),
  instagram: envOrEmpty(process.env.NEXT_PUBLIC_INSTAGRAM),
  facebook: envOrEmpty(process.env.NEXT_PUBLIC_FACEBOOK),
};

/** Public website WhatsApp CTAs. Off by default; set NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED=true to re-enable. */
export function isPublicWhatsAppEnabled() {
  return process.env.NEXT_PUBLIC_WHATSAPP_PUBLIC_ENABLED === "true";
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
  if (!isPublicWhatsAppEnabled()) return null;
  if (!contact.whatsapp.isConfigured) return null;
  const number = contact.whatsapp.value.replace(/\D/g, "");
  if (!number) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${number}${text}`;
}

export function whatsappServiceMessage(serviceLabel?: string) {
  if (!serviceLabel) return "Hola Homestead Services. Necesito ayuda.";
  return `Hola Homestead Services. Necesito ayuda con ${serviceLabel.toLowerCase()}.`;
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
  if (isPublicWhatsAppEnabled()) {
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
