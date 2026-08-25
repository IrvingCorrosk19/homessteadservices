"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminPhotos } from "@/components/admin/AdminPhotos";
import { ReplyComposer } from "@/components/admin/ReplyComposer";
import { StatusPill } from "@/components/admin/StatusPill";
import { StatusSelect } from "@/components/admin/StatusSelect";
import { formatPanamaDateTime, type RequestStatus } from "@/lib/admin-format";
import { safeReturnTo } from "@/lib/ops-navigation-state";
import type { RequestMessage, SavedServiceRequest } from "@/lib/service-requests";
import { useToast } from "@/components/ui/Toast";
function eventTitle(message: RequestMessage) {
  if (message.channel === "FORM") return "Solicitud recibida";
  if (message.channel === "TELEGRAM" && message.status === "SENT") {
    return "Notificación enviada a Telegram";
  }
  if (message.channel === "EMAIL" && message.status === "SENT") {
    return "Respuesta enviada por email";
  }
  if (message.channel === "EMAIL" && message.status === "FAILED") {
    return "El envío de email no se completó";
  }
  return message.subject;
}

export function RequestDetailClient({
  request,
  messages,
  serviceLabel,
  whatsappUrl,
  factRows = [],
  photoEvidenceByFile = {},
  slaFirstAlertedAt = null,
  slaEscalatedAt = null,
  returnTo,
}: {
  request: SavedServiceRequest;
  messages: RequestMessage[];
  serviceLabel: string;
  whatsappUrl: string | null;
  factRows?: Array<{ label: string; value: string }>;
  photoEvidenceByFile?: Record<string, { tone: "pass" | "retake" | "reject" | "pending"; title: string; detail: string }>;
  slaFirstAlertedAt?: string | null;
  slaEscalatedAt?: string | null;
  returnTo?: string;
}) {  const toast = useToast();
  const [status, setStatus] = useState<RequestStatus>(request.status);
  const [history, setHistory] = useState(messages);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);

  async function markAttended() {
    if (busy) return;
    const snapshot = status;
    setBusy(true);
    setStatus("CONTACTED");
    const response = await fetch(`/api/admin/service-requests/${request.publicId}/contacted`, {
      method: "POST",
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setStatus(snapshot);
      toast.push({
        kind: "error",
        title: "No pudimos marcar la solicitud",
        body: "Intenta de nuevo en un momento.",
      });
      return;
    }
    if (data.request?.status) setStatus(data.request.status);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 1800);
    toast.push({
      kind: "success",
      title: "✓ Solicitud atendida",
      body: data.already ? "Ya estaba registrada como atendida." : "Contacto humano registrado.",
    });
  }

  const canMark = status === "NEW" || status === "IN_PROGRESS";
  const backHref = safeReturnTo(returnTo);

  return (
    <>
    <main className="mx-auto w-[min(840px,calc(100%-1.5rem))] pb-28 py-8 md:pb-12 md:py-12">
      <Link
        href={backHref}
        className="text-[0.72rem] tracking-[0.14em] uppercase text-mist hover:text-navy"
      >
        ← Volver a solicitudes
      </Link>      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.72rem] tracking-[0.16em] uppercase text-accent">
            {request.publicId}
          </p>
          <h1 className="mt-2 font-display text-4xl text-navy">{request.name}</h1>
          <p className="mt-2 text-mist">{serviceLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={status} slaFirstAlertedAt={slaFirstAlertedAt} slaEscalatedAt={slaEscalatedAt} />
          <StatusSelect
            requestId={request.publicId}
            status={status}
            onChange={setStatus}
          />
        </div>
      </div>

      {canMark ? (
        <div className="mt-4 hidden flex-wrap gap-2 md:flex">
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
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl border border-navy/15 px-4 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy disabled:opacity-50"
            onClick={() => void markAttended()}
          >
            {busy ? "Guardando…" : "Marcar como atendida"}
          </button>
        </div>
      ) : null}      {flash ? (
        <p className="mt-3 text-sm text-navy-soft" role="status" aria-live="polite">
          ✓ Solicitud atendida
        </p>
      ) : null}

      <section className="mt-8 rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
        <p className="text-sm text-navy">📞 {request.phone}</p>
        <p className="mt-2 text-sm text-navy">✉️ {request.email}</p>
        <p className="mt-4 text-[0.72rem] uppercase tracking-[0.12em] text-mist">
          {formatPanamaDateTime(request.createdAt)}
        </p>
        {whatsappUrl ? (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-navy/10 px-4 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy"
          >
            WhatsApp
          </a>
        ) : null}
      </section>

      {factRows.length > 0 ? (
        <section className="mt-4 rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
          <p className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">Hechos del servicio</p>
          <dl className="mt-4 grid gap-3">
            {factRows.map((row) => (
              <div key={row.label}>
                <dt className="text-[0.72rem] uppercase tracking-[0.12em] text-mist">{row.label}</dt>
                <dd className="mt-1 text-navy">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="mt-4 rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
        <p className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">Mensaje</p>
        <p className="mt-4 whitespace-pre-wrap font-display text-xl leading-8 text-navy">
          {request.message}
        </p>
      </section>

      <div className="mt-4">
        <AdminPhotos
          requestId={request.publicId}
          files={request.photos.map((photo) => photo.storedAs)}
          evidenceByFile={photoEvidenceByFile}
        />
      </div>

      <div className="mt-4">
        <ReplyComposer
          requestId={request.publicId}
          customerEmail={request.email}
          defaultSubject={`Re: Solicitud ${request.publicId}`}
          onSent={(next) => {
            setStatus(next.status);
            setHistory((current) => [
              ...current,
              {
                id: Date.now(),
                publicId: request.publicId,
                direction: "OUTBOUND",
                channel: "EMAIL",
                subject: `Re: Solicitud ${request.publicId}`,
                body: next.body,
                status: "SENT",
                sentAt: next.updatedAt,
                createdAt: next.updatedAt,
              },
            ]);
          }}
        />
      </div>

      <section className="mt-4 rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
        <p className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">Historial</p>
        <ol className="mt-6 space-y-5">
          {history.map((item) => (
            <li key={item.id} className="border-l border-navy/10 pl-4">
              <p className="text-sm text-navy">{eventTitle(item)}</p>
              <p className="mt-1 text-[0.72rem] uppercase tracking-[0.1em] text-mist">
                {formatPanamaDateTime(item.sentAt || item.createdAt)}
              </p>
              {item.channel === "EMAIL" && item.status === "SENT" && item.body ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-mist">
                  {item.body}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </main>

    {canMark ? (
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 border-t border-navy/10 bg-cream/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-lg gap-2">
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="min-h-11 flex-1 rounded-xl bg-navy px-4 py-3 text-center text-[0.72rem] tracking-[0.14em] uppercase text-cream"
            >
              Contactar
            </a>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="min-h-11 flex-1 rounded-xl border border-navy/15 px-4 py-3 text-[0.72rem] tracking-[0.14em] uppercase text-navy disabled:opacity-50"
            onClick={() => void markAttended()}
          >
            {busy ? "Guardando…" : "Atendida"}
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}