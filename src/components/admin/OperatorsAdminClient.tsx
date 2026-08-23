"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = {
  id: number;
  displayName: string;
  role: string;
  status: string;
  isActive: boolean;
  lastSeenAt: string | null;
  notifyRequests: boolean;
  notifyAppointments: boolean;
  notifyLeads: boolean;
  notifySla: boolean;
  notifyContent: boolean;
  notifyDailyBrief: boolean;
  telegramSuffix: string;
};

export function OperatorsAdminClient({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function act(operatorId: number, action: string, role?: string) {
    setBusy(operatorId);
    setError("");
    const response = await fetch("/api/admin/telegram-operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operatorId, action, role }),
    });
    const json = (await response.json()) as { ok?: boolean; error?: string };
    setBusy(null);
    if (!response.ok || !json.ok) {
      setError(json.error || "No se pudo actualizar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-4">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {initial.map((op) => (
        <article key={op.id} className="rounded-2xl border border-navy/8 bg-white px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-2xl text-navy">{op.displayName}</p>
              <p className="mt-1 text-sm text-charcoal/70">
                {op.role} · {op.status} · …{op.telegramSuffix}
              </p>
              <p className="mt-1 text-xs text-mist">
                Último acceso: {op.lastSeenAt ? new Date(op.lastSeenAt).toLocaleString("es-PA") : "—"}
              </p>
              <p className="mt-2 text-xs text-charcoal/60">
                Avisos:{" "}
                {[
                  op.notifyRequests ? "solicitudes" : null,
                  op.notifyAppointments ? "citas" : null,
                  op.notifyLeads ? "leads" : null,
                  op.notifySla ? "SLA" : null,
                  op.notifyContent ? "contenido" : null,
                  op.notifyDailyBrief ? "brief" : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "ninguno"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {op.role === "PENDING" ? (
                <>
                  <button
                    type="button"
                    disabled={busy === op.id}
                    onClick={() => void act(op.id, "approve", "ADMIN")}
                    className="rounded-xl bg-navy px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase text-cream"
                  >
                    Autorizar ADMIN
                  </button>
                  <button
                    type="button"
                    disabled={busy === op.id}
                    onClick={() => void act(op.id, "approve", "OWNER")}
                    className="rounded-xl border border-navy/20 px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase text-navy"
                  >
                    Autorizar OWNER
                  </button>
                  <button
                    type="button"
                    disabled={busy === op.id}
                    onClick={() => void act(op.id, "reject")}
                    className="rounded-xl border border-navy/10 px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase text-mist"
                  >
                    Rechazar
                  </button>
                </>
              ) : op.isActive ? (
                <button
                  type="button"
                  disabled={busy === op.id}
                  onClick={() => void act(op.id, "deactivate")}
                  className="rounded-xl border border-navy/20 px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase text-navy"
                >
                  Desactivar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === op.id}
                  onClick={() => void act(op.id, "activate")}
                  className="rounded-xl bg-navy px-4 py-2 text-[0.68rem] tracking-[0.12em] uppercase text-cream"
                >
                  Reactivar
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
      {!initial.length ? (
        <p className="text-sm text-mist">Aún no hay operadores. El allowlist de entorno se migra al arrancar.</p>
      ) : null}
    </div>
  );
}
