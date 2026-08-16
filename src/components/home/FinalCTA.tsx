import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import { images, imageAlts } from "@/data/images";
import { whatsappHref } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function FinalCTA() {
  const dictionary = getDictionary();
  const whatsapp = whatsappHref(dictionary.whatsapp.defaultMessage);

  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <Image
        src={images.cta}
        alt={imageAlts.cta}
        fill
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-navy/72" />
      <div className="relative container-home text-center text-cream">
        <h2 className="font-display text-4xl md:text-5xl">{dictionary.cta.title}</h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-cream/85">
          {dictionary.cta.body}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/contact" variant="light">
            {dictionary.cta.request}
          </ButtonLink>
          <ButtonLink
            href={whatsapp ?? "/contact"}
            variant="secondary"
            target={whatsapp ? "_blank" : undefined}
            rel={whatsapp ? "noopener noreferrer" : undefined}
          >
            {dictionary.cta.whatsapp}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
