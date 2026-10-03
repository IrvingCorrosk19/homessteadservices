"use client";

import { useEffect, useState } from "react";

export function ControlPwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;
    let cancelled = false;

    void navigator.serviceWorker
      .register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        if (reg.waiting) {
          setWaiting(reg.waiting);
          setUpdateReady(true);
        }
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(reg.waiting);
              setUpdateReady(true);
            }
          });
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      void registration;
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-40 rounded-2xl border border-navy/15 bg-white px-4 py-3 shadow-lg md:bottom-6 md:left-auto md:right-6 md:w-[360px]">
      <p className="text-sm text-navy">Hay una versión nueva de Control. No se aplica sola si estás en medio de un formulario.</p>
      <button
        type="button"
        className="mt-2 min-h-11 rounded-full bg-navy px-4 text-sm text-cream"
        onClick={() => {
          const form = document.querySelector("form");
          const dirty = Boolean(form && Array.from(form.elements).some((el) => (el as HTMLInputElement).value));
          if (dirty && !window.confirm("Hay un formulario con datos. ¿Actualizar de todos modos?")) return;
          waiting?.postMessage("SKIP_WAITING");
          window.location.reload();
        }}
      >
        Actualizar ahora
      </button>
    </div>
  );
}
