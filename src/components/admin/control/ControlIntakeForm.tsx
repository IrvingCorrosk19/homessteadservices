"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Item = {
  filename: string;
  ok: boolean;
  publicId: string;
  duplicate: boolean;
  error: string;
  status?: string;
};

const MAX_FILES = 8;

function errorLabel(code: string) {
  switch (code) {
    case "album_needs_two":
      return "El modo álbum necesita al menos 2 fotos.";
    case "too_many":
      return `Máximo ${MAX_FILES} fotos por carga.`;
    case "no_files":
      return "Selecciona al menos una foto.";
    case "album_incomplete":
      return "No se pudieron procesar todas las fotos del álbum.";
    case "album_photo_not_ready":
      return "Una o más fotos del álbum fallaron al procesarse. Revisa el detalle por archivo.";
    case "album_inflight":
      return "Ese lote ya se está procesando. Espera o usa Recuperar.";
    case "csrf":
      return "Sesión inválida. Recarga la página.";
    default:
      return code || "No se pudo cargar.";
  }
}

function itemErrorLabel(code: string, filename: string) {
  switch (code) {
    case "too_large":
      return `${filename}: supera el tamaño máximo. Comprime la imagen (JPEG recomendado).`;
    case "invalid_image":
      return `${filename}: no es una imagen válida (JPEG/PNG/WebP).`;
    case "brand_failed":
      return `${filename}: falló el procesamiento con marca de agua.`;
    default:
      return `${filename}: ${code || "error"}`;
  }
}

