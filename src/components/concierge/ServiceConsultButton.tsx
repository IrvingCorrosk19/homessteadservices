"use client";

import { openHomesteadChat, type WebsiteImageChatContext } from "@/lib/concierge-entry-context";
import type { ServiceSlug } from "@/lib/site";

export function ServiceConsultButton({
  serviceId,
  serviceName,
  imageId,
  imageSrc,
  itemId,
  itemTitle,
  contextLabel,
  intentHint = "",
  className = "",
  children = "Consultar",
}: {
  serviceId: ServiceSlug | "other";
  serviceName: string;
  imageId: string;
  imageSrc?: string;
  itemId?: string;
  itemTitle?: string;
  contextLabel?: string;
  intentHint?: WebsiteImageChatContext["intentHint"];
  className?: string;
  children?: React.ReactNode;
}) {
  const label = contextLabel || serviceName;
  const title = itemTitle || serviceName;

  function onConsult() {
    const context: WebsiteImageChatContext = {
      source: "website_image",
      serviceId,
      serviceName,
      itemId: itemId || serviceId,
      itemTitle: title,
      imageId,
      imageSrc,
      pagePath: typeof window !== "undefined" ? window.location.pathname : "/",
      contextLabel: label,
      intentHint: intentHint || "",
    };
    openHomesteadChat(context);
  }

  return (
    <button
      type="button"
      onClick={onConsult}
      className={className}
      aria-label={`Consultar ${title} con Homestead`}
    >
      {children}
    </button>
  );
}

export function OpenChatButton({
  className = "",
  children = "Hablar con Homestead",
  context,
}: {
  className?: string;
  children?: React.ReactNode;
  context?: WebsiteImageChatContext | null;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => openHomesteadChat(context ?? null)}
      aria-label="Abrir chat con Homestead"
    >
      {children}
    </button>
  );
}
