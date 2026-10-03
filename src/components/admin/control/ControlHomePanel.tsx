import Link from "next/link";
import { controlHomeSummary } from "@/lib/control-service";
import { ControlDisplayPill } from "@/components/admin/control/ControlDisplayPill";
import { ControlIsolatedBanner } from "@/components/admin/control/ControlIsolatedBanner";
import { ControlInstallHelp } from "@/components/admin/control/ControlInstallHelp";
import { ControlStudioPause } from "@/components/admin/control/ControlStudioPause";

export function ControlHomePanel() {
  const summary = controlHomeSummary();
  return (
    <section className="mt-8 rounded-[28px] border border-navy/8 bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.68rem] tracking-[0.14em] uppercase text-accent">Homestead Control</p>
          <h2 className="mt-1 font-display text-2xl text-navy">Contenido y publicación</h2>
        </div>
        <Link href="/admin/contenido" className="text-sm text-navy underline">
          Abrir cola
        </Link>
      </div>
      <ControlIsolatedBanner />
      <ControlInstallHelp />
      <div className="mt-4">
        <ControlStudioPause paused={summary.settings.paused} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {[
          { label: "Por aprobar", value: summary.counts.pendingApproval, href: "/admin/contenido?state=pending_approval" },
          { label: "Aprobado sin programar", value: summary.counts.approvedUnscheduled, href: "/admin/contenido?state=approved_unscheduled" },
          { label: "Próximas publicaciones", value: summary.counts.scheduled, href: "/admin/contenido?state=scheduled" },
          { label: "Publicado parcialmente", value: summary.counts.partial, href: "/admin/contenido?state=partially_published" },
          { label: "Necesita revisión", value: summary.counts.needsReview, href: "/admin/contenido?state=needs_review" },
          { label: "Lotes en proceso", value: summary.counts.processingBatches, href: "/admin/contenido/lotes" },
        ].map((item) => (
          <Link key={item.label} href={item.href} className="min-w-0 rounded-2xl border border-navy/8 px-3 py-3">
            <p className="text-[0.62rem] tracking-[0.08em] uppercase text-mist">{item.label}</p>
            <p className="mt-1 font-display text-2xl text-navy">{item.value}</p>
          </Link>
        ))}
      </div>
      {summary.upcoming.length ? (
        <div className="mt-5">
          <p className="text-[0.68rem] uppercase tracking-[0.12em] text-mist">Próximas</p>
          <div className="mt-2 space-y-2">
            {summary.upcoming.map((job) => (
              <Link
                key={job.publicId}
                href={`/admin/contenido/${job.publicId}`}
                className="flex flex-col gap-1 rounded-2xl border border-navy/8 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <span className="font-medium text-navy">{job.publicId}</span>
                <span className="text-sm text-mist">{job.recommendedPublishLabel}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-5 space-y-2">
        {summary.priority.map((job) => (
          <Link
            key={job.publicId}
            href={`/admin/contenido/${job.publicId}`}
            className="flex flex-col gap-2 rounded-2xl border border-navy/8 px-4 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <p className="font-medium text-navy">{job.publicId}</p>
              <p className="text-sm text-mist">{job.recommendedPublishLabel || "Sin horario"}</p>
            </div>
            <ControlDisplayPill state={job.displayState} />
          </Link>
        ))}
        {!summary.priority.length ? (
          <p className="text-sm text-mist">No hay piezas de contenido que requieran acción ahora.</p>
        ) : null}
      </div>
    </section>
  );
}
