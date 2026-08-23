"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareConciergePhoto, revokePreparedPhoto } from "@/lib/concierge-client-photo";

type ChatMessage = {
  role: "user" | "assistant";
  body: string;
  photoId?: string;
  photoPreviewUrl?: string;
  photoStatus?: "uploading" | "sent" | "failed";
  localKey?: string;
};

type PendingPhoto = {
  file: File;
  previewUrl: string;
  name: string;
  preparing: boolean;
};

type SlotGroup = {
  date: string;
  dateLabel: string;
  times: Array<{ label: string; date: string; time: string }>;
};

const GREET_KEY = "hs_concierge_invite_v1";
const CHAT_OPEN_KEY = "hs_concierge_open_v1";

function photoSrc(photoId?: string, previewUrl?: string) {
  if (previewUrl) return previewUrl;
  if (photoId) return `/api/concierge/photos/${encodeURIComponent(photoId)}`;
  return "";
}

export function ConciergeWidget() {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const [slotGroups, setSlotGroups] = useState<SlotGroup[]>([]);
  const [historicalChips, setHistoricalChips] = useState<string[]>([]);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [serviceContext, setServiceContext] = useState<string | null>(null);
  const [bookingPending, setBookingPending] = useState(false);
  const [showResumeBooking, setShowResumeBooking] = useState(false);
  const [bookingExpanded, setBookingExpanded] = useState(true);
  const [keyboardPad, setKeyboardPad] = useState(0);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
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
  const pendingPhotoRef = useRef<PendingPhoto | null>(null);
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    pendingPhotoRef.current = pendingPhoto;
  }, [pendingPhoto]);

  useEffect(() => {
    return () => {
      if (pendingPhotoRef.current) revokePreparedPhoto(pendingPhotoRef.current.previewUrl);
    };
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(GREET_KEY)) return;
    const timer = window.setTimeout(() => {
      if (!sessionStorage.getItem(GREET_KEY)) setInvite(true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  const applySessionState = useCallback((data: Record<string, unknown>) => {
    setChips(Array.isArray(data.chips) ? (data.chips as string[]) : []);
    setSlotGroups(Array.isArray(data.slotGroups) ? (data.slotGroups as SlotGroup[]) : []);
    setHistoricalChips(Array.isArray(data.historicalChips) ? (data.historicalChips as string[]) : []);
    setServiceContext(typeof data.serviceContext === "string" ? data.serviceContext : null);
    const pending = Boolean(data.bookingPending);
    setBookingPending(pending);
    setShowResumeBooking(Boolean(data.showResumeBooking));
    if (pending) setBookingExpanded(false);
    else if (Array.isArray(data.chips) && data.chips.length) setBookingExpanded(true);
    setWhatsapp(typeof data.whatsappUrl === "string" ? data.whatsappUrl : null);
    setEnded(Boolean(data.ended));
  }, []);

  useEffect(() => {
    void fetch("/api/concierge/chat")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages(
            data.messages.map((item: { role: string; body: string; photoId?: string }) => ({
              role: item.role === "assistant" ? "assistant" : "user",
              body: item.body || "",
              photoId: typeof item.photoId === "string" ? item.photoId : undefined,
            })),
          );
        }
        applySessionState(data);
      })
      .catch(() => undefined);
  }, [applySessionState]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        sessionStorage.setItem(CHAT_OPEN_KEY, "0");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pending, open, pendingPhoto]);

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

  const applyTurnResponse = useCallback((data: Record<string, unknown>) => {
    const reply = typeof data.reply === "string" ? data.reply : "Cuéntame un poco más del problema para orientarlo.";
    setMessages((current) => [...current, { role: "assistant", body: reply }]);
    applySessionState(data);
  }, [applySessionState]);

  const sendChatTurn = useCallback(async (message: string) => {
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
    applyTurnResponse(data);
  }, [applyTurnResponse]);

  const sendMessage = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || pendingRef.current || ended) return;
    pendingRef.current = true;
    setPending(true);
    setSendError(false);
    setInput("");
    setWhatsapp(null);
    setChips([]);
    setSlotGroups([]);
    setMessages((current) => [...current, { role: "user", body: message }]);
    try {
      await sendChatTurn(message);
    } catch {
      setMessages((current) => current.filter((item, index, list) => !(index === list.length - 1 && item.role === "user" && item.body === message)));
      setInput(message);
      setSendError(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [ended, sendChatTurn]);

  const clearPendingPhoto = useCallback(() => {
    setPendingPhoto((current) => {
      if (current) revokePreparedPhoto(current.previewUrl);
      return null;
    });
    setPhotoError(null);
  }, []);

  const uploadPhotoTurn = useCallback(async (photo: PendingPhoto, caption: string, localKey: string) => {
    const form = new FormData();
    form.append("photo", photo.file);
    if (caption) form.append("caption", caption);
    const upload = await fetch("/api/concierge/photo", { method: "POST", body: form });
    const uploaded = await upload.json();
    if (!upload.ok || !uploaded.ok) {
      throw new Error(typeof uploaded.message === "string" ? uploaded.message : "upload_failed");
    }
    const photoId = String(uploaded.photoId || "");
    setMessages((current) =>
      current.map((item) =>
        item.localKey === localKey
          ? { ...item, photoId, photoStatus: "sent", photoPreviewUrl: undefined }
          : item,
      ),
    );
    revokePreparedPhoto(photo.previewUrl);

    const ai = await fetch("/api/concierge/photo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: caption || "Comparto esta foto para orientar el servicio." }),
    });
    const data = await ai.json();
    if (!ai.ok || !data.ok) throw new Error("turn_failed");
    applyTurnResponse(data);
  }, [applyTurnResponse]);

  const submitComposer = useCallback(async () => {
    const caption = input.trim();
    const photo = pendingPhoto;
    if ((!caption && !photo) || pendingRef.current || ended) return;

    if (photo) {
      pendingRef.current = true;
      setPending(true);
      setSendError(false);
      setPhotoError(null);
      setWhatsapp(null);
      setChips([]);
      const localKey = `photo-${Date.now()}`;
      const snapshot = photo;
      setMessages((current) => [
        ...current,
        {
          role: "user",
          body: caption,
          photoPreviewUrl: snapshot.previewUrl,
          photoStatus: "uploading",
          localKey,
        },
      ]);
      setInput("");
      clearPendingPhoto();
      try {
        await uploadPhotoTurn(snapshot, caption, localKey);
      } catch (error) {
        const message = error instanceof Error && error.message !== "turn_failed" && error.message !== "upload_failed"
          ? error.message
          : "No pudimos enviar esta foto.";
        setPhotoError(message);
        setMessages((current) =>
          current.map((item) => (item.localKey === localKey ? { ...item, photoStatus: "failed" } : item)),
        );
      } finally {
        pendingRef.current = false;
        setPending(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
      return;
    }

    await sendMessage(caption);
  }, [clearPendingPhoto, ended, input, pendingPhoto, sendMessage, uploadPhotoTurn]);

  async function onFileSelected(file: File) {
    setPhotoError(null);
    setPendingPhoto({ file, previewUrl: "", name: file.name, preparing: true });
    try {
      const prepared = await prepareConciergePhoto(file);
      setPendingPhoto({
        file: prepared.file,
        previewUrl: prepared.previewUrl,
        name: file.name,
        preparing: false,
      });
    } catch {
      setPhotoError("No pudimos preparar esta foto. Intenta con otra.");
      setPendingPhoto(null);
    }
  }

  function openChat() {
    sessionStorage.setItem(GREET_KEY, "1");
    sessionStorage.setItem(CHAT_OPEN_KEY, "1");
    setInvite(false);
    setOpen(true);
    void fetch("/api/concierge/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "CHAT_STARTED" }),
    });
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closeChat() {
    setOpen(false);
    sessionStorage.setItem(CHAT_OPEN_KEY, "0");
  }

  function minimizeChat() {
    closeChat();
  }

  const canSend = Boolean((input.trim() || pendingPhoto) && !pending && !ended && !pendingPhoto?.preparing);

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

      {lightboxSrc && (
        <button
          type="button"
          className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-navy/85 p-4"
          aria-label="Cerrar imagen"
          onClick={() => setLightboxSrc(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxSrc} alt="Vista ampliada" className="max-h-[90vh] max-w-full rounded-xl object-contain" />
        </button>
      )}

      {open && (
        <section
          className="pointer-events-auto flex w-[min(100vw-2rem,24rem)] flex-col overflow-hidden rounded-2xl border border-line bg-cream shadow-[0_24px_60px_rgba(31,51,68,0.22)] max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:bottom-0 max-md:w-full max-md:rounded-none"
          style={{ paddingBottom: keyboardPad ? keyboardPad : undefined }}
          role="dialog"
          aria-label="Asistente de servicios Homestead"
        >
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-navy px-5 py-4 text-cream">
            <div>
              <p className="font-display text-xl">Homestead Services</p>
              <p className="mt-1 text-xs tracking-[0.12em] uppercase text-cream/70">Asesor de servicios</p>
              {serviceContext && (
                <p className="mt-1 text-xs text-cream/75">{serviceContext}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg text-cream/80 hover:text-cream"
                aria-label="Minimizar chat"
                onClick={minimizeChat}
              >
                —
              </button>
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg text-cream/80 hover:text-cream"
                aria-label="Cerrar chat"
                onClick={closeChat}
              >
                ✕
              </button>
            </div>
          </header>
          <div
            ref={scroller}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-4"
            onScroll={(event) => {
              const node = event.currentTarget;
              stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            }}
          >
            {messages.map((item, index) => {
              const src = photoSrc(item.photoId, item.photoPreviewUrl);
              const isUser = item.role === "user";
              return (
                <div
                  key={item.localKey || `${item.role}-${index}`}
                  className={isUser ? "ml-8 max-w-[85%] self-end" : "mr-8 max-w-[85%]"}
                >
                  <div
                    className={
                      isUser
                        ? "overflow-hidden rounded-2xl bg-navy text-cream"
                        : "overflow-hidden rounded-2xl border border-line bg-white text-charcoal"
                    }
                  >
                    {src && (
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => item.photoStatus !== "uploading" && setLightboxSrc(src)}
                        disabled={item.photoStatus === "uploading"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt="Foto enviada"
                          className="h-auto max-h-44 w-full max-w-[min(100%,20rem)] object-cover md:max-h-48"
                        />
                      </button>
                    )}
                    {item.photoStatus === "uploading" && (
                      <p className="px-4 py-2 text-xs text-cream/75">Enviando foto...</p>
                    )}
                    {item.photoStatus === "failed" && (
                      <p className="px-4 py-2 text-xs text-accent">No pudimos enviar esta foto.</p>
                    )}
                    {item.body && (
                      <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6">{item.body}</p>
                    )}
                  </div>
                </div>
              );
            })}
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
          </div>
          {historicalChips.length > 0 && (
            <div className="px-4 pb-2">
              <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">Horarios anteriores</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {historicalChips.map((chip) => (
                  <span
                    key={chip}
                    className="min-h-11 rounded-full border border-mist/30 bg-cream-deep px-3 py-2.5 text-xs text-mist line-through opacity-70"
                    aria-disabled="true"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          )}
          {showResumeBooking && !bookingExpanded && !ended && (
            <div className="border-t border-line bg-white px-4 py-2">
              <button
                type="button"
                className="min-h-11 w-full rounded-lg border border-navy/15 px-3 text-left text-xs text-navy"
                onClick={() => setBookingExpanded(true)}
              >
                Cita pendiente · Ver horarios
              </button>
            </div>
          )}
          {bookingExpanded && slotGroups.length > 0 && !ended && (
            <div className="space-y-2 border-t border-line bg-white px-4 py-2" aria-live="polite">
              {slotGroups.map((group) => (
                <div key={group.date}>
                  <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">{group.dateLabel}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.times.map((time) => (
                      <button
                        key={`${group.date}-${time.time}`}
                        type="button"
                        className="min-h-11 rounded-full border border-navy/20 px-3 text-xs text-navy"
                        onClick={() => void sendMessage(`Me sirve ${time.label}`)}
                      >
                        {time.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {bookingExpanded && slotGroups.length === 0 && chips.length > 0 && !ended && (
            <div className="flex flex-wrap gap-2 px-4 pb-2" aria-live="polite">
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
            <>
              {pendingPhoto && (
                <div className="border-t border-line bg-white px-4 py-3">
                  <div className="flex items-start gap-3 rounded-xl border border-line bg-cream-deep p-3">
                    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-line bg-white md:h-32 md:w-32">
                      {pendingPhoto.preparing ? (
                        <div className="flex h-full items-center justify-center px-2 text-center text-xs text-mist">
                          Preparando foto...
                        </div>
                      ) : pendingPhoto.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pendingPhoto.previewUrl}
                          alt="Vista previa"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center px-2 text-center text-xs text-mist">
                          {pendingPhoto.name}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-charcoal">{pendingPhoto.name}</p>
                      <button
                        type="button"
                        className="mt-2 min-h-11 text-xs text-accent"
                        onClick={clearPendingPhoto}
                      >
                        × Quitar imagen
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {photoError && (
                <p className="px-4 pb-1 text-xs text-accent" role="alert">
                  {photoError}
                </p>
              )}
              <form
                className="flex items-end gap-2 border-t border-line bg-white px-3 py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitComposer();
                }}
              >
                <button
                  type="button"
                  className="min-h-11 min-w-11 rounded-lg text-navy"
                  aria-label="Adjuntar foto"
                  disabled={pending || Boolean(pendingPhoto?.preparing)}
                  onClick={() => fileRef.current?.click()}
                >
                  +
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onFileSelected(file);
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
                    void submitComposer();
                  }}
                  placeholder="Cuéntame qué necesitas"
                  className="max-h-28 min-h-11 flex-1 resize-none bg-transparent py-2 text-sm outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="min-h-11 rounded-lg bg-accent px-3 text-xs tracking-[0.12em] uppercase text-white disabled:opacity-50"
                >
                  {pending ? "Enviando" : "Enviar"}
                </button>
              </form>
            </>
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
