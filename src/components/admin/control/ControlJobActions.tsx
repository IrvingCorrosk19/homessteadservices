"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Preview = {
  publicId: string;
  version: number;
  copy: string;
  platforms: string[];
  dryRun: boolean;
  liveEffect: string;
  pendingPlatforms: string[];
  alreadyPublished: Array<{ platform: string }>;
  cadenceNote: string;
};

type Actions = {
  approve: boolean;
  approveAndSchedule: boolean;
  reschedule: boolean;
  reject: boolean;
  publishNow: boolean;
  retryPlatform: boolean;
  retryBlockedByUncertain: boolean;
};

export function ControlJobActions(props: {
  publicId: string;
  version: number;
  displayState: string;
  paused: boolean;
  actions: Actions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function csrf() {
    const session = await fetch("/api/admin/control/session", { cache: "no-store" });
    const json = (await session.json()) as { csrf?: string };
    return json.csrf || "";
  }

  async function run(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(action);
    setError("");
    try {
      const token = await csrf();
      const key = `${action}:${props.publicId}:${props.version}`;
      const response = await fetch(`/api/admin/content/jobs/${props.publicId}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
          "Idempotency-Key": extra.idempotencyKey ? String(extra.idempotencyKey) : key,
        },
        body: JSON.stringify({
          action,
          version: props.version,
          confirm: extra.confirm === true,
          idempotencyKey: extra.idempotencyKey || key,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!json.ok) {
        setError(
          json.error === "stale_version"
            ? "La versión ya no es la vigente. Recarga la pieza."
            : json.error === "not_scheduled"
              ? "Solo se reprograma una pieza que ya está programada."
              : json.error === "uncertain_pending"
                ? "Hay un resultado incierto. Concílialo antes de reintentar."
                : json.error === "idempotency_conflict"
                  ? "Esa clave ya se usó con otra acción."
                  : json.error === "csrf"
                    ? "La sesión expiró. Recarga e inténtalo otra vez."
                    : json.error || "No se pudo completar la acción.",
        );
        return;
      }
      setPreview(null);
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function openPublish(action: "publish_now" | "retry_platform") {
    const response = await fetch(`/api/admin/content/jobs/${props.publicId}/preview`, { cache: "no-store" });
    const json = (await response.json()) as Preview & { ok?: boolean };
    if (!json.ok) {
      setError("No pude preparar la confirmación.");
      return;
    }
    setPreview({ ...json, cadenceNote: `${json.cadenceNote} Acción: ${action === "retry_platform" ? "reintentar pendiente" : "publicar ahora"}.` });
  }

  const disabled = Boolean(busy) || props.paused;

  return (
    <div className="space-y-3">
      {props.paused ? (
        <p className="rounded-2xl border border-rose-800/20 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          El estudio está en pausa. No se aprueba ni se publica hasta reanudar.
        </p>
      ) : null}
      {props.actions.retryBlockedByUncertain ? (
        <p className="rounded-2xl border border-amber-800/20 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Una red quedó con resultado incierto. No se republica a ciegas.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {props.actions.approve ? (
          <button type="button" disabled={disabled} onClick={() => void run("approve")} className="min-h-11 rounded-full bg-navy px-4 text-sm text-cream disabled:opacity-50">
            {busy === "approve" ? "Aprobando…" : "Aprobar"}
          </button>
        ) : null}
        {props.actions.approveAndSchedule ? (
          <button type="button" disabled={disabled} onClick={() => void run("approve_and_schedule")} className="min-h-11 rounded-full border border-navy/15 bg-white px-4 text-sm text-navy disabled:opacity-50">
            {busy === "approve_and_schedule" ? "Programando…" : "Aprobar y programar"}
          </button>
        ) : null}
        {props.actions.reschedule ? (
          <button type="button" disabled={disabled} onClick={() => void run("reschedule")} className="min-h-11 rounded-full border border-navy/15 bg-white px-4 text-sm text-navy disabled:opacity-50">
            Reprogramar
          </button>
        ) : null}
        {props.actions.reject ? (
          <button type="button" disabled={disabled} onClick={() => void run("reject")} className="min-h-11 rounded-full border border-rose-800/20 bg-white px-4 text-sm text-rose-900 disabled:opacity-50">
            Rechazar
          </button>
        ) : null}
        {props.actions.publishNow ? (
          <button type="button" disabled={disabled} onClick={() => void openPublish("publish_now")} className="min-h-11 rounded-full border border-accent/40 bg-accent/10 px-4 text-sm text-accent-deep disabled:opacity-50">
            Publicar ahora
          </button>
        ) : null}
        {props.actions.retryPlatform ? (
          <button type="button" disabled={disabled} onClick={() => void openPublish("retry_platform")} className="min-h-11 rounded-full border border-navy/15 bg-white px-4 text-sm text-navy disabled:opacity-50">
            Reintentar red pendiente
          </button>
        ) : null}
      </div>
      {preview ? (
        <div className="rounded-2xl border border-navy/15 bg-white p-4 text-sm">
          <p className="font-medium text-navy">Confirma el efecto real</p>
          <p className="mt-2 text-charcoal/80">{preview.liveEffect}</p>
          <p className="mt-2">Pieza {preview.publicId} · versión {preview.version}</p>
          <p className="mt-1">Redes: {preview.platforms.join(", ") || "ninguna"}</p>
          <p className="mt-1">Pendientes: {preview.pendingPlatforms.join(", ") || "ninguna"}</p>
          <p className="mt-1">Ya publicadas: {preview.alreadyPublished.map((row) => row.platform).join(", ") || "ninguna"}</p>
          <p className="mt-2 text-mist">{preview.cadenceNote}</p>
          <p className="mt-3 whitespace-pre-wrap text-charcoal/80">{preview.copy}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void run(preview.cadenceNote.includes("reintentar") ? "retry_platform" : "publish_now", {
                  confirm: true,
                  idempotencyKey: `live:${props.publicId}:${props.version}`,
                })
              }
              className="min-h-11 rounded-full bg-navy px-4 text-cream disabled:opacity-50"
            >
              {busy === "publish_now" || busy === "retry_platform" ? "Publicando…" : "Confirmar publicación"}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="min-h-11 rounded-full px-4 text-navy">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-sm text-rose-800">{error}</p> : null}
    </div>
  );
}
