"use client";

import { useState } from "react";
import Link from "next/link";
import { JOB_STATUS_LABELS, SATISFACTION_LABELS, type JobStatus, type SatisfactionResponse } from "@/lib/job-config";
import { formatPanamaDateTime } from "@/lib/admin-format";

type JobView = {
  jobId: string;
  jobNumber: string;
  leadId: string;
  customerId: number;
  customerName: string;
  phone: string;
  email: string;
  appointmentId: string;
  serviceLabel: string;
  zone: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  satisfactionResponse: string;
  recoveryStatus: string;
  photoCount: number;
  marketingUsageApproved: boolean;
  sourceContentId: string;
  recommendedNextServiceAt: string | null;
  followupStatus: string;
  reviewRequestedAt: string | null;
};

export function JobDetailClient({
  job,
  whatsappUrl,
}: {
  job: JobView;
  whatsappUrl: string | null;
}) {
  const [status, setStatus] = useState(job.status);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: string) {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/admin/jobs/${job.jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; status?: JobStatus; error?: string };
    setBusy(false);
    setConfirm(false);
    if (data.ok && data.status) setStatus(data.status);
    setMessage(data.ok ? "Actualizado." : "No pudimos actualizarlo.");
  }

  return (
    <main className="mx-auto w-[min(900px,calc(100%-1.5rem))] py-8 md:w-[min(900px,calc(100%-4rem))] md:py-12">
      <Link href="/admin/trabajos" className="text-[0.72rem] tracking-[0.14em] uppercase text-mist hover:text-navy">
        ← Trabajos
      </Link>
      <p className="mt-6 text-[0.72rem] tracking-[0.18em] uppercase text-accent">{job.jobNumber}</p>
      <h1 className="mt-2 font-display text-4xl text-navy">{job.serviceLabel}</h1>
      <p className="mt-3 text-mist">
        {job.customerName}
        {job.zone ? ` · ${job.zone}` : ""}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="rounded-full bg-navy/10 px-3 py-1 text-[0.68rem] tracking-[0.12em] uppercase text-navy">
          {JOB_STATUS_LABELS[status]}
        </span>
        {job.recoveryStatus === "OPEN" ? (
          <span className="rounded-full bg-accent/15 px-3 py-1 text-[0.68rem] tracking-[0.12em] uppercase text-accent-deep">
            Cliente necesita atención
          </span>
        ) : null}
      </div>
      <section className="mt-8 rounded-3xl bg-white p-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Teléfono</dt>
            <dd className="mt-1 text-navy">{job.phone || "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Email</dt>
            <dd className="mt-1 text-navy">{job.email || "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Solicitud</dt>
            <dd className="mt-1 text-navy">{job.leadId || "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Cita</dt>
            <dd className="mt-1 text-navy">{job.appointmentId || "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Creado</dt>
            <dd className="mt-1 text-navy">{formatPanamaDateTime(job.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Completado</dt>
            <dd className="mt-1 text-navy">{job.completedAt ? formatPanamaDateTime(job.completedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Satisfacción</dt>
            <dd className="mt-1 text-navy">
              {job.satisfactionResponse
                ? SATISFACTION_LABELS[job.satisfactionResponse as SatisfactionResponse] || job.satisfactionResponse
                : "Pendiente"}
            </dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Fotos del trabajo</dt>
            <dd className="mt-1 text-navy">{job.photoCount}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Seguimiento</dt>
            <dd className="mt-1 text-navy">{job.followupStatus || "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">Próximo mantenimiento</dt>
            <dd className="mt-1 text-navy">
              {job.recommendedNextServiceAt ? formatPanamaDateTime(job.recommendedNextServiceAt) : "Sin regla"}
            </dd>
          </div>
        </dl>
        <p className="mt-6 text-sm text-mist">
          {job.marketingUsageApproved
            ? "Uso de fotos para marketing autorizado por un administrador. No hay publicación automática."
            : "Las fotos del trabajo no están autorizadas para marketing hasta que un administrador lo confirme."}
        </p>
        {job.sourceContentId ? <p className="mt-2 text-sm text-navy">Contenido: {job.sourceContentId}</p> : null}
      </section>
      <div className="mt-6 flex flex-wrap gap-3">
        {whatsappUrl ? (
          <a href={whatsappUrl} className="rounded-full bg-navy px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream">
            WhatsApp
          </a>
        ) : null}
        <Link
          href={`/admin/clientes/${job.customerId}`}
          className="rounded-full border border-navy/15 px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy"
        >
          Historial del cliente
        </Link>
        {job.leadId.startsWith("HS-") ? (
          <Link
            href={`/admin/solicitudes/${job.leadId}`}
            className="rounded-full border border-navy/15 px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy"
          >
            Solicitud
          </Link>
        ) : null}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        {status === "SCHEDULED" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("start")}
            className="rounded-full bg-navy px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream disabled:opacity-50"
          >
            Iniciar trabajo
          </button>
        ) : null}
        {status === "SCHEDULED" || status === "IN_PROGRESS" ? (
          confirm ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("complete")}
                className="rounded-full bg-accent px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream disabled:opacity-50"
              >
                Sí, completar
              </button>
              <button type="button" onClick={() => setConfirm(false)} className="rounded-full px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-mist">
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="rounded-full bg-accent px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-cream"
            >
              Completar trabajo
            </button>
          )
        ) : null}
        {job.recoveryStatus === "OPEN" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("recovery_contacted")}
            className="rounded-full border border-accent/40 px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-accent-deep disabled:opacity-50"
          >
            Recuperación atendida
          </button>
        ) : null}
        {!job.marketingUsageApproved && job.photoCount > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("approve_marketing")}
            className="rounded-full border border-navy/15 px-5 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy disabled:opacity-50"
          >
            Autorizar fotos
          </button>
        ) : null}
      </div>
      {confirm ? <p className="mt-4 text-sm text-navy">¿Confirmas que el trabajo fue realizado?</p> : null}
      {message ? <p className="mt-4 text-sm text-mist">{message}</p> : null}
    </main>
  );
}
