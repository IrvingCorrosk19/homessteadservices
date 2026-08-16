import { Reveal } from "@/components/ui/Reveal";
import { testimonials } from "@/data/images";
import { getDictionary } from "@/i18n/get-dictionary";

export function Trust() {
  const dictionary = getDictionary();

  return (
    <section className="bg-white py-20 md:py-28">
      <div className="container-home">
        <Reveal>
          <h2 className="max-w-xl font-display text-4xl text-navy md:text-5xl">
            {dictionary.trust.title}
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {dictionary.trust.items.map((item, index) => (
            <Reveal
              key={item.title}
              delay={index * 60}
              className="rounded-2xl border border-line bg-cream px-6 py-7"
            >
              <h3 className="font-display text-2xl text-navy">{item.title}</h3>
              <p className="mt-3 leading-7 text-navy-soft">{item.body}</p>
            </Reveal>
          ))}
        </div>
        {testimonials.enabled && testimonials.items.length > 0 && (
          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {testimonials.items.map((item) => (
              <blockquote
                key={item.name}
                className="rounded-2xl border border-line px-6 py-7"
              >
                <p className="leading-7 text-navy-soft">“{item.quote}”</p>
                <footer className="mt-4 text-sm text-navy">{item.name}</footer>
              </blockquote>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
