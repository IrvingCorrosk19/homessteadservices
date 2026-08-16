import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import { images, imageAlts } from "@/data/images";
import { whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function Hero() {
  const dictionary = getDictionary();
  const whatsapp = whatsappHref(dictionary.whatsapp.defaultMessage);

  return (
    <section id="inicio" className="relative min-h-[100svh] overflow-hidden">
      <Image
        src={images.hero}
        alt={imageAlts.hero}
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-navy/78 via-navy/48 to-navy/18" />
      <div className="relative container-home flex min-h-[100svh] flex-col justify-end pb-24 pt-32 md:justify-center md:pb-20">
        <p className="text-[0.72rem] tracking-[0.22em] uppercase text-cream/70">
          HOMESTEAD SERVICES
        </p>
        <h1 className="mt-4 max-w-xl font-display text-[2.7rem] leading-[1.08] text-cream md:text-6xl">
          {dictionary.hero.title}
        </h1>
        <p className="mt-5 max-w-lg text-lg leading-8 text-cream/88">
          {dictionary.hero.subtitle}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/contact" variant="light">
            {dictionary.common.request}
          </ButtonLink>
          <ButtonLink
            href={whatsapp ?? "/contact"}
            variant="secondary"
            target={whatsapp ? "_blank" : undefined}
            rel={whatsapp ? "noopener noreferrer" : undefined}
          >
            WhatsApp
          </ButtonLink>
        </div>
        <p className="mt-10 max-w-xl text-[0.78rem] tracking-[0.08em] text-cream/70">
          {dictionary.hero.chips}
        </p>
      </div>
    </section>
  );
}
