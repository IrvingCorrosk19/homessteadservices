import Link from "next/link";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { JOB_STATUS_LABELS, listAdminJobs } from "@/lib/job-store";
import { formatPanamaDateTime } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

export default async function TrabajosPage() {
  const jobs = listAdminJobs({ includeTest: false, limit: 80 });
  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1200px,calc(100%-1.5rem))] py-8 md:w-[min(1200px,calc(100%-4rem))] md:py-12">
        <p className="text-[0.72rem] tracking-[0.18em] uppercase text-accent">Operación</p>
        <h1 className="mt-2 font-display text-4xl text-navy">Trabajos</h1>
        <p className="mt-3 max-w-2xl text-mist">
          Una cita programada no es un trabajo terminado. Completa el trabajo cuando realmente se haya realizado.
        </p>
        <ul className="mt-10 space-y-4">
          {jobs.length === 0 ? (
            <li className="rounded-3xl bg-white p-6 text-mist">No hay trabajos registrados.</li>
          ) : (
            jobs.map((job) => (
              <li key={job.jobId}>
                <Link
                  href={`/admin/trabajos/${job.jobId}`}
                  className="block rounded-3xl bg-white p-5 shadow-[0_12px_40px_rgba(31,51,68,0.06)] transition hover:-translate-y-0.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[0.72rem] tracking-[0.16em] uppercase text-accent">{job.jobNumber}</p>
                    <span className="rounded-full bg-navy/8 px-3 py-1 text-[0.68rem] tracking-[0.12em] uppercase text-navy">
                      {JOB_STATUS_LABELS[job.status]}
                    </span>
                  </div>
                  <p className="mt-3 font-display text-2xl text-navy">{job.serviceLabel}</p>
                  <p className="mt-2 text-sm text-mist">
                    {job.customerName} {job.zone ? `· ${job.zone}` : ""} · {formatPanamaDateTime(job.createdAt)}
                  </p>
                </Link>
              </li>
            ))
          )}
        </ul>
      </main>
    </>
  );
}
