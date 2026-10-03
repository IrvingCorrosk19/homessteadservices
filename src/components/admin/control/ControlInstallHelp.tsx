"use client";

import { useEffect, useState } from "react";

type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function ControlInstallHelp() {
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<DeferredPrompt | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    setStandalone(media.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as DeferredPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone || dismissed) return null;

  return (
    <aside className="mt-4 rounded-2xl border border-navy/10 bg-white px-4 py-3 text-sm text-charcoal/80">
      <p className="font-medium text-navy">Instalar Homestead Control</p>
      {prompt ? (
        <button
          type="button"
          className="mt-2 min-h-11 rounded-full bg-navy px-4 text-cream"
          onClick={() => void prompt.prompt()}
        >
          Añadir a la pantalla de inicio
        </button>
      ) : ios ? (
        <p className="mt-2">
          En iPhone o iPad: toca Compartir y luego “Añadir a pantalla de inicio”. Safari no muestra un botón nativo de
          instalación.
        </p>
      ) : (
        <p className="mt-2">
          En Chrome o Edge: menú del navegador → “Instalar Homestead Control” o “Añadir a la pantalla de inicio”.
        </p>
      )}
      <button type="button" className="mt-2 text-xs text-mist underline" onClick={() => setDismissed(true)}>
        Ocultar
      </button>
    </aside>
  );
}
