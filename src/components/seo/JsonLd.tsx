import { contact, site } from "@/lib/site";
import { images } from "@/data/images";

export function JsonLd() {
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
    ...(contact.phone.isConfigured ? { telephone: contact.phone.value } : {}),
    ...(contact.email.isConfigured ? { email: contact.email.value } : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
