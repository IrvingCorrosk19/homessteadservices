import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { Services } from "@/components/home/Services";
import { Integrated } from "@/components/home/Integrated";
import { ACMaintenance } from "@/components/home/ACMaintenance";
import { HowItWorks } from "@/components/home/HowItWorks";
import { Scheduled } from "@/components/home/Scheduled";
import { Trust } from "@/components/home/Trust";
import { Works } from "@/components/home/Works";
import { FinalCTA } from "@/components/home/FinalCTA";
import { ContactSection } from "@/components/contact/ContactSection";
import { pageMetadata } from "@/lib/metadata";
import { getDictionary } from "@/i18n/get-dictionary";

const dictionary = getDictionary();

export const metadata: Metadata = {
  ...pageMetadata({
    title: dictionary.meta.homeTitle,
    description: dictionary.meta.homeDescription,
    path: "/",
  }),
  title: {
    absolute: dictionary.meta.homeTitle,
  },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <Services />
      <Integrated />
      <ACMaintenance />
      <HowItWorks />
      <Scheduled />
      <Trust />
      <Works />
      <FinalCTA />
      <ContactSection />
    </>
  );
}
