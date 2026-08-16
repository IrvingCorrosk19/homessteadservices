import Image from "next/image";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { images, imageAlts } from "@/data/images";
import { getDictionary } from "@/i18n/get-dictionary";

export function ACMaintenance() {
  const dictionary = getDictionary();

  return (
    <section className="bg-white py-20 md:py-28">
      <div className="container-home grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal image className="relative aspect-[4/3] overflow-hidden rounded-2xl">
          <Image
            src={images.acFeature}
            alt={imageAlts.acFeature}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover"
          />
        </Reveal>
        <Reveal>
          <p className="text-[0.72rem] tracking-[0.2em] uppercase text-accent-deep">
            Servicio recurrente
          </p>
          <h2 className="mt-3 font-display text-4xl text-navy md:text-5xl">
            {dictionary.ac.title}
          </h2>
          <p className="mt-5 text-lg leading-8 text-navy-soft">{dictionary.ac.body}</p>
          <ul className="mt-6 space-y-2 text-navy">
            {dictionary.ac.items.map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <ButtonLink href="/contact?service=ac">{dictionary.ac.cta}</ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
