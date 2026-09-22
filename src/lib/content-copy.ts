import { contact, OFFICIAL_WHATSAPP, site } from "@/lib/site";

export function homesteadContactLines() {
  const web = (site.url || "https://homestead.lat").replace(/\/$/, "");
  const email = contact.email.value || "servicios@homestead.lat";
  const area = contact.serviceArea.value || "Panamá";
  return {
    whatsappDisplay: OFFICIAL_WHATSAPP.display,
    whatsappUrl: `https://wa.me/${OFFICIAL_WHATSAPP.destination}`,
    web,
    email,
    area,
  };
}

export function canonicalContactBlock() {
  const lines = homesteadContactLines();
  return [
    `WhatsApp: ${lines.whatsappDisplay}`,
    `Web: ${lines.web}`,
    `Correo: ${lines.email}`,
    `Zona: ${lines.area}`,
  ].join("\n");
}

export function withCanonicalCta(copy: string) {
  const text = copy.trim();
  const lines = homesteadContactLines();
  const hasWa =
    text.includes(OFFICIAL_WHATSAPP.display) ||
    text.includes(OFFICIAL_WHATSAPP.destination) ||
    text.includes("wa.me/50766616580");
  const hasWeb = /homestead\.lat/i.test(text);
  if (hasWa && hasWeb) return text;
  return `${text}\n\n${canonicalContactBlock()}\n${hasWa ? "" : lines.whatsappUrl}`.trim();
}
