"use client";

import { WhatsAppIcon } from "@/components/brand/WhatsAppIcon";
import { whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function WhatsAppHeaderButton() {
  const dictionary = getDictionary();
  const href = whatsappHref(dictionary.whatsapp.headerMessage);
  const tip = dictionary.common.whatsapp;
  const label = href ? tip : `${tip} — ${dictionary.social.soon}`;

  const content = (
    <>
      <WhatsAppIcon className="wa-header-glyph" />
      <span className="wa-header-tip" role="tooltip">
        {tip}
      </span>
    </>
  );

  if (href) {
    return (
      <a
        className="wa-header-btn"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
      >
        {content}
      </a>
    );
  }

  return (
    <button type="button" className="wa-header-btn is-soon" aria-label={label}>
      {content}
    </button>
  );
}
