import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { NeedsAttentionBlock } from "@/components/admin/NeedsAttentionBlock";
import { AutonomousAlertsPanel } from "@/components/admin/AutonomousAlertsPanel";
import {
  getExecutiveSummary,
  resolveAnalyticsRange,
  type AnalyticsRangeKey,
} from "@/lib/analytics-service";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const key = (["today", "7d", "30d", "month", "custom"].includes(params.range || "")
    ? params.range
    : "30d") as AnalyticsRangeKey;
  const range = resolveAnalyticsRange(key, params.from, params.to);
  const summary = getExecutiveSummary(range, false);
  const attentionTop = summary.attention.slice(0, 6);

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.68rem] tracking-[0.14em] uppercase text-accent">Centro de operaciones</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Inicio operativo</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-charcoal/75">
          Qué necesita tu atención ahora. Zona horaria {summary.timezone}. {range.label}.
        </p>

        <section className="mt-8">
          <NeedsAttentionBlock items={attentionTop} />
        </section>

        <AutonomousAlertsPanel />

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Pendientes", value: summary.operational.pendingRequests, href: "/admin/solicitudes?ops=NEEDS_ATTENTION" },
            { label: "Citas hoy", value: summary.operational.appointmentsToday, href: "/admin/citas" },
            { label: "Recovery", value: summary.operational.serviceRecovery, href: "/admin/retencion" },
            { label: "Rescue", value: summary.operational.rescue, href: "/admin/solicitudes?ops=NEEDS_ATTENTION" },
          ].map((item) => (
            <Link key={item.label} href={item.href} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{item.label}</p>
              <p className="mt-2 font-display text-3xl text-navy">{item.value}</p>
            </Link>
          ))}
        </section>

        <form className="mt-8 flex flex-wrap gap-2" action="/admin">
          {[
            ["today", "Hoy"],
            ["7d", "7 días"],
            ["30d", "30 días"],
            ["month", "Mes"],
          ].map(([value, label]) => (
            <button
              key={value}
              name="range"
              value={value}
              className={`min-h-11 rounded-full px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase ${
                key === value ? "bg-navy text-cream" : "border border-navy/15 bg-white text-navy"
              }`}
            >
              {label}
            </button>
          ))}
        </form>

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Leads", value: summary.funnel.leads, href: "/admin/solicitudes" },
            { label: "Solicitudes HS", value: summary.funnel.hs, href: "/admin/solicitudes" },
            { label: "Citas HA", value: summary.funnel.ha, href: "/admin/citas" },
            { label: "Trabajos", value: summary.funnel.jobs, href: "/admin/trabajos" },
            { label: "Completados", value: summary.funnel.completed, href: "/admin/trabajos" },
            { label: "Repeat customers", value: summary.retention.repeatCustomers, href: "/admin/clientes?segment=REPEAT" },
          ].map((item) => (
            <Link key={item.label} href={item.href} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{item.label}</p>
              <p className="mt-2 font-display text-3xl text-navy">{item.value}</p>
            </Link>
          ))}
        </section>

        <section className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl text-navy">Embudo</h2>
            <p className="mt-1 text-sm text-mist">Primera etapa confiable: LEAD. Sin visitantes inventados.</p>
            <ul className="mt-4 space-y-2 text-sm text-charcoal/80">
              <li>Lead → HS: {summary.funnel.leadToHs === null ? "—" : `${summary.funnel.leadToHs}%`}</li>
              <li>HS → HA: {summary.funnel.hsToHa === null ? "—" : `${summary.funnel.hsToHa}%`}</li>
              <li>HA → Job: {summary.funnel.haToJob === null ? "—" : `${summary.funnel.haToJob}%`}</li>
              <li>Job → Completed: {summary.funnel.jobToCompleted === null ? "—" : `${summary.funnel.jobToCompleted}%`}</li>
            </ul>
            <p className="mt-4 text-xs text-mist">Revenue monetario: NO DISPONIBLE (sin pagos confiables).</p>
          </div>
          <div>
            <h2 className="font-display text-2xl text-navy">Más atención</h2>
            <div className="mt-4 space-y-3">
              {summary.attention.slice(6).map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-2xl border border-navy/8 bg-white px-4 py-3"
                >
                  <p className="text-[0.65rem] tracking-[0.14em] uppercase text-mist">{item.kind}</p>
                  <p className="mt-1 text-navy">{item.title}</p>
                </Link>
              ))}
              {summary.attention.length <= 6 ? (
                <p className="text-sm text-mist">Todo lo prioritario está arriba.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-navy">Servicios</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[0.65rem] uppercase tracking-[0.12em] text-mist">
                <tr>
                  <th className="py-2">Servicio</th>
                  <th>HS</th>
                  <th>HA</th>
                  <th>Jobs</th>
                  <th>Done</th>
                </tr>
              </thead>
              <tbody>
                {summary.services.map((row) => (
                  <tr key={row.service} className="border-t border-navy/8">
                    <td className="py-3 text-navy">{row.label}</td>
                    <td>{row.requests}</td>
                    <td>{row.appointments}</td>
                    <td>{row.jobs}</td>
                    <td>{row.completed}</td>
                  </tr>
                ))}
                {!summary.services.length ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-mist">
                      No hay solicitudes en este período.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
