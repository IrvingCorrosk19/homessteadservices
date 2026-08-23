import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { listRecoveryQueue, retentionDashboard } from "@/lib/retention-engine";

export const dynamic = "force-dynamic";

export default async function RetencionPage() {
  const snap = retentionDashboard(false);
  const recovery = listRecoveryQueue(false, 30);

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Wave E · Aftercare</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Retención</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-charcoal/75">
          Seguimiento post-servicio, recuperación y reputación. Sin spam. Sin reseñas inventadas.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Aftercare pendiente", value: snap.aftercarePending },
            { label: "Satisfechos (30d)", value: snap.satisfiedRecent },
            { label: "Recovery abiertos", value: snap.recoveryOpen },
            { label: "Reviews solicitadas", value: snap.reviewsRequested },
            { label: "Mantenimiento due", value: snap.maintenanceDue },
            { label: "Reactivación elegible", value: snap.reactivationEligible },
            { label: "Recovery en curso", value: snap.recoveryContacted },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{item.label}</p>
              <p className="mt-2 font-display text-3xl text-navy">{item.value}</p>
            </div>
          ))}
        </div>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-navy">Cola de recovery</h2>
          <p className="mt-1 text-sm text-mist">Prioridad URGENT → HIGH → NORMAL. SLA operativo vía Telegram.</p>
          <div className="mt-4 space-y-3">
            {recovery.map((row) => (
              <article key={row.job_id} className="rounded-2xl border border-navy/8 bg-white px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl text-navy">{row.job_number}</p>
                    <p className="mt-1 text-sm text-charcoal/70">
                      {row.customer_name || "Cliente"} · {row.service} · {row.recovery_status}
                      {row.recovery_priority ? ` · ${row.recovery_priority}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/admin/trabajos/${row.job_id}`}
                    className="rounded-xl bg-navy px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase text-cream"
                  >
                    Abrir trabajo
                  </Link>
                </div>
              </article>
            ))}
            {!recovery.length ? (
              <p className="text-sm text-mist">No hay recuperaciones abiertas en este momento.</p>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
