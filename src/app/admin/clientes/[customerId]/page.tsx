import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { getCustomer360 } from "@/lib/customer-360";
import { formatPanamaDate } from "@/lib/admin-format";
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
        <p className="text-[0.72rem] tracking-[0.18em] uppercase text-accent">Cliente</p>
        <h1 className="mt-2 font-display text-4xl text-navy">{customer.name || "Cliente Homestead"}</h1>
        {customer.isTest ? <p className="mt-2 text-sm text-accent-deep">Registro de prueba. No es un cliente real.</p> : null}
        <section className="mt-8 rounded-3xl bg-white p-6">
          <p className="text-navy">{customer.phone || "Sin teléfono"}</p>
          <p className="mt-1 text-mist">{customer.email || "Sin email"}</p>
          {customer.location ? <p className="mt-1 text-mist">{customer.location}</p> : null}
          <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
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
          <p className="mt-4 text-xs uppercase tracking-[0.14em] text-mist">
            {customer.marketingOptIn ? "Aceptó marketing" : "Sin permiso de marketing. El seguimiento de servicio no es una campaña."}
          </p>
        </section>
        <div className="mt-6 flex flex-wrap gap-3">
          {wa ? (
            <a href={wa} className="rounded-full bg-navy px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream">
              Contactar
            </a>
          ) : null}
        </div>
        <h2 className="mt-10 font-display text-2xl text-navy">Historial</h2>
        <ul className="mt-4 space-y-3">
          {customer.history.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="rounded-2xl bg-white px-5 py-4">
              {item.kind === "job" ? (
                <Link href={`/admin/trabajos/${item.id}`} className="text-navy">
                  {item.id} · {item.label} · {item.status}
                </Link>
              ) : item.kind === "request" ? (
                <Link href={`/admin/solicitudes/${item.id}`} className="text-navy">
                  {item.id} · {item.label} · {item.status}
                </Link>
              ) : (
                <span className="text-navy">
                  {item.id} · {item.label} · {item.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
