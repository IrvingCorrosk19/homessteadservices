"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SignalRow = {
  signalId: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  summary?: string;
  recommendation?: string;
  facts: Record<string, unknown>;
  href: string;
};

type Executive = {
  visitsToday: number;
  openRequests: number;
  needsAttention: number;
  automationFailures: number;
  activeSignals: number;
};

export function AutonomousAlertsPanel() {
  const [mounted, setMounted] = useState(false);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [executive, setExecutive] = useState<Executive | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/autonomous/signals");
    const data = await res.json();
    if (data.ok) {
      setSignals(data.signals || []);
      setExecutive(data.executive || null);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void load();
  }, [load]);

  async function ack(signalId: string) {
    setBusy(signalId);
    try {
      await fetch(`/api/admin/autonomous/signals/${signalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledge" }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!mounted) return null;

  return (
    <section className="mt-8 rounded-3xl border border-navy/10 bg-white p-5 md:p-6" aria-labelledby="autonomous-ai-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.68rem] tracking-[0.14em] uppercase text-accent">Homestead AI Autonomous</p>
          <h2 id="autonomous-ai-heading" className="mt-1 font-display text-2xl text-navy md:text-3xl">
            Alertas proactivas
          </h2>
          <p className="mt-1 text-sm text-mist">Detectadas desde datos reales — no requieren que preguntes primero.</p>
        </div>
        {executive ? (
          <div className="flex flex-wrap gap-2 text-[0.65rem] tracking-[0.1em] uppercase text-navy-soft">
            <span className="rounded-full bg-cream-deep px-3 py-1">{executive.visitsToday} visitas hoy</span>
            <span className="rounded-full bg-cream-deep px-3 py-1">{executive.openRequests} abiertas</span>
            <span className="rounded-full bg-cream-deep px-3 py-1">{executive.activeSignals} alertas IA</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {signals.length === 0 ? (
          <p className="rounded-2xl border border-navy/8 bg-cream/40 px-4 py-5 text-sm text-mist">
            Sin alertas activas. El escáner revisa solicitudes, citas y automatizaciones periódicamente.
          </p>
        ) : (
          signals.map((s) => (
            <article key={s.signalId} className="rounded-2xl border border-navy/8 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2 text-[0.62rem] tracking-[0.1em] uppercase">
                    <span className="rounded-full bg-navy/5 px-2 py-1 text-navy">{s.severity}</span>
                    <span className="rounded-full bg-cream-deep px-2 py-1 text-navy-soft">{s.status}</span>
                  </div>
                  <h3 className="mt-2 font-display text-lg text-navy">{s.title}</h3>
                  {s.summary ? <p className="mt-1 text-sm text-charcoal/80">{s.summary}</p> : null}
                  {s.recommendation ? (
                    <p className="mt-2 text-sm text-accent-deep">
                      <span className="font-medium">Recomendación:</span> {s.recommendation}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Link
                    href={s.href}
                    className="min-h-10 rounded-full border border-navy/15 px-4 py-2 text-center text-[0.65rem] tracking-[0.1em] uppercase text-navy"
                  >
                    Ver detalle
                  </Link>
                  {s.status !== "ACKNOWLEDGED" ? (
                    <button
                      type="button"
                      disabled={busy === s.signalId}
                      onClick={() => void ack(s.signalId)}
                      className="min-h-10 rounded-full bg-navy px-4 py-2 text-[0.65rem] tracking-[0.1em] uppercase text-cream disabled:opacity-60"
                    >
                      Enterado
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
