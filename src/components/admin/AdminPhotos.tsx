"use client";

import { useState } from "react";

export function AdminPhotos({
  requestId,
  files,
}: {
  requestId: string;
  files: string[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!files.length) return null;

  return (
    <section className="rounded-[24px] border border-navy/8 bg-white p-6 md:p-8">
      <p className="text-[0.72rem] tracking-[0.16em] uppercase text-mist">Fotografías</p>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {files.map((file) => {
          const src = `/api/admin/service-requests/${requestId}/photos/${file}`;
          return (
            <button
              key={file}
              type="button"
              onClick={() => setOpen(file)}
              className="overflow-hidden rounded-2xl bg-cream-deep"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
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
