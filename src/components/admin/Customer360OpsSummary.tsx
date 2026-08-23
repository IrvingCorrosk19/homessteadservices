import Link from "next/link";
import { StatusPill } from "@/components/admin/StatusPill";
import type { Customer360 } from "@/lib/customer-360";
import { isRequestStatus } from "@/lib/admin-format";

type Customer360OpsSummaryProps = {
  customer: Customer360;
  whatsappUrl: string | null;
};

export function Customer360OpsSummary({ customer, whatsappUrl }: Customer360OpsSummaryProps) {
  const pendingRequests = customer.history.filter((item) => item.kind === "request" && item.status === "NEW");
  const nextAppointment = customer.timeline.find(
    (item) =>
      item.entityType === "HA" &&
      item.status &&
      !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(item.status),
  );

  return (
    <section className="mt-6 rounded-3xl border border-navy/10 bg-white p-5 md:p-6">
      <p className="text-[0.68rem] tracking-[0.16em] uppercase text-accent">Resumen operativo</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-cream-deep/50 px-4 py-4">
          <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">Qué necesita</p>
          <p className="mt-2 font-display text-2xl text-navy">
            {pendingRequests.length ? `${pendingRequests.length} solicitud(es) pendiente(s)` : "Sin pendientes"}
          </p>
          {pendingRequests[0] ? (
            <Link href={`/admin/solicitudes/${pendingRequests[0].id}`} className="mt-2 inline-block text-sm text-accent">
              Abrir {pendingRequests[0].id} →
            </Link>
          ) : null}
        </div>
        <div className="rounded-2xl bg-cream-deep/50 px-4 py-4">
          <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">Próxima cita</p>
          <p className="mt-2 font-display text-xl text-navy">
            {nextAppointment ? nextAppointment.label : "Sin cita programada"}
          </p>
          {nextAppointment ? (
            <Link href={`/admin/citas?id=${encodeURIComponent(nextAppointment.entityId)}`} className="mt-2 inline-block text-sm text-accent">
              Ver cita →
            </Link>
          ) : null}
        </div>
        <div className="rounded-2xl bg-cream-deep/50 px-4 py-4">
          <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">Recovery</p>
          <p className="mt-2 font-display text-2xl text-navy">{customer.recoveryOpen ? `${customer.recoveryOpen} abierto(s)` : "Al día"}</p>
        </div>
      </div>

      {pendingRequests.length ? (
        <ul className="mt-4 space-y-2">
          {pendingRequests.slice(0, 3).map((item) =>
            isRequestStatus(item.status) ? (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy/8 px-3 py-2">
                <Link href={`/admin/solicitudes/${item.id}`} className="text-sm text-navy">
                  {item.id} · {item.label}
                </Link>
                <StatusPill status={item.status} compact />
              </li>
            ) : null,
          )}
        </ul>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="min-h-11 rounded-xl bg-navy px-4 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream"
          >
            Contactar
          </a>
        ) : null}
        <Link
          href={`/admin/solicitudes?q=${encodeURIComponent(customer.phone || customer.name)}`}
          className="min-h-11 rounded-xl border border-navy/15 px-4 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy"
        >
          Ver solicitudes
        </Link>
        <Link
          href={`/admin/citas${nextAppointment ? `?id=${encodeURIComponent(nextAppointment.entityId)}` : ""}`}
          className="min-h-11 rounded-xl border border-navy/15 px-4 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy"
        >
          Ver citas
        </Link>
      </div>
    </section>
  );
}
