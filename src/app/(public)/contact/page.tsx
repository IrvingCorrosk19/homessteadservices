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
  searchParams: Promise<{ service?: string; intent?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="pt-16">
      <ContactSection
        defaultService={params.service}
        defaultIntent={params.intent}
      />
    </div>
  );
}
