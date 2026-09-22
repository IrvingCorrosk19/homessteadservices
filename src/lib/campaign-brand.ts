import { contact, OFFICIAL_WHATSAPP, site } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export type FactStatus = "confirmed" | "pending" | "expired";

export type BrandFact<T> = {
  value: T;
  status: FactStatus;
  source: string;
  note?: string;
};

function fact<T>(value: T, status: FactStatus, source: string, note?: string): BrandFact<T> {
  return { value, status, source, note };
}

/** Single commercial source of truth. Unconfirmed claims must not appear in copy. */
export function homesteadBrandDossier() {
  const dictionary = getDictionary();
  const hours = contact.hours.isConfigured
    ? fact(contact.hours.value, "confirmed" as const, "NEXT_PUBLIC_HOURS")
    : fact("", "pending" as const, "env", "No publiques un horario inventado.");
  const area = contact.serviceArea.isConfigured
    ? fact(contact.serviceArea.value, "confirmed" as const, "NEXT_PUBLIC_SERVICE_AREA")
    : fact("Panamá", "pending" as const, "site.region", "Usa solo «Panamá» hasta confirmar colonias o distritos.");
  return {
    name: fact(site.name, "confirmed" as const, "site.ts"),
    tagline: fact(site.tagline, "confirmed" as const, "site.ts"),
    url: fact(site.url.replace(/\/$/, ""), "confirmed" as const, "NEXT_PUBLIC_SITE_URL"),
    logo: fact("/images/homesteadservices.png", "confirmed" as const, "public/images"),
    colors: fact(
      { navy: "#1f3344", cream: "#f4efe6", gold: "#c4a45a" },
      "confirmed" as const,
      "globals.css",
    ),
    voice: fact(
      "profesional, cercano, resolutivo, sin presión ni miedo",
      "confirmed" as const,
      "concierge-knowledge + content-openai",
    ),
    hours,
    serviceArea: area,
    email: contact.email.isConfigured
      ? fact(contact.email.value, "confirmed" as const, "NEXT_PUBLIC_EMAIL")
      : fact("servicios@homestead.lat", "pending" as const, "compose default"),
    whatsapp: fact(OFFICIAL_WHATSAPP.display, "confirmed" as const, "OFFICIAL_WHATSAPP"),
    whatsappDestination: fact(OFFICIAL_WHATSAPP.destination, "confirmed" as const, "OFFICIAL_WHATSAPP"),
    pricing: fact(null, "pending" as const, "none", "No hay catálogo de precios. La visita define el alcance."),
    guarantees: fact(null, "pending" as const, "none", "No hay garantía publicada."),
    testimonials: fact([] as string[], "pending" as const, "none", "Sin testimonios autorizados en el sistema."),
    yearsExperience: fact(null, "pending" as const, "none"),
    availability247: fact(false, "confirmed" as const, "policy", "No es 24/7. No anuncies urgencias tipo 911."),
    digitalLockInstall: fact(
      true,
      "confirmed" as const,
      "form digital_lock_purchase_install + concierge vision",
      "Instalación/evaluación de cerradura digital. No prometas marcas ni compatibilidad sin ver la puerta.",
    ),
    services: {
      locksmith: fact(dictionary.services.items.locksmith, "confirmed" as const, "i18n/es.ts"),
      plumbing: fact(dictionary.services.items.plumbing, "confirmed" as const, "i18n/es.ts"),
      painting: fact(dictionary.services.items.painting, "confirmed" as const, "i18n/es.ts"),
      remodeling: fact(dictionary.services.items.remodeling, "confirmed" as const, "i18n/es.ts"),
      repairs: fact(dictionary.services.items.repairs, "confirmed" as const, "i18n/es.ts"),
      ac: fact(dictionary.services.items.ac, "confirmed" as const, "i18n/es.ts"),
      electrical: fact(dictionary.services.items.electrical, "confirmed" as const, "i18n/es.ts"),
    },
    process: fact(
      dictionary.process.steps.map((step) => `${step.title}: ${step.body}`),
      "confirmed" as const,
      "i18n/es.ts process",
    ),
    conversion: {
      webForm: fact("/contact", "confirmed" as const, "app router"),
      whatsapp: fact(true, "confirmed" as const, "OFFICIAL_WHATSAPP"),
      instagramClickableCaption: fact(
        false,
        "confirmed" as const,
        "Instagram feed policy",
        "El caption de feed no hace URL clicable. Conversión: enlace del perfil o solicitud web/WhatsApp.",
      ),
    },
    operationalCapacity: fact(
      null,
      "pending" as const,
      "none",
      "No prometas cupos, llegada en X minutos ni equipos en sitio.",
    ),
    ownPhotos: fact(
      ["/images/services/locksmith.webp"],
      "confirmed" as const,
      "public/images/services",
      "Foto ilustrativa de servicio, no evidencia de un trabajo concreto.",
    ),
  };
}

export function confirmedText(fact: BrandFact<string | null | undefined>) {
  if (fact.status !== "confirmed" || !fact.value) return null;
  return fact.value;
}
