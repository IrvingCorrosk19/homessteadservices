"use client";

import { WhatsAppIcon } from "@/components/brand/WhatsAppIcon";
import { getSocialPlatforms, type SocialId } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

function SocialGlyph({ id }: { id: SocialId }) {
  if (id === "whatsapp") {
    return <WhatsAppIcon />;
  }

  if (id === "instagram") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="social-glyph"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        aria-hidden="true"
      >
        <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5" />
        <circle cx="12" cy="12" r="3.85" />
        <circle cx="17.15" cy="6.85" r="1.05" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (id === "facebook") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="social-glyph"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M14.1 21v-7.35h2.47l.37-2.86h-2.84V8.94c0-.83.23-1.4 1.42-1.4H17V4.97A19 19 0 0 0 14.78 4.8c-2.2 0-3.71 1.34-3.71 3.81v1.18H8.7v2.86h2.37V21h3.03Z" />
      </svg>
    );
  }

  return null;
}

export function SocialIcons({
  variant = "footer",
}: {
  variant?: "footer" | "menu";
}) {
  const dictionary = getDictionary();
  // Only live social links — no "próximamente" placeholders on the public site.
  const platforms = getSocialPlatforms().filter((platform) => Boolean(platform.href));
  if (platforms.length === 0) return null;

  return (
    <div className={`social-block social-${variant}`}>
      <p className="social-label">{dictionary.social.follow}</p>
      <ul className="social-list">
        {platforms.map((platform) => {
          const name = `${platform.label} de Homestead Services`;
          return (
            <li key={platform.id} className="social-item">
              <a
                className="social-btn"
                href={platform.href ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={name}
              >
                <SocialGlyph id={platform.id} />
              </a>
              <span className="social-tip" role="tooltip">
                {platform.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
