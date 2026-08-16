import type { ServiceSlug } from "@/lib/site";

/**
 * Imágenes representativas del servicio.
 * No son trabajos de HOMESTEAD. Reemplazar fácilmente por fotografías reales
 * manteniendo estos mismos nombres de archivo.
 *
 * Licencias: Unsplash License y Pexels License (uso comercial permitido).
 * Ver public/images/CREDITS.txt
 */
export const images = {
  hero: "/images/hero.webp",
  cta: "/images/cta.webp",
  contact: "/images/contact.webp",
  acFeature: "/images/features/ac-maintenance.webp",
  services: {
    ac: "/images/services/ac.webp",
    plumbing: "/images/services/plumbing.webp",
    painting: "/images/services/painting.webp",
    electrical: "/images/services/electrical.webp",
    locksmith: "/images/services/locksmith.webp",
    repairs: "/images/services/repairs.webp",
    remodeling: "/images/services/remodeling.webp",
  } satisfies Record<ServiceSlug, string>,
} as const;

export const imageAlts: Record<string, string> = {
  hero: "Interior residencial limpio y luminoso, representativo del tipo de espacios que atendemos",
  cta: "Espacio interior residencial en tonos cálidos",
  contact: "Detalle de un interior residencial ordenado",
  acFeature: "Técnico realizando mantenimiento de un aire acondicionado tipo split",
  ac: "Mantenimiento representativo de un sistema de aire acondicionado tipo split",
  plumbing: "Reparación representativa de grifería en un lavamanos residencial",
  painting: "Profesional pintando una pared interior",
  electrical: "Trabajo eléctrico residencial en luminaria o instalación",
  locksmith: "Instalación representativa de una cerradura moderna",
  repairs: "Herramientas y reparación residencial de pequeña escala",
  remodeling: "Mejora interior representativa de cocina o espacio residencial",
};

/**
 * Activar cuando existan fotografías auténticas de trabajos HOMESTEAD.
 * Mientras esté en false, la sección "Trabajos realizados" no se muestra.
 */
export const works = {
  enabled: false,
  items: [] as {
    id: string;
    title: string;
    src: string;
    caption: string;
  }[],
};

/**
 * Activar cuando existan testimonios reales de clientes.
 */
export const testimonials = {
  enabled: false,
  items: [] as {
    name: string;
    quote: string;
    property?: string;
  }[],
};
