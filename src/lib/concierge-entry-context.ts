import type { ServiceSlug } from "@/lib/site";

export type WebsiteImageChatContext = {
  source: "website_image";
  serviceId: ServiceSlug | "other";
  serviceName: string;
  itemId: string;
  itemTitle: string;
  imageId: string;
  imageSrc?: string;
  pagePath: string;
  contextLabel: string;
  intentHint?: "digital_lock" | "maintenance" | "repair" | "";
};

export const HOMESTEAD_OPEN_CHAT_EVENT = "homestead:open-chat";

export function openHomesteadChat(context?: WebsiteImageChatContext | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(HOMESTEAD_OPEN_CHAT_EVENT, {
      detail: context ?? null,
    }),
  );
}

export function isWebsiteImageChatContext(value: unknown): value is WebsiteImageChatContext {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.source === "website_image" && typeof item.serviceId === "string" && typeof item.serviceName === "string";
}

export function contextualGreetingForImage(
  ctx: WebsiteImageChatContext,
  customerName = "",
): string {
  const first =
    customerName && !/cliente web/i.test(customerName) ? customerName.trim().split(/\s+/)[0] : "";
  const hi = first ? `Claro, ${first}. ` : "Claro. ";

  if (ctx.intentHint === "digital_lock" || /cerradura digital|digital lock/i.test(ctx.contextLabel)) {
    return `${hi}Veo que te interesa una cerradura digital. ¿Quieres instalar una nueva o revisar una que ya tienes?`;
  }
  switch (ctx.serviceId) {
    case "painting":
      return `${hi}Veo que te interesa renovar con pintura. ¿Es para una casa, apartamento, oficina o local?`;
    case "ac":
      return `${hi}¿Buscas mantenimiento preventivo o el aire está presentando algún problema?`;
    case "plumbing":
      return `${hi}Veo que estás mirando plomería. ¿Hay una fuga, un tapón o algo que no está funcionando bien?`;
    case "electrical":
      return `${hi}Veo que te interesa electricidad. ¿Es una reparación, una instalación nueva o una revisión?`;
    case "locksmith":
      return `${hi}Veo que te interesa cerrajería. ¿Quieres instalar una cerradura digital nueva o revisar / cambiar una que ya tienes?`;
    case "repairs":
      return `${hi}Veo que estás mirando reparaciones. ¿Qué necesitas arreglar en tu espacio?`;
    case "remodeling":
      return `${hi}Veo que te interesa una mejora o remodelación. ¿Qué espacio quieres transformar?`;
    default:
      return `${hi}Veo que te interesa ${ctx.serviceName.toLowerCase()}. Cuéntame un poco más para orientarte.`;
  }
}

export function contextSwitchPrompt(next: WebsiteImageChatContext) {
  return `También estás viendo ${next.serviceName.toLowerCase()}. ¿Quieres que hablemos de eso ahora?`;
}
