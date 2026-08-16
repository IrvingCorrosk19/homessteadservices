import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { ServiceIcon } from "@/components/brand/ServiceIcon";
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
            return (
              <Reveal
                key={slug}
                as="article"
                delay={index * 60}
                className="group overflow-hidden rounded-2xl border border-line bg-white"
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <Image
                    src={images.services[slug]}
                    alt={imageAlts[slug]}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 text-navy">
                    <ServiceIcon slug={slug} />
                    <h3 className="text-lg font-medium">{item.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-navy-soft">
                    {item.description}
                  </p>
                  <Link
                    href={`/contact?service=${slug}`}
                    className="mt-5 inline-flex text-sm font-medium text-navy underline-offset-4 hover:underline"
                  >
                    {item.cta}
                  </Link>
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
