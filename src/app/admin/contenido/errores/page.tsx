import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { ControlDisplayPill } from "@/components/admin/control/ControlDisplayPill";
import { ControlSubnav } from "@/components/admin/control/ControlSubnav";
import { listControlErrors } from "@/lib/control-service";

export const dynamic = "force-dynamic";

export default function ControlErrorsPage() {
  const jobs = listControlErrors();
  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1120px,calc(100%-1.5rem))] py-8 md:w-[min(1120px,calc(100%-4rem))]">
        <h1 className="font-display text-4xl text-navy">Centro de errores</h1>
        <ControlSubnav current="/admin/contenido/errores" />
        <ul className="mt-6 space-y-3">
          {jobs.map((job) => (
            <li key={job.publicId} className="rounded-2xl border border-navy/8 bg-white px-4 py-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <Link href={`/admin/contenido/${job.publicId}`} className="font-medium text-navy underline">
                    {job.publicId}
                  </Link>
                  <p className="mt-1 text-sm text-rose-900">{job.lastErrorLabel || "Revisar redes"}</p>
                  <p className="text-xs uppercase tracking-[0.08em] text-mist">
                    {job.failureKind === "partial"
                      ? "Publicación parcial"
                      : job.failureKind === "uncertain"
                        ? "Resultado incierto"
                        : "Fallo definitivo"}
                  </p>
                  <p className="text-xs text-mist">{job.actionHint}</p>
                </div>
                <ControlDisplayPill state={job.displayState} />
              </div>
            </li>
          ))}
        </ul>
        {!jobs.length ? <p className="mt-8 text-sm text-mist">No hay fallos registrados en esta base.</p> : null}
      </main>
    </>
  );
}
