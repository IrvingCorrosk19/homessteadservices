import { works } from "@/data/images";

export function Works() {
  if (!works.enabled || works.items.length === 0) return null;

  return (
    <section className="bg-cream py-20 md:py-28">
      <div className="container-home">
        <h2 className="font-display text-4xl text-navy md:text-5xl">
          Trabajos realizados
        </h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {works.items.map((item) => (
            <figure key={item.id} className="overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.src} alt={item.title} className="aspect-[4/3] w-full object-cover" />
              <figcaption className="mt-3 text-sm text-navy-soft">{item.caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
