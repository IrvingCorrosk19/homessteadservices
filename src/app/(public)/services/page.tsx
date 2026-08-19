import type { Metadata } from "next";
import { Services } from "@/components/home/Services";
import { Integrated } from "@/components/home/Integrated";
import { ACMaintenance } from "@/components/home/ACMaintenance";
import { FinalCTA } from "@/components/home/FinalCTA";
import { pageMetadata } from "@/lib/metadata";
import { getDictionary } from "@/i18n/get-dictionary";

const dictionary = getDictionary();

export const metadata: Metadata = pageMetadata({
  title: dictionary.meta.servicesTitle,
  description: dictionary.meta.servicesDescription,
  path: "/services",
});

export default function ServicesPage() {
  return (
    <>
      <section className="bg-navy pt-28 pb-16 text-cream md:pt-36 md:pb-20">
        <div className="container-home">
          <p className="text-[0.72rem] tracking-[0.2em] uppercase text-cream/60">
            HOMESTEAD SERVICES
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-4xl md:text-6xl">
            {dictionary.services.title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-cream/80">
            {dictionary.services.intro}
          </p>
        </div>
      </section>
      <Services hideIntro />
      <Integrated />
      <ACMaintenance />
      <FinalCTA />
    </>
  );
}
