import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { getDictionary } from "@/i18n/get-dictionary";

export function Integrated() {
  const dictionary = getDictionary();

  return (
    <section className="bg-navy py-20 text-cream md:py-28">
      <div className="container-home">
        <Reveal>
          <h2 className="max-w-2xl font-display text-4xl md:text-5xl">
            {dictionary.integrated.title}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-cream/80">
            {dictionary.integrated.body}
          </p>
        </Reveal>

        <Reveal delay={80} className="mt-12">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-[0.78rem] tracking-[0.16em] uppercase">
            {dictionary.integrated.items.map((item, index) => (
              <span key={item} className="flex items-center gap-4">
                <span className="rounded-full border border-cream/25 px-4 py-2">
                  {item}
                </span>
                {index < dictionary.integrated.items.length - 1 && (
                  <span className="text-accent" aria-hidden="true">
                    +
                  </span>
                )}
              </span>
            ))}
            <span className="text-accent" aria-hidden="true">
              =
            </span>
            <span className="font-display text-xl tracking-normal normal-case md:text-2xl">
              {dictionary.integrated.equals}
            </span>
          </div>
        </Reveal>

        <Reveal delay={140} className="mt-10">
          <ButtonLink
            href="/contact?service=multiple"
            variant="light"
          >
            {dictionary.integrated.cta}
          </ButtonLink>
        </Reveal>
      </div>
    </section>
  );
}
