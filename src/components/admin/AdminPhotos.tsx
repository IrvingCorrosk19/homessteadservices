"use client";

import { useState } from "react";

export type PhotoEvidenceMeta = {
  tone: "pass" | "retake" | "reject" | "pending";
  title: string;
  detail: string;
};

export function AdminPhotos({
  requestId,
  files,
  evidenceByFile = {},
}: {
  requestId: string;
  files: string[];
  evidenceByFile?: Record<string, PhotoEvidenceMeta>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!files.length) return null;

  return (
    <section className="rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
      <p className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">Fotografías</p>
      <p className="mt-2 text-sm text-ink/65">
        Recibidas: {files.length}
        {Object.keys(evidenceByFile).length > 0 ? " · estado por análisis visual" : ""}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {files.map((file) => {
          const src = `/api/admin/service-requests/${requestId}/photos/${file}`;
          const meta = evidenceByFile[file];
          const toneClass =
            meta?.tone === "pass"
              ? "border-emerald-600/40 bg-emerald-50 text-emerald-900"
              : meta?.tone === "retake"
                ? "border-amber-600/40 bg-amber-50 text-amber-950"
                : meta?.tone === "reject"
                  ? "border-rose-600/35 bg-rose-50 text-rose-950"
                  : "border-navy/15 bg-cream-deep text-ink/70";
          return (
            <button
              key={file}
              type="button"
              onClick={() => setOpen(file)}
              className="overflow-hidden rounded-2xl bg-cream-deep text-left"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              {meta ? (
                <div className={`border-t px-3 py-2 ${toneClass}`}>
                  <p className="text-[0.72rem] font-semibold tracking-wide uppercase">
                    {meta.tone === "pass" ? "✅ " : meta.tone === "retake" ? "⚠ " : meta.tone === "reject" ? "❌ " : "○ "}
                    {meta.title}
                  </p>
                  <p className="mt-0.5 text-[0.78rem] leading-snug opacity-90">{meta.detail}</p>
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(18,28,38,0.72)] p-4"
          onClick={() => setOpen(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/admin/service-requests/${requestId}/photos/${open}`}
            alt=""
            className="max-h-[90vh] max-w-full rounded-2xl"
          />
        </div>
      ) : null}
    </section>
  );
}
