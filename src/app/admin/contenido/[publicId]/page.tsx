import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlDisplayPill } from "@/components/admin/control/ControlDisplayPill";
import { ControlJobActions } from "@/components/admin/control/ControlJobActions";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { getControlJobDetail } from "@/lib/control-service";

export const dynamic = "force-dynamic";

export default async function ControlJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  const job = getControlJobDetail(publicId);
  if (!job) notFound();
  const back = query.from?.startsWith("/admin/contenido") ? query.from : "/admin/contenido";

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(880px,calc(100%-1.5rem))] py-8 md:w-[min(880px,calc(100%-4rem))] md:py-12">
        <ControlSubnav current="/admin/contenido" />
        <p className="mt-4">
          <Link href={back} className="text-sm text-navy underline">
            Volver a la cola
          </Link>
        </p>
        <p className="mt-6 text-[0.68rem] tracking-[0.14em] uppercase text-accent">{job.publicId}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl text-navy">Pieza</h1>
          <ControlDisplayPill state={job.displayState} />
        </div>
        <p className="mt-2 text-sm text-mist">Versión {job.version || "—"} · persistido {job.status}</p>
        {job.previewAssetId ? (
          <div className="relative mt-6 aspect-[4/5] max-h-[520px] overflow-hidden rounded-[28px] bg-cream-deep">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/content/media?asset=${job.previewAssetId}`}
              alt={`Vista de ${job.publicId}`}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <p className="mt-6 rounded-2xl border border-navy/10 bg-white px-4 py-6 text-sm text-mist">
            Esta pieza no tiene imagen almacenada.
          </p>
        )}
        <section className="mt-6 rounded-2xl border border-navy/8 bg-white p-5">
          <h2 className="font-display text-2xl text-navy">Texto</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-charcoal/80">
            {job.copy || "Sin copy. No se inventó un texto comercial."}
          </p>
          {job.cta ? <p className="mt-3 text-sm text-navy">CTA: {job.cta}</p> : null}
        </section>
        <section className="mt-6 rounded-2xl border border-navy/8 bg-white p-5">
          <h2 className="font-display text-2xl text-navy">Programación</h2>
          <p className="mt-2 text-sm">{job.recommendedPublishLabel || "Aprobada sin programar o sin horario."}</p>
          <p className="mt-2 text-xs text-mist">
            Lote {job.batchId ? <Link href={`/admin/contenido/lotes/${job.batchId}`}>{job.batchId}</Link> : "—"} ·
            Campaña{" "}
            {job.campaignId ? <Link href={`/admin/contenido/campanas/${job.campaignId}`}>{job.campaignId}</Link> : "—"}
          </p>
        </section>
        <section className="mt-6 rounded-2xl border border-navy/8 bg-white p-5">
          <h2 className="font-display text-2xl text-navy">Redes</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {job.publications.map((row) => (
              <li key={`${row.platform}-${row.status}-${row.dryRun}`} className="rounded-xl border border-navy/8 px-3 py-2">
                <p className="font-medium text-navy">
                  {row.platform} · {row.status}
                  {row.dryRun ? " · simulación" : ""}
                </p>
                {row.permalink ? (
                  <a href={row.permalink} className="text-navy underline" target="_blank" rel="noreferrer">
                    Ver publicación
                  </a>
                ) : null}
                {row.errorLabel ? <p className="text-rose-800">{row.errorLabel}</p> : null}
              </li>
            ))}
            {!job.publications.length ? <li className="text-mist">Todavía no hay intentos de publicación.</li> : null}
          </ul>
        </section>
        <section className="mt-6">
          <ControlJobActions
            publicId={job.publicId}
            version={job.version}
            displayState={job.displayState}
            paused={job.paused}
            actions={job.actions}
          />
        </section>
        <section className="mt-8">
          <h2 className="font-display text-2xl text-navy">Historial</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {job.history.map((row, index) => (
              <li key={`${row.createdAt}-${index}`} className="text-charcoal/75">
                {row.createdAt} · {row.event}
                {row.detail ? ` · ${row.detail}` : ""}
              </li>
            ))}
            {!job.history.length ? <li className="text-mist">Sin eventos.</li> : null}
          </ul>
        </section>
        <p className="mt-8 text-xs text-mist">{job.laterNote}</p>
      </main>
    </>
  );
}
