import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { Customer360OpsSummary } from "@/components/admin/Customer360OpsSummary";
import { TimelineRequestStatus } from "@/components/admin/TimelineRequestStatus";
import { formatPanamaDate, formatPanamaDateTime } from "@/lib/admin-format";
import { getCustomer360 } from "@/lib/customer-360";
import { customerWhatsAppUrl } from "@/lib/service-requests";

export const dynamic = "force-dynamic";

export default async function ClientePage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  if (!/^\d+$/.test(customerId)) notFound();
  const customer = getCustomer360(Number(customerId));
  if (!customer) notFound();
  const wa = customerWhatsAppUrl(customer.phone);

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(900px,calc(100%-1.5rem))] py-8 md:w-[min(900px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.72rem] tracking-[0.18em] uppercase text-accent">Customer 360</p>
        <h1 className="mt-2 font-display text-4xl text-navy">{customer.name || "Cliente Homestead"}</h1>
        {customer.isTest ? (
          <p className="mt-2 text-sm text-accent-deep">Registro de prueba. No es un cliente real.</p>
        ) : null}
        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-mist">
          {customer.segment}
          {customer.isRepeat ? " · REPEAT" : ""} · desde {formatPanamaDate(customer.createdAt)}
        </p>

        <Customer360OpsSummary customer={customer} whatsappUrl={wa} />

        <section className="mt-8 rounded-3xl bg-white p-6">
          <p className="text-navy">{customer.phone || "Sin teléfono"}</p>
          <p className="mt-1 text-mist">{customer.email || "Sin email"}</p>
          {customer.location ? <p className="mt-1 text-mist">{customer.location}</p> : null}
          <dl className="mt-6 grid grid-cols-2 gap-3 text-center md:grid-cols-4">
            <div>
              <dt className="text-[0.65rem] tracking-[0.14em] uppercase text-mist">Solicitudes</dt>
              <dd className="mt-1 font-display text-3xl text-navy">{customer.requests}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] tracking-[0.14em] uppercase text-mist">Citas</dt>
              <dd className="mt-1 font-display text-3xl text-navy">{customer.appointments}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] tracking-[0.14em] uppercase text-mist">Trabajos</dt>
              <dd className="mt-1 font-display text-3xl text-navy">{customer.jobsCompleted}</dd>
            </div>
            <div>
              <dt className="text-[0.65rem] tracking-[0.14em] uppercase text-mist">Recovery</dt>
              <dd className="mt-1 font-display text-3xl text-navy">{customer.recoveryOpen}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-navy">
            Último servicio:{" "}
            {customer.lastService
              ? `${customer.lastService.service} · ${formatPanamaDate(customer.lastService.completedAt)}`
              : "Aún no hay un trabajo completado"}
          </p>
          <p className="mt-2 text-sm text-mist">
            Satisfacción: {customer.satisfaction || "Sin respuesta todavía"}
          </p>
          <p className="mt-4 text-xs text-mist">
            First touch: {customer.attribution.firstTouch} · Last touch: {customer.attribution.lastTouch}
            {customer.attribution.retentionHint ? ` · ${customer.attribution.retentionHint}` : ""}
            {customer.attribution.contentId ? ` · content ${customer.attribution.contentId}` : ""}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-mist">
            {customer.marketingOptIn
              ? "Aceptó marketing"
              : "Sin permiso de marketing. El seguimiento de servicio no es una campaña."}
          </p>
        </section>

        {customer.possibleDuplicates.length ? (
          <section className="mt-6 rounded-2xl border border-accent/40 bg-white px-5 py-4">
            <p className="text-[0.68rem] tracking-[0.14em] uppercase text-accent">Posibles duplicados</p>
            <p className="mt-1 text-sm text-mist">Sin auto-merge. Solo detección.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {customer.possibleDuplicates.map((dup) => (
                <li key={dup.id}>
                  <Link href={`/admin/clientes/${dup.id}`} className="text-navy">
                    #{dup.id} · {dup.name} · {dup.match}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {wa ? (
            <a href={wa} className="rounded-full bg-navy px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream">
              Contactar
            </a>
          ) : null}
          <Link
            href="/admin/clientes"
            className="rounded-full border border-navy/20 px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy"
          >
            Volver a lista
          </Link>
        </div>

        <h2 className="mt-10 font-display text-2xl text-navy">Timeline</h2>
        <ul className="mt-4 space-y-3">
          {customer.timeline.map((item) => (
            <li key={`${item.type}-${item.entityId}-${item.at}`} className="rounded-2xl bg-white px-5 py-4">
              <p className="text-[0.65rem] tracking-[0.14em] uppercase text-mist">
                {formatPanamaDateTime(item.at)} · {item.type}
              </p>
              {item.entityType === "JOB" ? (
                <Link href={`/admin/trabajos/${item.entityId}`} className="mt-1 block text-navy">
                  {item.entityId} · {item.label}
                  {item.status ? ` · ${item.status}` : ""}
                </Link>
              ) : item.entityType === "HS" ? (
                <TimelineRequestStatus
                  status={item.status}
                  entityId={item.entityId}
                  label={item.label}
                  href={`/admin/solicitudes/${item.entityId}`}
                />
              ) : (
                <p className="mt-1 text-navy">
                  {item.entityId} · {item.label}
                  {item.status ? ` · ${item.status}` : ""}
                </p>
              )}
            </li>
          ))}
          {!customer.timeline.length ? (
            <li className="text-sm text-mist">Sin eventos todavía.</li>
          ) : null}
        </ul>
      </main>
    </>
  );
}
