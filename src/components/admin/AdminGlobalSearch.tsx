"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AdminSearchResult } from "@/lib/admin-search";

const TYPE_LABELS: Record<AdminSearchResult["type"], string> = {
  customer: "Cliente",
  request: "Solicitud",
  appointment: "Cita",
};

export function AdminGlobalSearch() {
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminSearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (value: string) => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`);
      const data = await response.json().catch(() => ({ results: [] }));
      setResults(Array.isArray(data.results) ? data.results : []);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void search(query), 220);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        window.setTimeout(() => rootRef.current?.querySelector("input")?.focus(), 0);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-cream/15 bg-cream/10 px-4 py-2 text-left text-sm text-cream/70"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`${inputId}-panel`}
      >
        <span>Buscar cliente, HS, teléfono…</span>
        <kbd className="hidden rounded border border-cream/20 px-1.5 py-0.5 text-[0.62rem] uppercase tracking-[0.08em] sm:inline">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div
          id={`${inputId}-panel`}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[60] w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-navy/10 bg-white p-3 shadow-[0_16px_40px_rgba(31,51,68,0.16)]"
          role="dialog"
          aria-label="Búsqueda global"
        >
          <label className="sr-only" htmlFor={inputId}>
            Buscar
          </label>
          <input
            id={inputId}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, teléfono, HS-…, HA-…"
            className="min-h-11 w-full rounded-xl border border-navy/10 px-4 py-3 text-sm text-charcoal outline-none focus:border-accent"
          />
          <div className="mt-3 max-h-72 overflow-y-auto">
            {busy ? <p className="px-2 py-3 text-sm text-mist">Buscando…</p> : null}
            {!busy && query.trim().length >= 2 && results.length === 0 ? (
              <p className="px-2 py-3 text-sm text-mist">Sin resultados para “{query.trim()}”.</p>
            ) : null}
            {!busy && query.trim().length < 2 ? (
              <p className="px-2 py-3 text-sm text-mist">Escribe al menos 2 caracteres.</p>
            ) : null}
            <ul className="space-y-1">
              {results.map((item) => (
                <li key={`${item.type}-${item.id}`}>
                  <Link
                    href={item.href}
                    className="block rounded-xl px-3 py-3 hover:bg-cream-deep"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      setResults([]);
                    }}
                  >
                    <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">{TYPE_LABELS[item.type]}</p>
                    <p className="mt-0.5 font-medium text-navy">{item.title}</p>
                    <p className="mt-0.5 truncate text-sm text-charcoal/70">{item.subtitle}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