export function ControlIntakeForm() {
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [batchId, setBatchId] = useState("");
  const [batchKey, setBatchKey] = useState("");
  const [error, setError] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [publishMode, setPublishMode] = useState<"album" | "separate">("album");
  const [publicId, setPublicId] = useState("");

  const needsMode = fileNames.length >= 2;
  const canSubmit = fileNames.length >= 1 && (!needsMode || Boolean(publishMode)) && !busy;

  const albumPublicId = useMemo(() => {
    if (publicId) return publicId;
    const hit = items.find((item) => item.ok && item.publicId);
    return hit?.publicId || "";
  }, [items, publicId]);

  async function csrf() {
    const session = await fetch("/api/admin/control/session", { cache: "no-store" });
    return ((await session.json()) as { csrf?: string }).csrf || "";
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    setItems([]);
    setBatchId("");
    setPublicId("");
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("publishMode", needsMode ? publishMode : "separate");
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
      publicId?: string;
      publishMode?: string;
    };
    setBusy(false);
    if (!json.items && !json.ok) {
      setError(errorLabel(json.error || ""));
      return;
    }
    if (!json.items) {
      setError(errorLabel(json.error || "No se pudo cargar."));
      return;
    }
    setItems(json.items);
    setBatchId(json.batchId || "");
    setBatchKey(json.batchKey || "");
    setPublicId(json.publicId || "");
    const failed = json.items.filter((item) => !item.ok);
    if (failed.length) {
      setError(failed.map((item) => itemErrorLabel(item.error, item.filename)).join(" · "));
    } else if (!json.ok) {
      setError(errorLabel(json.error || "No se pudo completar el lote."));
    }
  }

  async function recover() {
    if (!batchKey || busy) return;
    setBusy(true);
    const token = await csrf();
    const response = await fetch(`/api/admin/content/intake/${batchKey}`, {
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    const json = (await response.json()) as { items?: Item[]; batchId?: string; publicId?: string };
    setBusy(false);
    if (json.items) setItems(json.items);
    if (json.batchId) setBatchId(json.batchId);
    if (json.publicId) setPublicId(json.publicId);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      <label className="block text-sm text-navy">
        Fotos (mínimo 1, máximo {MAX_FILES}). Puedes elegir de la galería o tomar una foto.
        <input
          name="files"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          multiple
          required
          className="mt-2 block w-full min-w-0 text-sm"
          onChange={(event) => {
            const list = Array.from(event.target.files || []).slice(0, MAX_FILES);
            setFileNames(list.map((file) => file.name));
            if (list.length < 2) setPublishMode("separate");
            else if (publishMode !== "album" && publishMode !== "separate") setPublishMode("album");
            else if (list.length >= 2 && publishMode === "separate" && fileNames.length < 2) {
              setPublishMode("album");
            }
          }}
        />
      </label>
      {fileNames.length ? (
        <div className="rounded-2xl border border-navy/10 bg-cream/40 px-3 py-2 text-sm text-navy">
          <p className="font-medium">
            {fileNames.length} {fileNames.length === 1 ? "foto seleccionada" : "fotos seleccionadas"} (orden de
            publicación)
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-mist">
            {fileNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {needsMode ? (
        <fieldset className="space-y-2 rounded-2xl border border-navy/10 bg-white px-3 py-3">
          <legend className="px-1 text-sm font-medium text-navy">Cómo publicar estas fotos</legend>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-navy">
            <input
              type="radio"
              name="publishModeChoice"
              checked={publishMode === "album"}
              onChange={() => setPublishMode("album")}
              className="mt-1"
            />
            <span>
              <strong>Una publicación con todas las fotos</strong>
              <span className="block text-xs text-mist">
                Carrusel en Instagram y multi-foto en Facebook, con el mismo texto. Orden = el de la selección.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-navy">
            <input
              type="radio"
              name="publishModeChoice"
              checked={publishMode === "separate"}
              onChange={() => setPublishMode("separate")}
              className="mt-1"
            />
            <span>
              <strong>Una pieza por foto</strong>
              <span className="block text-xs text-mist">
                Cada archivo genera su propia propuesta HC- (publicaciones independientes).
              </span>
            </span>
          </label>
        </fieldset>
      ) : null}
      <label className="block text-sm text-navy">
        Contexto para la IA
        <textarea
          name="note"
          rows={3}
          placeholder="Ej.: Instalamos esta cerradura digital en un apartamento. Destaca la comodidad y el acceso sin llaves"
          className="mt-2 w-full min-w-0 rounded-2xl border border-navy/15 px-3 py-2"
        />
      </label>
      <p className="text-xs text-mist">
        Orienta el generador de texto del proyecto (no se publica literalmente). Si falla el modelo, se usa plantilla
        marcada para revisión. Las ediciones manuales del caption se conservan hasta que regeneres. El servidor no hace
        visión de las fotos. Video no soportado.
      </p>
      <button
        type="submit"
        disabled={!canSubmit}
        className="min-h-11 rounded-full bg-navy px-5 text-sm text-cream disabled:opacity-50"
      >
        {busy
          ? publishMode === "album" && needsMode
            ? "Procesando álbum…"
            : "Procesando…"
          : needsMode && publishMode === "album"
            ? "Crear álbum"
            : "Crear propuestas"}
      </button>
      {batchKey ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void recover()}
          className="ml-2 min-h-11 rounded-full border border-navy/15 px-4 text-sm"
        >
          Recuperar lote interrumpido
        </button>
      ) : null}
      {error ? <p className="text-sm text-rose-800">{error}</p> : null}
      {albumPublicId && needsMode && publishMode === "album" ? (
        <p className="text-sm text-navy">
          Álbum listo:{" "}
          <Link className="underline" href={`/admin/contenido/${albumPublicId}`}>
            {albumPublicId}
          </Link>{" "}
          ({fileNames.length || items.filter((i) => i.ok).length} fotos en una pieza)
        </p>
      ) : null}
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
          <li key={`${item.filename}-${item.publicId}-${item.error}`} className="rounded-xl border border-navy/10 bg-white px-3 py-2">
            {item.ok ? (
              <>
                {item.filename} →{" "}
                <Link className="underline" href={`/admin/contenido/${item.publicId}`}>
                  {item.publicId}
                </Link>
                {item.duplicate ? " (reutilizada, no se duplicó)" : ""}
              </>
            ) : (
              <>{itemErrorLabel(item.error, item.filename)}</>
            )}
          </li>
        ))}
      </ul>
    </form>
  );
}
