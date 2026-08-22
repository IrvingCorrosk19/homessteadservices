"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; body: string };

const GREET_KEY = "hs_concierge_invite_v1";

export function ConciergeWidget() {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [chips, setChips] = useState<string[]>(["Necesito un servicio", "Quiero cotizar", "Quiero agendar"]);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [keyboardPad, setKeyboardPad] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      body: "Hola. Cuéntame qué está pasando en tu hogar o propiedad: una reparación, un mantenimiento o algo que quieras instalar.",
    },
  ]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef(false);
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(GREET_KEY)) return;
    const timer = window.setTimeout(() => {
      if (!sessionStorage.getItem(GREET_KEY)) setInvite(true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void fetch("/api/concierge/chat")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages(
            data.messages.map((item: { role: string; body: string }) => ({
              role: item.role === "assistant" ? "assistant" : "user",
              body: item.body,
            })),
          );
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pending, open]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const onResize = () => {
      const hidden = window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboardPad(hidden > 40 ? hidden : 0);
    };
    viewport.addEventListener("resize", onResize);
    viewport.addEventListener("scroll", onResize);
    return () => {
      viewport.removeEventListener("resize", onResize);
      viewport.removeEventListener("scroll", onResize);
    };
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || pendingRef.current || ended) return;
    pendingRef.current = true;
    setPending(true);
    setSendError(false);
    setInput("");
    setWhatsapp(null);
    setMessages((current) => [...current, { role: "user", body: message }]);
    try {
      const utm = Object.fromEntries(new URLSearchParams(window.location.search).entries());
      const response = await fetch("/api/concierge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          utm: {
            utm_source: utm.utm_source || "",
            utm_campaign: utm.utm_campaign || "",
            utm_content: utm.utm_content || "",
            hs: utm.hs || "",
            referrer: document.referrer || "",
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error("send_failed");
      const reply = typeof data.reply === "string" ? data.reply : "Cuéntame un poco más del problema para orientarlo.";
      setMessages((current) => [...current, { role: "assistant", body: reply }]);
      setChips(Array.isArray(data.chips) ? data.chips : []);
      setWhatsapp(typeof data.whatsappUrl === "string" ? data.whatsappUrl : null);
      setLeadId(typeof data.leadId === "string" ? data.leadId : null);
      setEnded(Boolean(data.ended));
    } catch {
      setMessages((current) => current.filter((item, index, list) => !(index === list.length - 1 && item.role === "user" && item.body === message)));
      setInput(message);
      setSendError(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [ended]);

  async function onPhoto(file: File) {
    const body = new FormData();
    body.append("photo", file);
    await fetch("/api/concierge/photo", { method: "POST", body });
    setMessages((current) => [...current, { role: "user", body: "Envié una foto." }]);
    await sendMessage("Te envié una foto de la zona o el equipo.");
  }

  function openChat() {
    sessionStorage.setItem(GREET_KEY, "1");
    setInvite(false);
    setOpen(true);
    void fetch("/api/concierge/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "CHAT_STARTED" }),
    });
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <div
      className="pointer-events-none fixed right-4 z-50 flex flex-col items-end gap-3"
      style={{ bottom: `calc(1.25rem + ${keyboardPad}px)`, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {invite && !open && (
        <button
          type="button"
          onClick={openChat}
          className="pointer-events-auto max-w-64 rounded-2xl border border-line bg-white px-4 py-3 text-left text-sm leading-6 text-charcoal shadow-[0_18px_40px_rgba(31,51,68,0.16)] md:max-w-72"
        >
          Hola. Cuéntame qué está pasando en tu casa o propiedad y te ayudo a orientarlo.
        </button>
      )}

      {open && (
        <section
          className="pointer-events-auto flex w-[min(100vw-2rem,24rem)] flex-col overflow-hidden rounded-2xl border border-line bg-cream shadow-[0_24px_60px_rgba(31,51,68,0.22)] max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:bottom-0 max-md:w-full max-md:rounded-none"
          style={{ paddingBottom: keyboardPad ? keyboardPad : undefined }}
          role="dialog"
          aria-label="Asistente de servicios Homestead"
        >
          <header className="flex items-start justify-between gap-3 bg-navy px-5 py-4 text-cream">
            <div>
              <p className="font-display text-xl">Homestead Services</p>
              <p className="mt-1 text-xs tracking-[0.12em] uppercase text-cream/70">Asesor de servicios</p>
              <p className="mt-2 max-w-xs text-xs leading-5 text-cream/75">
                Conversemos sobre lo que necesitas resolver en tu propiedad.
              </p>
            </div>
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-lg text-cream/80 hover:text-cream"
              aria-label="Cerrar"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </header>
          <div
            ref={scroller}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            onScroll={(event) => {
              const node = event.currentTarget;
              stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            }}
          >
            {messages.map((item, index) => (
              <p
                key={`${item.role}-${index}`}
                className={
                  item.role === "user"
                    ? "ml-8 whitespace-pre-wrap rounded-2xl bg-navy px-4 py-3 text-sm leading-6 text-cream"
                    : "mr-8 whitespace-pre-wrap rounded-2xl border border-line bg-white px-4 py-3 text-sm leading-6 text-charcoal"
                }
              >
                {item.body}
              </p>
            ))}
            {pending && (
              <p className="mr-8 flex items-center gap-1 rounded-2xl border border-line bg-white px-4 py-3" aria-live="polite" aria-label="Escribiendo">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy/50" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy/50 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-navy/50 [animation-delay:240ms]" />
              </p>
            )}
            {sendError && (
              <p className="text-xs text-accent" role="alert">
                No se pudo enviar. El texto se conservó; puedes reintentar.
              </p>
            )}
            {leadId && (
              <p className="text-xs text-mist">Solicitud {leadId} registrada.</p>
            )}
          </div>
          {chips.length > 0 && !ended && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="min-h-11 rounded-full border border-navy/20 px-3 text-xs text-navy"
                  onClick={() => void sendMessage(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-4 mb-2 min-h-12 rounded-lg bg-navy px-4 py-3 text-center text-xs tracking-[0.12em] uppercase text-cream"
            >
              Continuar por WhatsApp
            </a>
          )}
          {ended ? (
            <p className="px-4 pb-4 text-sm text-mist">Cuando quieras, vuelve a escribirnos.</p>
          ) : (
            <form
              className="flex items-end gap-2 border-t border-line bg-white px-3 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(input);
              }}
            >
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg text-navy"
                aria-label="Adjuntar foto"
                onClick={() => fileRef.current?.click()}
              >
                +
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onPhoto(file);
                  event.target.value = "";
                }}
              />
              <label className="sr-only" htmlFor="hs-concierge-input">
                Escribe tu mensaje
              </label>
              <textarea
                id="hs-concierge-input"
                ref={inputRef}
                rows={1}
                value={input}
                disabled={pending}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key !== "Enter") return;
                  if (event.shiftKey) return;
                  event.preventDefault();
                  void sendMessage(input);
                }}
                placeholder="Cuéntame qué necesitas"
                className="max-h-28 min-h-11 flex-1 resize-none bg-transparent py-2 text-sm outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                className="min-h-11 rounded-lg bg-accent px-3 text-xs tracking-[0.12em] uppercase text-white disabled:opacity-50"
              >
                {pending ? "Enviando" : "Enviar"}
              </button>
            </form>
          )}
        </section>
      )}

      {!open && (
        <button
          type="button"
          onClick={openChat}
          className="pointer-events-auto mb-[4.6rem] flex min-h-14 items-center gap-3 rounded-full border border-navy/10 bg-navy px-4 py-2 text-left text-cream shadow-[0_16px_36px_rgba(31,51,68,0.28)] md:mb-0"
          aria-label="Cuéntame qué necesitas"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-medium">
            HS
          </span>
          <span className="pr-1 text-sm leading-5">¿Qué necesitas resolver?</span>
        </button>
      )}
    </div>
  );
}
