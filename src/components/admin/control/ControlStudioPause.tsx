"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ControlStudioPause({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError("");
    const session = await fetch("/api/admin/control/session", { cache: "no-store" });
    const csrf = ((await session.json()) as { csrf?: string }).csrf || "";
    const response = await fetch("/api/admin/content/studio", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ paused: !paused }),
    });
    const json = (await response.json()) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!json.ok) {
      setError("No pude cambiar la pausa.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-navy/10 bg-white px-4 py-3">
      <p className="text-sm text-navy">
        {paused
          ? "El estudio está en pausa. No se aprueba ni se publica. DRY RUN no cambia."
          : "El estudio está activo. Publicar ahora sigue siendo una confirmación explícita."}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="mt-3 min-h-11 rounded-full bg-navy px-4 text-sm text-cream disabled:opacity-50"
      >
        {busy ? "Guardando…" : paused ? "Reanudar estudio" : "Pausar estudio"}
      </button>
      {error ? <p className="mt-2 text-sm text-rose-800">{error}</p> : null}
    </div>
  );
}
