"use client";

import { useRef } from "react";

export type SlotId = "front" | "inside" | "edge";

export type SlotState = {
  file: File | null;
  previewUrl: string;
  status: "empty" | "ready" | "reviewing" | "pass" | "reject";
  note?: string;
};

const SLOT_META: Array<{ id: SlotId; label: string; hint: string }> = [
  { id: "front", label: "Frente", hint: "Exterior de la puerta con la cerradura visible." },
  { id: "inside", label: "Interior", hint: "Parte interior de la puerta y el mecanismo." },
  { id: "edge", label: "Canto / pestillo", hint: "Canto donde se ve el pestillo o la placa." },
];

export function DigitalLockPhotoSlots({
  slots,
  onPick,
  onClear,
  disabled,
}: {
  slots: Record<SlotId, SlotState>;
  onPick: (id: SlotId, file: File) => void;
  onClear: (id: SlotId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[0.72rem] tracking-[0.14em] uppercase text-mist">Fotografías necesarias</p>
        <p className="mt-2 text-sm leading-6 text-navy-soft">
          Para verificar qué cerradura digital puede adaptarse a tu puerta necesitamos estas vistas. Las
          fotografías son necesarias para continuar.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {SLOT_META.map((meta) => (
          <SlotCard
            key={meta.id}
            meta={meta}
            state={slots[meta.id]}
            disabled={disabled}
            onPick={onPick}
            onClear={onClear}
          />
        ))}
      </div>
    </div>
  );
}

function SlotCard({
  meta,
  state,
  disabled,
  onPick,
  onClear,
}: {
  meta: { id: SlotId; label: string; hint: string };
  state: SlotState;
  disabled?: boolean;
  onPick: (id: SlotId, file: File) => void;
  onClear: (id: SlotId) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const statusLabel =
    state.status === "pass"
      ? "Lista"
      : state.status === "reviewing"
        ? "Revisando…"
        : state.status === "reject"
          ? "Necesitamos otra foto"
          : state.status === "ready"
            ? "Lista para enviar"
            : "Falta";

  const tone =
    state.status === "pass"
      ? "border-navy/20 bg-cream"
      : state.status === "reject"
        ? "border-accent/40 bg-white"
        : "border-navy/15 bg-white";

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border ${tone}`}>
      <div className="relative aspect-[4/3] bg-cream-deep">
        {state.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-mist">
            <span className="text-2xl" aria-hidden>
              📷
            </span>
            <span className="text-[0.68rem] tracking-[0.12em] uppercase">{meta.label}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-navy">{meta.label}</p>
            <p className="mt-0.5 text-[0.7rem] leading-4 text-mist">{meta.hint}</p>
          </div>
          <span className="shrink-0 text-[0.65rem] tracking-[0.08em] uppercase text-navy-soft">
            {state.status === "pass" ? "✅ " : state.status === "reject" ? "⚠ " : state.status === "empty" ? "○ " : ""}
            {statusLabel}
          </span>
        </div>
        {state.note && <p className="text-xs leading-5 text-navy-soft">{state.note}</p>}
        <div className="mt-auto flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            className="min-h-10 flex-1 rounded-lg bg-navy px-2 text-[0.65rem] tracking-[0.1em] uppercase text-cream disabled:opacity-50"
            onClick={() => cameraRef.current?.click()}
          >
            Cámara
          </button>
          <button
            type="button"
            disabled={disabled}
            className="min-h-10 flex-1 rounded-lg border border-navy/20 px-2 text-[0.65rem] tracking-[0.1em] uppercase text-navy disabled:opacity-50"
            onClick={() => galleryRef.current?.click()}
          >
            Galería
          </button>
          {state.file && (
            <button
              type="button"
              disabled={disabled}
              className="min-h-10 w-full rounded-lg text-[0.65rem] tracking-[0.1em] uppercase text-mist underline-offset-2 hover:underline"
              onClick={() => onClear(meta.id)}
            >
              Quitar
            </button>
          )}
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(meta.id, file);
            event.target.value = "";
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(meta.id, file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
