import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { getDictionary } from "@/i18n/get-dictionary";

export function Scheduled() {
  const dictionary = getDictionary();

  return (
    <section className="bg-cream-deep py-20 md:py-24">
      <div className="container-home grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <Reveal>
          <h2 className="font-display text-4xl text-navy md:text-5xl">
            {dictionary.scheduled.title}
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-navy-soft">
            {dictionary.scheduled.body}
          </p>
          <div className="mt-8">
            <ButtonLink href="/contact?intent=maintenance">
              {dictionary.scheduled.cta}
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <p className="text-[0.68rem] tracking-[0.18em] uppercase text-mist">
            {dictionary.scheduled.applies}
          </p>
          <ul className="mt-4 space-y-3">
            {dictionary.scheduled.items.map((item) => (
              <li
                key={item}
                className="rounded-xl border border-line bg-white px-4 py-3 text-navy"
              >
                {item}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
