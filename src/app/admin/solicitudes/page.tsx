import Link from "next/link";
import { Suspense } from "react";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { SolicitudesOperationsClient } from "@/components/admin/SolicitudesOperationsClient";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  REQUEST_STATUSES,
  STATUS_LABELS,
  isRequestStatus,
  type RequestStatus,
} from "@/lib/admin-format";
import { opsStatusLabel } from "@/lib/request-status-visual";
import {
  countRequestsByStatus,
  listServiceRequestsForOps,
  repliedPublicIds,
} from "@/lib/service-requests";
import { formServices } from "@/lib/site";
import { getDictionary } from "@/i18n/get-dictionary";
import type { OpsFilter } from "@/lib/request-status-visual";

export const dynamic = "force-dynamic";

function resolveOpsFilter(raw?: string): OpsFilter {
  if (raw === "ALL" || raw === "NEEDS_ATTENTION" || raw === "IN_PROGRESS" || raw === "ATTENDED" || raw === "CLOSED") {
    return raw;
  }
  if (isRequestStatus(raw || "") && raw === "NEW") return "NEEDS_ATTENTION";
  if (raw === "CONTACTED") return "ATTENDED";
  return "NEEDS_ATTENTION";
}

export default async function SolicitudesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; service?: string; date?: string; ops?: string }>;
}) {
  const params = await searchParams;
  const legacyStatus = isRequestStatus(params.status ?? "") ? params.status : "ALL";
  const service = formServices.includes(params.service as (typeof formServices)[number])
    ? params.service
    : "";
  const q = params.q?.trim() ?? "";
  const date = params.date?.trim() ?? "";
  const counts = countRequestsByStatus();
  const from = date ? `${date}T00:00:00.000Z` : undefined;
  const to = date ? `${date}T23:59:59.999Z` : undefined;
  const requests = listServiceRequestsForOps({
    q,
    status: legacyStatus as RequestStatus | "ALL",
    service: service || undefined,
    from,
    to,
  });
  const replied = repliedPublicIds();
  const dictionary = getDictionary();
  const initialFilter = resolveOpsFilter(params.ops || params.status);

  const opsRows = requests.map((request) => ({
    publicId: request.publicId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    status: request.status,
    name: request.name,
    service: request.service,
    serviceLabel:
      dictionary.form.serviceOptions[request.service as keyof typeof dictionary.form.serviceOptions] ??
      request.service,
    phone: request.phone,
    photoCount: request.photos.length,
    replied: replied.has(request.publicId),
    slaFirstAlertedAt: request.slaFirstAlertedAt,
    slaEscalatedAt: request.slaEscalatedAt,
  }));

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))] md:py-12">
        <div className="mb-6">
          <p className="text-[0.68rem] tracking-[0.18em] uppercase text-accent">Centro de operaciones</p>
          <h1 className="mt-1 font-display text-3xl text-navy md:text-4xl">Solicitudes</h1>
          <p className="mt-2 max-w-2xl text-sm text-mist">
            Prioriza lo que necesita atención. Atendida = contacto humano registrado (estado real CONTACTED).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {REQUEST_STATUSES.filter((item) => item !== "CANCELLED").map((item) => (
            <Link
              key={item}
              href={`/admin/solicitudes?ops=${item === "NEW" ? "NEEDS_ATTENTION" : item === "CONTACTED" ? "ATTENDED" : item === "IN_PROGRESS" ? "IN_PROGRESS" : "ALL"}&status=${item}`}
              className="rounded-2xl border border-navy/8 bg-white px-4 py-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">
                  {item === "CONTACTED" ? opsStatusLabel(item) : STATUS_LABELS[item]}
                </p>
                <StatusPill status={item} compact />
              </div>
              <p className="mt-2 font-display text-3xl text-navy">{counts[item]}</p>
            </Link>
          ))}
        </div>

        <form className="mt-8 grid gap-3 md:grid-cols-[1fr_160px_180px_160px_auto]" action="/admin/solicitudes">
          <input type="hidden" name="ops" value={initialFilter} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar folio, nombre, email o teléfono"
            className="min-h-11 rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <select
            name="status"
            defaultValue={legacyStatus}
            className="min-h-11 rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm"
          >
            <option value="ALL">Todos los estados</option>
            {REQUEST_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item === "CONTACTED" ? opsStatusLabel(item) : STATUS_LABELS[item]}
              </option>
            ))}
          </select>
          <select
            name="service"
            defaultValue={service}
            className="min-h-11 rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm"
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
            className="min-h-11 rounded-xl border border-navy/10 bg-white px-3 py-3 text-sm"
          />
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-navy px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream"
          >
            Filtrar
          </button>
        </form>

        <div className="mt-8">
          <Suspense fallback={<p className="text-sm text-mist">Cargando solicitudes…</p>}>
            <SolicitudesOperationsClient
              initialRequests={opsRows}
              statusCounts={counts}
              initialFilter={initialFilter}
            />
          </Suspense>
        </div>
      </main>
    </>
  );
}
