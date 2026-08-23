"use client";

import { useState } from "react";

const OPTIONS = [
  { id: "EXCELLENT", label: "Excelente", hint: "Quedó como esperaba" },
  { id: "GOOD", label: "Bien", hint: "Todo funcionando" },
  { id: "NEUTRAL", label: "Más o menos", hint: "Todavía estoy evaluando" },
  { id: "NEEDS_HELP", label: "Necesito ayuda", hint: "Hay algo por revisar" },
] as const;

export function SatisfactionForm({ token }: { token: string }) {
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<{ response: string; reviewUrl: string; needsHelp: boolean } | null>(null);
  const [error, setError] = useState("");

  async function choose(response: string) {
    setBusy(response);
    setError("");
    const result = await fetch("/api/experiencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, response }),
    });
    const data = (await result.json().catch(() => ({}))) as {
      ok?: boolean;
      reviewUrl?: string;
      needsHelp?: boolean;
      response?: string;
      reason?: string;
    };
    setBusy("");
    if (!data.ok) {
      setError(data.reason === "expired" ? "Este enlace ya no está disponible." : "No pudimos guardar tu respuesta.");
      return;
    }
    setDone({
      response: data.response || response,
      reviewUrl: data.reviewUrl || "",
      needsHelp: Boolean(data.needsHelp),
    });
  }

  if (done) {
    return (
      <section className="mt-8 rounded-3xl bg-white p-6">
        <p className="font-display text-2xl text-navy">
          {done.needsHelp ? "Gracias. Vamos a atenderlo." : "Nos alegra saberlo."}
        </p>
        <p className="mt-3 text-mist">
          {done.needsHelp
            ? "Un miembro del equipo de Homestead te contactará. No te pediremos una reseña ahora."
            : "Gracias por confiar en Homestead."}
        </p>
        {done.reviewUrl ? (
          <a
            href={`/experiencia/${token}/resena`}
            className="mt-6 inline-flex min-h-12 items-center rounded-full bg-navy px-6 text-[0.78rem] tracking-[0.12em] uppercase text-cream"
          >
            Dejar una reseña
          </a>
        ) : null}
      </section>
    );
  }

  return (
    <form className="mt-8 grid gap-3" aria-label="Cómo quedó el servicio">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void choose(option.id)}
          aria-label={`${option.label}. ${option.hint}`}
          className="flex min-h-16 items-center justify-between rounded-2xl bg-white px-5 text-left shadow-[0_10px_30px_rgba(31,51,68,0.06)] disabled:opacity-60"
        >
          <span>
            <span className="block font-display text-2xl text-navy">{option.label}</span>
            <span className="text-sm text-mist">{option.hint}</span>
          </span>
          <span className="text-sm text-accent">{busy === option.id ? "Guardando…" : ""}</span>
        </button>
      ))}
      {error ? <p className="text-sm text-accent-deep">{error}</p> : null}
    </form>
  );
}
