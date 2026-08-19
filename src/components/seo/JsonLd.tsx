import { contact, getSocialPlatforms, site } from "@/lib/site";
import { images } from "@/data/images";

export function JsonLd() {
  const sameAs = getSocialPlatforms()
    .map((platform) => platform.href)
    .filter((href): href is string => Boolean(href));
  const data = {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "HomeAndConstructionBusiness"],
    name: site.name,
    alternateName: site.shortName,
    description:
      "Mantenimiento, reparaciones y mejoras para hogares, apartamentos, oficinas y pequeños comercios en Panamá.",
    url: site.url,
    image: `${site.url}${images.hero}`,
    slogan: site.tagline,
    areaServed: {
      "@type": "Country",
      name: "Panama",
    },
    address: {
      "@type": "PostalAddress",
      addressCountry: "PA",
    },
    knowsLanguage: ["es"],
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(contact.phone.isConfigured ? { telephone: contact.phone.value } : {}),
    ...(contact.email.isConfigured ? { email: contact.email.value } : {}),
    ...(contact.hours.isConfigured
      ? {
          openingHoursSpecification: {
            "@type": "OpeningHoursSpecification",
            opens: "08:00",
            closes: "22:00",
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
