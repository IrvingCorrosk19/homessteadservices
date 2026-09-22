"use client";

import { WhatsAppIcon } from "@/components/brand/WhatsAppIcon";
import { isOfficialWhatsAppEnabled, whatsappDefaultMessage, whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function WhatsAppHeaderCta({
  placement = "header",
}: {
  placement?: "header" | "menu";
}) {
  const dictionary = getDictionary();
  if (!isOfficialWhatsAppEnabled()) return null;
  const href = whatsappHref(whatsappDefaultMessage());
  if (!href) return null;

  const fullLabel = dictionary.common.consultWhatsApp;

  return (
    <a
      className={placement === "menu" ? "header-wa-cta header-wa-cta-menu" : "header-wa-cta"}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={fullLabel}
    >
      <WhatsAppIcon className="header-wa-glyph" />
      {placement === "menu" ? (
        <span>{fullLabel}</span>
      ) : (
        <>
          <span className="header-wa-label-short">{dictionary.whatsapp.label}</span>
          <span className="header-wa-label-full">{fullLabel}</span>
        </>
      )}
    </a>
  );
}
