"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MediaItem = {
  assetId: number;
  index: number;
  width: number | null;
  height: number | null;
  size: number;
  role: string;
};

export function ControlMediaEditor(props: {
  publicId: string;
  version: number;
  publishMode: string;
  format: string;
  mediaItems: MediaItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState(props.mediaItems);

  const isAlbum = props.publishMode === "album" || props.format === "CAROUSEL" || items.length > 1;
  const total = items.length;

  async function csrf() {
    const session = await fetch("/api/admin/control/session", { cache: "no-store" });
    return ((await session.json()) as { csrf?: string }).csrf || "";
  }

  async function persist(next: MediaItem[], removeIds: number[] = []) {
    if (busy || !props.editable) return;
    if (next.length < 1) {
      setError("Debe quedar al menos una foto.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const token = await csrf();
      const response = await fetch(`/api/admin/content/jobs/${props.publicId}/media`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({
          order: next.map((item) => item.assetId),
          remove: removeIds,
          expectedVersion: props.version,
        }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string; current?: number };
      if (!json.ok) {
        setError(
          json.error === "stale_version" || json.error === "version_mismatch"
            ? "La versión cambió. Recarga la pieza antes de reordenar."
            : json.error === "not_editable" || json.error === "job_locked"
              ? "Esta pieza no se puede editar en su estado actual."
              : json.error === "media_empty"
                ? "Debe quedar al menos una foto."
                : json.error === "csrf"
                  ? "Sesión inválida. Recarga."
                  : json.error || "No se pudo actualizar el orden.",
        );
        return;
      }
      setItems(next.map((item, index) => ({ ...item, index })));
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persist(next);
  }

  function removeAt(index: number) {
    const target = items[index];
    if (!target) return;
    if (items.length <= 1) {
      setError("Debe quedar al menos una foto.");
      return;
    }
    const next = items.filter((_, i) => i !== index);
    void persist(next, [target.assetId]);
  }

  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-2xl text-navy">Fotos finales</h2>
          <p className="mt-1 text-sm text-mist">
            {total} {total === 1 ? "foto" : "fotos"}
            {isAlbum ? " · álbum / carrusel (mismo texto para todas)" : " · publicación individual"}
            {props.editable ? " · puedes reordenar o quitar antes de aprobar" : ""}
          </p>
        </div>
      </div>
      {!total ? (
        <p className="rounded-2xl border border-navy/10 bg-white px-4 py-6 text-sm text-mist">
          Esta pieza no tiene imagen almacenada.
        </p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={item.assetId} className="overflow-hidden rounded-[22px] border border-navy/10 bg-white">
              <div className="relative aspect-[4/5] bg-cream-deep">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/admin/content/media?asset=${item.assetId}`}
                  alt={`Foto ${index + 1} de ${total}`}
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-3 top-3 rounded-full bg-navy/85 px-2.5 py-1 text-xs text-cream">
                  {index + 1}/{total}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <p className="text-xs text-mist">
                  {item.width && item.height ? `${item.width}×${item.height}` : "marca de agua aplicada"}
                </p>
                {props.editable ? (
                  <div className="ml-auto flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={Boolean(busy) || index === 0}
                      onClick={() => move(index, index - 1)}
                      className="min-h-9 rounded-full border border-navy/15 px-3 text-xs disabled:opacity-40"
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy) || index >= items.length - 1}
                      onClick={() => move(index, index + 1)}
                      className="min-h-9 rounded-full border border-navy/15 px-3 text-xs disabled:opacity-40"
                    >
                      Bajar
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy) || items.length <= 1}
                      onClick={() => removeAt(index)}
                      className="min-h-9 rounded-full border border-rose-800/20 px-3 text-xs text-rose-900 disabled:opacity-40"
                    >
                      Quitar
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {busy ? <p className="text-sm text-mist">Guardando orden…</p> : null}
      {error ? <p className="text-sm text-rose-800">{error}</p> : null}
      {props.editable && total > 1 ? (
        <p className="text-xs text-mist">
          Si cambias el orden o quitas una foto, la aprobación queda invalidada y debes volver a aprobar antes de
          publicar.
        </p>
      ) : null}
    </section>
  );
}
