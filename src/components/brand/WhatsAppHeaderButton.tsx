"use client";

import { WhatsAppIcon } from "@/components/brand/WhatsAppIcon";
import { isPublicWhatsAppEnabled, whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function WhatsAppHeaderButton() {
  if (!isPublicWhatsAppEnabled()) return null;

  const dictionary = getDictionary();
  const href = whatsappHref(dictionary.whatsapp.headerMessage);
  if (!href) return null;

  const tip = dictionary.common.whatsapp;

  return (
    <a
      className="wa-header-btn"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={tip}
    >
      <WhatsAppIcon className="wa-header-glyph" />
      <span className="wa-header-tip" role="tooltip">
        {tip}
      </span>
    </a>
  );
}
