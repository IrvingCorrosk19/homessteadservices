import { Reveal } from "@/components/ui/Reveal";
import { getDictionary } from "@/i18n/get-dictionary";

export function HowItWorks() {
  const dictionary = getDictionary();

  return (
    <section id="como-funciona" className="bg-cream py-20 md:py-28">
      <div className="container-home">
        <Reveal>
          <h2 className="max-w-xl font-display text-4xl text-navy md:text-5xl">
            {dictionary.process.title}
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {dictionary.process.steps.map((step, index) => (
            <Reveal key={step.number} delay={index * 70}>
              <p className="text-[0.72rem] tracking-[0.2em] uppercase text-accent-deep">
                {step.number}
              </p>
              <h3 className="mt-3 font-display text-2xl text-navy">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-navy-soft">{step.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
