"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OperationsPageContext } from "@/lib/operations/context";

type OperationsAiCard =
  | { type: "request"; publicId: string; name: string; service: string; status: string; href: string }
  | { type: "appointment"; appointmentId: string; time: string; customerName: string; service: string; href: string }
  | { type: "customer"; customerId: number; name: string; href: string }
  | { type: "attention"; id: string; title: string; kind: string; detail?: string }
  | { type: "summary"; label: string; value: string | number };

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  cards?: OperationsAiCard[];
  confirmation?: { token: string; summary: string };
};

function derivePageContext(pathname: string, searchParams: URLSearchParams): OperationsPageContext {
  const ctx: OperationsPageContext = { route: pathname };
  const req = pathname.match(/^\/admin\/solicitudes\/([^/]+)/);
  if (req) {
    ctx.entityType = "request";
    ctx.entityId = decodeURIComponent(req[1]);
  }
  const cust = pathname.match(/^\/admin\/clientes\/(\d+)/);
  if (cust) {
    ctx.entityType = "customer";
    ctx.entityId = cust[1];
    ctx.selectedCustomerId = Number(cust[1]);
  }
  const job = pathname.match(/^\/admin\/trabajos\/([^/]+)/);
  if (job) {
    ctx.entityType = "job";
    ctx.entityId = decodeURIComponent(job[1]);
  }
  const date = searchParams.get("date") || searchParams.get("ymd");
  if (date) ctx.selectedDate = date;
  return ctx;
}

function CardView({ card }: { card: OperationsAiCard }) {
  if (card.type === "request") {
    return (
      <Link
        href={card.href}
        className="block rounded-xl border border-navy/10 bg-white px-3 py-2 text-sm hover:border-accent/40"
      >
        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-mist">Solicitud</p>
        <p className="font-medium text-navy">{card.publicId}</p>
        <p className="text-charcoal/75">
          {card.name} · {card.service}
        </p>
        <p className="text-xs text-mist">{card.status}</p>
      </Link>
    );
  }
  if (card.type === "appointment") {
    return (
      <Link
        href={card.href}
        className="block rounded-xl border border-navy/10 bg-white px-3 py-2 text-sm hover:border-accent/40"
      >
        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-mist">Cita</p>
        <p className="font-medium text-navy">{card.time}</p>
        <p className="text-charcoal/75">
          {card.customerName} · {card.service}
        </p>
      </Link>
    );
  }
  if (card.type === "customer") {
    return (
      <Link
        href={card.href}
        className="block rounded-xl border border-navy/10 bg-white px-3 py-2 text-sm hover:border-accent/40"
      >
        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-mist">Cliente</p>
        <p className="font-medium text-navy">{card.name}</p>
      </Link>
    );
  }
  if (card.type === "attention") {
    return (
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm">
        <p className="text-[0.65rem] uppercase tracking-[0.12em] text-amber-800/70">{card.kind}</p>
        <p className="font-medium text-navy">{card.title}</p>
        {card.detail ? <p className="text-xs text-charcoal/70">{card.detail}</p> : null}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-navy/10 bg-white px-3 py-2 text-sm">
      <p className="text-[0.65rem] uppercase tracking-[0.12em] text-mist">{card.label}</p>
      <p className="font-display text-2xl text-navy">{card.value}</p>
    </div>
  );
}

export function OperationsAiPanel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageContext = useMemo(
    () => derivePageContext(pathname, searchParams),
    [pathname, searchParams],
  );

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Homestead AI Operations. Pregúntame sobre pendientes, citas, clientes o solicitudes — con datos reales del negocio.",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = useCallback(
    async (text: string, confirmation?: { token: string; accept: boolean }) => {
      if (!text.trim() && !confirmation) return;
      setBusy(true);
      if (!confirmation) {
        setMessages((prev) => [...prev, { role: "user", text: text.trim() }]);
        setInput("");
      }
      try {
        const res = await fetch("/api/admin/copilot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId,
            pageContext,
            confirmation,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: data.detail || "No pude procesar la consulta." },
          ]);
          return;
        }
        if (data.conversationId) setConversationId(data.conversationId);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: data.reply,
            cards: data.cards,
            confirmation: data.confirmation,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Error de conexión. Intenta de nuevo." },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [conversationId, pageContext],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  if (!mounted) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-40 flex h-12 min-w-12 items-center justify-center rounded-full bg-accent px-4 text-[0.68rem] font-medium tracking-[0.1em] uppercase text-navy shadow-lg md:bottom-6"
        aria-expanded={open}
        aria-label="Homestead AI Operations"
      >
        {open ? "Cerrar" : "Homestead AI"}
      </button>

      {open ? (
        <aside
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[min(85vh,720px)] flex-col border-t border-navy/15 bg-cream shadow-2xl md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:max-h-none md:w-[min(420px,100vw)] md:border-l md:border-t-0"
          aria-label="Panel Homestead AI Operations"
        >
          <header className="flex items-center justify-between border-b border-navy/10 px-4 py-3">
            <div>
              <p className="text-[0.65rem] tracking-[0.14em] uppercase text-accent">Operations</p>
              <p className="font-display text-lg text-navy">Homestead AI</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-mist hover:text-navy"
            >
              ✕
            </button>
          </header>

          {pageContext.entityType && pageContext.entityId ? (
            <p className="border-b border-navy/8 px-4 py-2 text-xs text-mist">
              Contexto: {pageContext.entityType} {pageContext.entityId}
            </p>
          ) : null}

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`max-w-[95%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "ml-auto bg-navy text-cream"
                    : "mr-auto border border-navy/10 bg-white text-charcoal"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {msg.cards?.length ? (
                  <div className="mt-2 space-y-2">
                    {msg.cards.map((c, j) => (
                      <CardView key={j} card={c} />
                    ))}
                  </div>
                ) : null}
                {msg.confirmation ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void send("Sí", { token: msg.confirmation!.token, accept: true })
                      }
                      className="rounded-full bg-navy px-3 py-1.5 text-xs text-cream disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void send("No", { token: msg.confirmation!.token, accept: false })
                      }
                      className="rounded-full border border-navy/20 px-3 py-1.5 text-xs text-navy disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? <p className="text-xs text-mist">Consultando datos…</p> : null}
          </div>

          <form onSubmit={onSubmit} className="border-t border-navy/10 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="¿Qué tenemos mañana?"
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl border border-navy/15 bg-white px-3 text-sm text-charcoal outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="min-h-11 rounded-xl bg-navy px-4 text-xs tracking-[0.08em] uppercase text-cream disabled:opacity-50"
              >
                Enviar
              </button>
            </div>
          </form>
        </aside>
      ) : null}
    </>
  );
}
