import Link from "next/link";
import type { AttentionItem } from "@/lib/analytics-service";
import { resolveAttentionVisual } from "@/lib/attention-visual";

type NeedsAttentionBlockProps = {
  items: AttentionItem[];
  title?: string;
  emptyMessage?: string;
  compact?: boolean;
};

export function NeedsAttentionBlock({
  items,
  title = "Necesita tu atención",
  emptyMessage = "No tienes casos que necesiten atención ahora.",
  compact = false,
}: NeedsAttentionBlockProps) {
  return (
    <section aria-labelledby="needs-attention-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="needs-attention-heading" className="font-display text-2xl text-navy md:text-3xl">
            {title}
          </h2>
          <p className="mt-1 text-sm text-mist">Qué pasó, con quién, desde cuándo y qué hacer.</p>
        </div>
        {items.length ? (
          <Link
            href="/admin/solicitudes?ops=NEEDS_ATTENTION"
            className="min-h-11 rounded-full border border-navy/15 px-4 py-2.5 text-[0.68rem] tracking-[0.12em] uppercase text-navy"
          >
            Ver solicitudes
          </Link>
        ) : null}
      </div>

      <div className={`mt-4 space-y-3 ${compact ? "" : "md:mt-5"}`}>
        {items.length === 0 ? (
          <p className="rounded-2xl border border-navy/8 bg-white px-5 py-6 text-sm text-mist">{emptyMessage}</p>
        ) : (
          items.map((item) => {
            const visual = resolveAttentionVisual(item.kind);
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`block rounded-2xl border px-4 py-4 transition hover:-translate-y-0.5 ${visual.priorityClass}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] tracking-[0.1em] uppercase ${visual.badgeClass}`}
                        aria-hidden="true"
                      >
                        <span>{visual.icon}</span>
                        {visual.label}
                      </span>
                      {item.priority <= 1 ? (
                        <span className="text-[0.65rem] tracking-[0.12em] uppercase text-accent-deep">Prioridad alta</span>
                      ) : null}
                    </div>
                    <p className="mt-2 font-display text-lg text-navy md:text-xl">{item.title}</p>
                    {item.detail ? <p className="mt-1 truncate text-sm text-charcoal/75">{item.detail}</p> : null}
                  </div>
                  <span className="shrink-0 text-[0.65rem] tracking-[0.12em] uppercase text-accent">{visual.actionLabel} →</span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
