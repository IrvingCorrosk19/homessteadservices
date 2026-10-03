"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ControlCampaignPause(props: { campaignId: string; paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const session = await fetch("/api/admin/control/session", { cache: "no-store" });
    const csrf = ((await session.json()) as { csrf?: string }).csrf || "";
    const response = await fetch(`/api/admin/content/campaigns/${props.campaignId}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ paused: !props.paused }),
    });
    const json = (await response.json()) as { ok?: boolean };
    setBusy(false);
    if (!json.ok) {
      setError("No pude cambiar la pausa de la campaña.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="min-h-11 rounded-full bg-navy px-4 text-sm text-cream disabled:opacity-50"
      >
        {busy ? "Guardando…" : props.paused ? "Reanudar campaña" : "Pausar campaña"}
      </button>
      {error ? <p className="mt-2 text-sm text-rose-800">{error}</p> : null}
    </div>
  );
}
