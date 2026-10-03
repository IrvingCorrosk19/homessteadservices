"use client";

import Link from "next/link";
import { useState } from "react";

type Item = {
  filename: string;
  ok: boolean;
  publicId: string;
  duplicate: boolean;
  error: string;
  status?: string;
};

export function ControlIntakeForm() {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [batchId, setBatchId] = useState("");
  const [batchKey, setBatchKey] = useState("");
  const [error, setError] = useState("");

  async function csrf() {
    const session = await fetch("/api/admin/control/session", { cache: "no-store" });
    return ((await session.json()) as { csrf?: string }).csrf || "";
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const token = await csrf();
    const response = await fetch("/api/admin/content/intake", {
      method: "POST",
      headers: { "x-csrf-token": token },
      body: data,
    });
    const json = (await response.json()) as {
      ok?: boolean;
      error?: string;
      items?: Item[];
      batchId?: string;
      batchKey?: string;
    };
    setBusy(false);
    if (!json.items) {
      setError(json.error === "csrf" ? "Sesión inválida. Recarga." : json.error || "No se pudo cargar.");
      return;
    }
    setItems(json.items);
    setBatchId(json.batchId || "");
    setBatchKey(json.batchKey || "");
  }

  async function recover() {
    if (!batchKey || busy) return;
    setBusy(true);
    const token = await csrf();
    const response = await fetch(`/api/admin/content/intake/${batchKey}`, {
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    const json = (await response.json()) as { items?: Item[]; batchId?: string };
    setBusy(false);
    if (json.items) setItems(json.items);
    if (json.batchId) setBatchId(json.batchId);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      <label className="block text-sm text-navy">
        Fotos (mínimo 1, máximo 8). Puedes elegir de la galería o tomar una foto.
        <input
          name="files"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          multiple
          required
          className="mt-2 block w-full min-w-0 text-sm"
        />
      </label>
      <label className="block text-sm text-navy">
        Nota para todas las piezas
        <textarea name="note" rows={3} className="mt-2 w-full min-w-0 rounded-2xl border border-navy/15 px-3 py-2" />
      </label>
      <p className="text-xs text-mist">
        Cada archivo válido crea una propuesta HC-. Cargar seis fotos no las publica a la vez. Video y carrusel no
        están soportados.
      </p>
      <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-navy px-5 text-sm text-cream disabled:opacity-50">
        {busy ? "Procesando…" : "Crear propuestas"}
      </button>
      {batchKey ? (
        <button type="button" disabled={busy} onClick={() => void recover()} className="ml-2 min-h-11 rounded-full border border-navy/15 px-4 text-sm">
          Recuperar lote interrumpido
        </button>
      ) : null}
      {error ? <p className="text-sm text-rose-800">{error}</p> : null}
      {batchId ? (
        <p className="text-sm text-navy">
          Lote{" "}
          <Link className="underline" href={`/admin/contenido/lotes/${batchId}`}>
            {batchId}
          </Link>
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li key={`${item.filename}-${item.publicId}`} className="rounded-xl border border-navy/10 bg-white px-3 py-2">
            {item.ok ? (
              <>
                {item.filename} →{" "}
                <Link className="underline" href={`/admin/contenido/${item.publicId}`}>
                  {item.publicId}
                </Link>
                {item.duplicate ? " (reutilizada, no se duplicó)" : ""}
              </>
            ) : (
              <>
                {item.filename}: {item.error}
              </>
            )}
          </li>
        ))}
      </ul>
    </form>
  );
}
