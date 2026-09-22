import type { Metadata } from "next";
import { ContactSection } from "@/components/contact/ContactSection";
import { pageMetadata } from "@/lib/metadata";
import { getDictionary } from "@/i18n/get-dictionary";

const dictionary = getDictionary();

export const metadata: Metadata = pageMetadata({
  title: dictionary.meta.contactTitle,
  description: dictionary.meta.contactDescription,
  path: "/contact",
});

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{
    service?: string;
    intent?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    hs_ref?: string;
    hs_test?: string;
  }>;
}) {
  const params = await searchParams;

  return (
    <div className="pt-16">
      <ContactSection
        defaultService={params.service}
        defaultIntent={params.intent}
        attribution={{
          utm_source: params.utm_source,
          utm_medium: params.utm_medium,
          utm_campaign: params.utm_campaign,
          utm_content: params.utm_content,
          hs_ref: params.hs_ref,
          hs_test: params.hs_test,
        }}
      />
    </div>
  );
}
