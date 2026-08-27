"use client";

import Image from "next/image";
import { Reveal } from "@/components/ui/Reveal";
import { ServiceIcon } from "@/components/brand/ServiceIcon";
import { ServiceConsultButton } from "@/components/concierge/ServiceConsultButton";
import { images, imageAlts } from "@/data/images";
import { serviceSlugs } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export function Services({
  hideIntro = false,
}: {
  hideIntro?: boolean;
}) {
  const dictionary = getDictionary();

  return (
    <section id="servicios" className="bg-cream py-20 md:py-28">
      <div className="container-home">
        {!hideIntro && (
          <Reveal>
            <h2 className="max-w-xl font-display text-4xl text-navy md:text-5xl">
              {dictionary.services.title}
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-navy-soft">
              {dictionary.services.intro}
            </p>
          </Reveal>
        )}

        <div className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${hideIntro ? "" : "mt-12"}`}>
          {serviceSlugs.map((slug, index) => {
            const item = dictionary.services.items[slug];
            const imageSrc = images.services[slug];
            return (
              <Reveal
                key={slug}
                as="article"
                delay={index * 60}
                className="group overflow-hidden rounded-2xl border border-line bg-white"
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <Image
                    src={imageSrc}
                    alt={imageAlts[slug]}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-end justify-end bg-gradient-to-t from-navy/35 via-transparent to-transparent p-3 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                    <ServiceConsultButton
                      serviceId={slug}
                      serviceName={item.title}
                      imageId={`service-${slug}`}
                      imageSrc={imageSrc}
                      itemId={slug}
                      itemTitle={item.title}
                      contextLabel={item.title}
                      intentHint=""
                      className="pointer-events-auto rounded-full bg-cream/95 px-3 py-1.5 text-[0.68rem] font-medium tracking-[0.12em] uppercase text-navy shadow-sm"
                    >
                      Consultar
                    </ServiceConsultButton>
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 text-navy">
                    <ServiceIcon slug={slug} />
                    <h3 className="text-lg font-medium">{item.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-navy-soft">
                    {item.description}
                  </p>
                  <ServiceConsultButton
                    serviceId={slug}
                    serviceName={item.title}
                    imageId={`service-${slug}`}
                    imageSrc={imageSrc}
                    itemId={slug}
                    itemTitle={item.title}
                    contextLabel={item.title}
                    intentHint=""
                    className="mt-5 inline-flex text-sm font-medium text-navy underline-offset-4 hover:underline"
                  >
                    {item.cta}
                  </ServiceConsultButton>
                </div>
              </Reveal>
            );
          })}
        </div>
        <p className="mt-8 text-xs text-mist">{dictionary.common.representativeNote}</p>
      </div>
    </section>
  );
}
