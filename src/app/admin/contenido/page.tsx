import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlDisplayPill } from "@/components/admin/control/ControlDisplayPill";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { listControlJobs, paginateControlJobs } from "@/lib/control-service";
import { CONTROL_DISPLAY_STATES, controlDisplayLabel, type ControlDisplayState } from "@/lib/control-status";

export const dynamic = "force-dynamic";

function hrefWith(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/admin/contenido?${qs}` : "/admin/contenido";
}

export default async function ControlQueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    batchId?: string;
    campaignId?: string;
    platform?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const state = CONTROL_DISPLAY_STATES.includes(params.state as ControlDisplayState)
    ? (params.state as ControlDisplayState)
    : "all";
  const jobs = listControlJobs({
    state,
    batchId: params.batchId,
    campaignId: params.campaignId,
    platform: params.platform,
    q: params.q,
  });
  const page = paginateControlJobs(jobs, Number(params.page || 1), 12);
  const shared = {
    state: state === "all" ? undefined : state,
    batchId: params.batchId,
    campaignId: params.campaignId,
    platform: params.platform,
    q: params.q,
  };

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] min-w-0 py-8 md:w-[min(1120px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-accent">Homestead Control</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Cola de contenido</h1>
        <p className="mt-3 max-w-2xl text-sm text-charcoal/75">
          Estados visuales derivados de SQLite. Video y carrusel no están disponibles.
        </p>
        <ControlSubnav current="/admin/contenido" />
        <form className="mt-6 grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,140px)_minmax(0,140px)_minmax(0,140px)_auto]" action="/admin/contenido">
          {state !== "all" ? <input type="hidden" name="state" value={state} /> : null}
          <input
            name="q"
            defaultValue={params.q || ""}
            placeholder="Buscar folio HC-, lote o campaña"
            className="min-h-11 min-w-0 rounded-2xl border border-navy/15 px-3"
          />
          <select name="platform" defaultValue={params.platform || ""} className="min-h-11 min-w-0 rounded-2xl border border-navy/15 px-3">
            <option value="">Todas las redes</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </select>
          <input
            name="batchId"
            defaultValue={params.batchId || ""}
            placeholder="Lote HB-"
            className="min-h-11 min-w-0 rounded-2xl border border-navy/15 px-3"
          />
          <input
            name="campaignId"
            defaultValue={params.campaignId || ""}
            placeholder="Campaña CM-"
            className="min-h-11 min-w-0 rounded-2xl border border-navy/15 px-3"
          />
          <button type="submit" className="min-h-11 rounded-full bg-navy px-4 text-sm text-cream">
            Filtrar
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={hrefWith({ ...shared, state: undefined, page: undefined })}
            className={`min-h-10 rounded-full px-4 py-2 text-[0.68rem] uppercase tracking-[0.08em] ${
              state === "all" ? "bg-navy text-cream" : "border border-navy/15 bg-white"
            }`}
          >
            Todas
          </Link>
          {CONTROL_DISPLAY_STATES.filter((item) => item !== "other").map((item) => (
            <Link
              key={item}
              href={hrefWith({ ...shared, state: item, page: undefined })}
              className={`min-h-10 rounded-full px-4 py-2 text-[0.68rem] uppercase tracking-[0.08em] ${
                state === item ? "bg-navy text-cream" : "border border-navy/15 bg-white"
              }`}
            >
              {controlDisplayLabel(item)}
            </Link>
          ))}
        </div>
        <ul className="mt-6 space-y-3">
          {page.items.map((job) => (
            <li key={job.publicId}>
              <Link
                href={`/admin/contenido/${job.publicId}?from=${encodeURIComponent(hrefWith({ ...shared, page: String(page.page) }))}`}
                className="block rounded-2xl border border-navy/8 bg-white px-4 py-4"
              >
                <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
                  {job.previewAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/admin/content/media?asset=${job.previewAssetId}`}
                      alt=""
                      className="h-20 w-16 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-xl bg-cream-deep text-xs text-mist">
                      Sin foto
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-navy">{job.publicId}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-charcoal/70">{job.copy || "Sin texto todavía"}</p>
                    <p className="mt-2 break-words text-xs text-mist">
                      {job.batchId || "Sin lote"} · {job.campaignId || "Sin campaña"} ·{" "}
                      {job.recommendedPublishLabel || "Sin horario"}
                    </p>
                  </div>
                  <ControlDisplayPill state={job.displayState} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {!page.items.length ? (
          <p className="mt-8 text-sm text-mist">No hay piezas con ese filtro. La cola está vacía, no es un módulo pendiente.</p>
        ) : null}
        {page.pages > 1 ? (
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Paginación">
            {page.page > 1 ? (
              <Link href={hrefWith({ ...shared, page: String(page.page - 1) })} className="min-h-11 rounded-full border border-navy/15 px-4 py-2">
                Anterior
              </Link>
            ) : null}
            <span className="min-h-11 px-3 py-2 text-sm text-mist">
              Página {page.page} de {page.pages}
            </span>
            {page.page < page.pages ? (
              <Link href={hrefWith({ ...shared, page: String(page.page + 1) })} className="min-h-11 rounded-full border border-navy/15 px-4 py-2">
                Siguiente
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
    </>
  );
}
