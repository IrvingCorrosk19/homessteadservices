import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  REQUEST_STATUSES,
  STATUS_LABELS,
  formatPanamaDateTime,
  isRequestStatus,
  type RequestStatus,
} from "@/lib/admin-format";
import { countRequestsByStatus, listServiceRequests, repliedPublicIds } from "@/lib/service-requests";
import { formServices } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";

export const dynamic = "force-dynamic";

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; service?: string; date?: string }>;
}) {
  const params = await searchParams;
  const status = isRequestStatus(params.status ?? "") ? params.status : "ALL";
  const service = formServices.includes(params.service as (typeof formServices)[number])
    ? params.service
    : "";
  const q = params.q?.trim() ?? "";
  const date = params.date?.trim() ?? "";
  const counts = countRequestsByStatus();
  const from = date ? `${date}T00:00:00.000Z` : undefined;
  const to = date ? `${date}T23:59:59.999Z` : undefined;
  const requests = listServiceRequests({
    q,
    status: status as RequestStatus | "ALL",
    service: service || undefined,
    from,
    to,
  });
  const replied = repliedPublicIds();
  const dictionary = getDictionary();

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))] md:py-12">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {REQUEST_STATUSES.filter((item) => item !== "CANCELLED").map((item) => (
            <Link
              key={item}
              href={`/admin/solicitudes?status=${item}`}
              className="rounded-2xl border border-navy/8 bg-white px-4 py-4"
            >
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">
                {STATUS_LABELS[item]}
              </p>
              <p className="mt-2 font-display text-3xl text-navy">{counts[item]}</p>
            </Link>
          ))}
        </div>

        <form className="mt-8 grid gap-3 md:grid-cols-[1fr_160px_180px_160px_auto]" action="/admin/solicitudes">
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar folio, nombre, email o teléfono"
            className="rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <select
            name="status"
            defaultValue={status}
            className="rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm"
          >
            <option value="ALL">Todos los estados</option>
            {REQUEST_STATUSES.map((item) => (
              <option key={item} value={item}>
                {STATUS_LABELS[item]}
              </option>
            ))}
          </select>
          <select
            name="service"
            defaultValue={service}
            className="rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm"
          >
            <option value="">Todos los servicios</option>
            {formServices.map((item) => (
              <option key={item} value={item}>
                {dictionary.form.serviceOptions[item]}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm"
          />
          <button
            type="submit"
            className="rounded-xl bg-navy px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream"
          >
            Filtrar
          </button>
        </form>

        <div className="mt-6 space-y-3">
          {requests.length === 0 ? (
            <p className="rounded-2xl border border-navy/8 bg-white px-5 py-8 text-center text-mist">
              No hay solicitudes con ese criterio.
            </p>
          ) : (
            requests.map((request) => {
              return (
                <Link
                  key={request.publicId}
                  href={`/admin/solicitudes/${request.publicId}`}
                  className="block rounded-2xl border border-navy/8 bg-white px-5 py-4 transition hover:border-navy/20"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[0.72rem] tracking-[0.14em] uppercase text-accent">
                        {request.publicId}
                      </p>
                      <h2 className="mt-1 font-display text-2xl text-navy">{request.name}</h2>
                      <p className="mt-1 text-sm text-mist">
                        {dictionary.form.serviceOptions[
                          request.service as keyof typeof dictionary.form.serviceOptions
                        ] ?? request.service}
                      </p>
                    </div>
                    <StatusPill status={request.status} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4 text-[0.72rem] tracking-[0.08em] uppercase text-mist">
                    <span>{formatPanamaDateTime(request.createdAt)}</span>
                    {request.photos.length ? (
                      <span>{request.photos.length} fotos</span>
                    ) : null}
                    {replied.has(request.publicId) ? <span>Respondida</span> : null}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </main>
    </>
  );
}
