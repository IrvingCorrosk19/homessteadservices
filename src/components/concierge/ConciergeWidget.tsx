"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareConciergePhoto, revokePreparedPhoto } from "@/lib/concierge-client-photo";
import { assistantRequestsPhoto } from "@/lib/concierge-photo-cta";
import { CameraIcon, ImageIcon, TrashIcon } from "@/components/concierge/ConciergePhotoIcons";

type ChatMessage = {
  role: "user" | "assistant";
  body: string;
  photoId?: string;
  photoIds?: string[];
  photoPreviewUrl?: string;
  photoPreviewUrls?: string[];
  photoStatus?: "uploading" | "sent" | "failed";
  localKey?: string;
};

type PendingPhoto = {
  id: string;
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
const CHAT_MINIMIZED_KEY = "hs_concierge_minimized_v1";
const STICK_THRESHOLD_PX = 80;
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

function photoSrc(photoId?: string, previewUrl?: string) {
  if (previewUrl) return previewUrl;
  if (photoId) return `/api/concierge/photos/${encodeURIComponent(photoId)}`;
  return "";
}

function newPendingId() {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      setMobile(window.innerWidth < 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return mobile;
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
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [replacePhotoId, setReplacePhotoId] = useState<string | null>(null);
  const [showPhotoCta, setShowPhotoCta] = useState(false);
  const [photosRemaining, setPhotosRemaining] = useState(4);
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
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const photoMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef(false);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const replacePhotoIdRef = useRef<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [historicalExpanded, setHistoricalExpanded] = useState(false);
  const isMobile = useIsMobile();
  const scrollPositionRef = useRef(0);
  const prevContentSigRef = useRef("");
  const minimizeChatRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((photo) => revokePreparedPhoto(photo.previewUrl));
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
    setShowPhotoCta(Boolean(data.showPhotoCta));
    setPhotosRemaining(typeof data.photosRemaining === "number" ? data.photosRemaining : 4);
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

  const scrollToBottom = useCallback((smooth = false) => {
    const node = scroller.current;
    if (!node) return;
    if (smooth) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    } else {
      node.scrollTop = node.scrollHeight;
    }
  }, []);

  const updateStickFromScroll = useCallback((node: HTMLDivElement) => {
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < STICK_THRESHOLD_PX;
    stick.current = atBottom;
    scrollPositionRef.current = node.scrollTop;
    if (atBottom) setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        minimizeChatRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    const node = scroller.current;
    if (!node) return;
    if (stick.current) {
      scrollToBottom(false);
    } else {
      node.scrollTop = scrollPositionRef.current;
    }
  }, [open, scrollToBottom]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !open) return;
    const sig = [
      messages.length,
      pending ? 1 : 0,
      pendingPhotos.length,
      slotGroups.length,
      chips.length,
      historicalChips.length,
      historicalExpanded ? 1 : 0,
      bookingExpanded ? 1 : 0,
    ].join(":");
    const changed = sig !== prevContentSigRef.current;
    prevContentSigRef.current = sig;
    if (!changed) return;
    if (stick.current) {
      scrollToBottom(false);
      setShowJumpToBottom(false);
    } else {
      setShowJumpToBottom(true);
    }
  }, [
    messages,
    pending,
    open,
    pendingPhotos,
    slotGroups,
    chips,
    historicalChips,
    historicalExpanded,
    bookingExpanded,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (!photoMenuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = photoMenuRef.current;
      if (node && !node.contains(event.target as Node)) setPhotoMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [photoMenuOpen]);

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
    stick.current = true;
    setShowJumpToBottom(false);
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

  const clearPendingPhotos = useCallback(() => {
    setPendingPhotos((current) => {
      current.forEach((photo) => revokePreparedPhoto(photo.previewUrl));
      return [];
    });
    setPhotoError(null);
    setReplacePhotoId(null);
  }, []);

  const removePendingPhoto = useCallback((id: string) => {
    setPendingPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) revokePreparedPhoto(target.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
    setPhotoError(null);
  }, []);

  const contextualPhotoCta = useMemo(() => {
    if (showPhotoCta) return true;
    const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    return lastAssistant ? assistantRequestsPhoto(lastAssistant.body) : false;
  }, [messages, showPhotoCta]);

  const pendingPreparing = pendingPhotos.some((photo) => photo.preparing);
  const slotsLeftForPending = Math.max(0, photosRemaining - pendingPhotos.length);

  const uploadPhotoTurn = useCallback(async (photos: PendingPhoto[], caption: string, localKey: string) => {
    const uploadedIds: string[] = [];
    for (const photo of photos) {
      const form = new FormData();
      form.append("photo", photo.file);
      const upload = await fetch("/api/concierge/photo", { method: "POST", body: form });
      const uploaded = await upload.json();
      if (!upload.ok || !uploaded.ok) {
        throw new Error(typeof uploaded.message === "string" ? uploaded.message : "upload_failed");
      }
      uploadedIds.push(String(uploaded.photoId || ""));
      revokePreparedPhoto(photo.previewUrl);
    }

    setMessages((current) =>
      current.map((item) =>
        item.localKey === localKey
          ? {
              ...item,
              photoId: uploadedIds[0],
              photoIds: uploadedIds,
              photoStatus: "sent",
              photoPreviewUrl: undefined,
              photoPreviewUrls: undefined,
            }
          : item,
      ),
    );

    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        body: "Revisando foto...",
        localKey: `review-${localKey}`,
      },
    ]);

    const ai = await fetch("/api/concierge/photo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: caption || "Comparto esta foto para orientar el servicio." }),
    });
    const data = await ai.json();
    setMessages((current) => current.filter((item) => item.localKey !== `review-${localKey}`));
    if (!ai.ok || !data.ok) throw new Error("turn_failed");
    applyTurnResponse(data);
  }, [applyTurnResponse]);

  const submitComposer = useCallback(async () => {
    const caption = input.trim();
    const photos = pendingPhotos.filter((photo) => !photo.preparing && photo.previewUrl);
    if ((!caption && !photos.length) || pendingRef.current || ended) return;

    if (photos.length) {
      pendingRef.current = true;
      setPending(true);
      setSendError(false);
      setPhotoError(null);
      setWhatsapp(null);
      setChips([]);
      stick.current = true;
      setShowJumpToBottom(false);
      const localKey = `photo-${Date.now()}`;
      const snapshot = photos;
      setMessages((current) => [
        ...current,
        {
          role: "user",
          body: caption,
          photoPreviewUrls: snapshot.map((photo) => photo.previewUrl),
          photoStatus: "uploading",
          localKey,
        },
      ]);
      setInput("");
      clearPendingPhotos();
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
  }, [clearPendingPhotos, ended, input, pendingPhotos, sendMessage, uploadPhotoTurn]);

  const onFileSelected = useCallback(async (file: File, replaceId: string | null) => {
    setPhotoError(null);
    const id = replaceId || newPendingId();
    const placeholder: PendingPhoto = { id, file, previewUrl: "", name: file.name, preparing: true };

    setPendingPhotos((current) => {
      if (replaceId) {
        const previous = current.find((photo) => photo.id === replaceId);
        if (previous) revokePreparedPhoto(previous.previewUrl);
        return current.map((photo) => (photo.id === replaceId ? placeholder : photo));
      }
      if (current.length >= photosRemaining) return current;
      return [...current, placeholder];
    });
    setReplacePhotoId(null);
    replacePhotoIdRef.current = null;
    setPhotoMenuOpen(false);

    try {
      const prepared = await prepareConciergePhoto(file);
      setPendingPhotos((current) =>
        current.map((photo) =>
          photo.id === id
            ? {
                id,
                file: prepared.file,
                previewUrl: prepared.previewUrl,
                name: file.name,
                preparing: false,
              }
            : photo,
        ),
      );
    } catch {
      setPhotoError("No pudimos leer esta imagen. Prueba con otra foto.");
      setPendingPhotos((current) => current.filter((photo) => photo.id !== id));
    }
  }, [photosRemaining]);

  const openCameraPicker = useCallback(() => {
    replacePhotoIdRef.current = null;
    setReplacePhotoId(null);
    cameraRef.current?.click();
  }, []);

  const openGalleryPicker = useCallback(() => {
    replacePhotoIdRef.current = null;
    setReplacePhotoId(null);
    galleryRef.current?.click();
  }, []);

  useEffect(() => {
    replacePhotoIdRef.current = replacePhotoId;
  }, [replacePhotoId]);

  function openChat() {
    sessionStorage.setItem(GREET_KEY, "1");
    sessionStorage.setItem(CHAT_OPEN_KEY, "1");
    sessionStorage.removeItem(CHAT_MINIMIZED_KEY);
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
    if (scroller.current) scrollPositionRef.current = scroller.current.scrollTop;
    setOpen(false);
    sessionStorage.setItem(CHAT_OPEN_KEY, "0");
    sessionStorage.removeItem(CHAT_MINIMIZED_KEY);
  }

  function minimizeChat() {
    if (scroller.current) scrollPositionRef.current = scroller.current.scrollTop;
    setOpen(false);
    sessionStorage.setItem(CHAT_OPEN_KEY, "1");
    sessionStorage.setItem(CHAT_MINIMIZED_KEY, "1");
  }

  minimizeChatRef.current = minimizeChat;

  const canSend = Boolean((input.trim() || pendingPhotos.some((p) => p.previewUrl && !p.preparing)) && !pending && !ended && !pendingPreparing);

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
          className="pointer-events-auto flex h-[min(760px,calc(100dvh-2.5rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-cream shadow-[0_24px_60px_rgba(31,51,68,0.22)] max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-full max-md:rounded-none"
          style={{
            paddingTop: isMobile ? "env(safe-area-inset-top)" : undefined,
            paddingBottom: keyboardPad ? keyboardPad : isMobile ? "env(safe-area-inset-bottom)" : undefined,
          }}
          role="dialog"
          aria-label="Asistente de servicios Homestead"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-navy/20 bg-navy px-5 py-4 text-cream">
            <div className="min-w-0">
              <p className="font-display text-xl">Homestead Services</p>
              <p className="mt-1 text-xs tracking-[0.12em] uppercase text-cream/70">Asesor de servicios</p>
              {serviceContext && (
                <p className="mt-1 truncate text-xs text-cream/75">{serviceContext}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg leading-none text-cream/85 hover:bg-cream/10 hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
                aria-label="Minimizar chat"
                title="Minimizar"
                onClick={minimizeChat}
              >
                —
              </button>
              <button
                type="button"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg leading-none text-cream/85 hover:bg-cream/10 hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
                aria-label="Cerrar chat"
                title="Cerrar"
                onClick={closeChat}
              >
                ✕
              </button>
            </div>
          </header>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scroller}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 [scrollbar-gutter:stable]"
              onScroll={(event) => updateStickFromScroll(event.currentTarget)}
            >
              <div className="flex flex-col gap-3">
            {messages.map((item, index) => {
              const previewUrls = item.photoPreviewUrls?.length
                ? item.photoPreviewUrls
                : item.photoPreviewUrl
                  ? [item.photoPreviewUrl]
                  : [];
              const sentIds = item.photoIds?.length
                ? item.photoIds
                : item.photoId
                  ? [item.photoId]
                  : [];
              const imageSources = previewUrls.length
                ? previewUrls
                : sentIds.map((id) => photoSrc(id));
              const isUser = item.role === "user";
              return (
                <div
                  key={item.localKey || `${item.role}-${index}`}
                  className={isUser ? "ml-auto max-w-[85%]" : "mr-auto max-w-[85%]"}
                >
                  <div
                    className={
                      isUser
                        ? "overflow-hidden rounded-2xl bg-navy text-cream"
                        : "overflow-hidden rounded-2xl border border-line bg-white text-charcoal"
                    }
                  >
                    {imageSources.length > 0 && (
                      <div className={`grid gap-0.5 ${imageSources.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {imageSources.map((src, photoIndex) => (
                          <button
                            key={`${src}-${photoIndex}`}
                            type="button"
                            className="block w-full"
                            onClick={() => item.photoStatus !== "uploading" && setLightboxSrc(src)}
                            disabled={item.photoStatus === "uploading"}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt="Foto enviada"
                              className="h-auto max-h-36 w-full object-cover md:max-h-44"
                              onLoad={() => {
                                if (stick.current) scrollToBottom(false);
                              }}
                            />
                          </button>
                        ))}
                      </div>
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
              <p className="mr-auto max-w-[85%] flex items-center gap-1 rounded-2xl border border-line bg-white px-4 py-3" aria-live="polite" aria-label="Escribiendo">
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
            {historicalChips.length > 0 && (
              <div className="border-t border-line/70 pt-3">
                {!historicalExpanded ? (
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-lg border border-mist/25 bg-cream-deep/80 px-3 text-left text-xs text-mist"
                    onClick={() => setHistoricalExpanded(true)}
                  >
                    Horarios anteriores ({historicalChips.length}) · Ver
                  </button>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="mb-2 text-[0.65rem] tracking-[0.12em] uppercase text-mist underline-offset-2 hover:underline"
                      onClick={() => setHistoricalExpanded(false)}
                    >
                      Ocultar horarios anteriores
                    </button>
                    <p className="text-[0.65rem] tracking-[0.12em] uppercase text-mist">Horarios anteriores</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {historicalChips.map((chip) => (
                        <span
                          key={chip}
                          className="min-h-9 rounded-full border border-mist/30 bg-cream-deep px-3 py-2 text-xs text-mist line-through opacity-70"
                          aria-disabled="true"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
              </div>
            </div>
            {showJumpToBottom && (
              <button
                type="button"
                className="pointer-events-auto absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-navy/15 bg-white px-4 py-2 text-xs text-navy shadow-[0_8px_24px_rgba(31,51,68,0.14)] hover:bg-cream-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
                aria-label="Ir al mensaje más reciente"
                onClick={() => {
                  stick.current = true;
                  scrollToBottom(true);
                  setShowJumpToBottom(false);
                }}
              >
                ↓ Nuevo mensaje
              </button>
            )}
          </div>
          <footer className="shrink-0 border-t border-line bg-white">
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
          {contextualPhotoCta && !ended && pendingPhotos.length === 0 && slotsLeftForPending > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-line bg-white px-4 py-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-navy/20 px-3 text-xs text-navy"
                onClick={openCameraPicker}
              >
                <CameraIcon className="h-4 w-4" />
                {isMobile ? "Tomar foto" : "Tomar foto"}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-navy/20 px-3 text-xs text-navy"
                onClick={openGalleryPicker}
              >
                <ImageIcon className="h-4 w-4" />
                {isMobile ? "Elegir de galería" : "Adjuntar imagen"}
              </button>
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
              {pendingPhotos.length > 0 && (
                <div className="border-t border-line bg-white px-4 py-3">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {pendingPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        className="relative h-[7.5rem] w-[7.5rem] shrink-0 overflow-hidden rounded-lg border border-line bg-cream-deep md:h-36 md:w-36"
                      >
                        {photo.preparing ? (
                          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-mist">
                            Preparando foto...
                          </div>
                        ) : photo.previewUrl ? (
                          <button
                            type="button"
                            className="block h-full w-full"
                            aria-label="Ampliar fotografía"
                            onClick={() => setLightboxSrc(photo.previewUrl)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.previewUrl}
                              alt="Vista previa"
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-mist">
                            {photo.name}
                          </div>
                        )}
                        {!photo.preparing && (
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-navy/70 px-2 py-1">
                            <button
                              type="button"
                              className="min-h-8 text-[0.65rem] text-cream"
                              aria-label="Cambiar fotografía"
                              onClick={() => {
                                replacePhotoIdRef.current = photo.id;
                                setReplacePhotoId(photo.id);
                                setPhotoMenuOpen(true);
                              }}
                            >
                              Cambiar
                            </button>
                            <button
                              type="button"
                              className="min-h-8 min-w-8 text-cream"
                              aria-label="Eliminar fotografía"
                              onClick={() => removePendingPhoto(photo.id)}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {slotsLeftForPending > 0 && pendingPhotos.every((photo) => !photo.preparing) && (
                    <button
                      type="button"
                      className="mt-2 min-h-11 text-xs text-navy"
                      onClick={() => setPhotoMenuOpen(true)}
                    >
                      + Agregar otra foto
                    </button>
                  )}
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
                <div className="relative shrink-0" ref={photoMenuRef}>
                  <button
                    type="button"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-navy hover:bg-cream-deep"
                    aria-label="Enviar fotografía"
                    title="Enviar foto"
                    disabled={pending || pendingPreparing || slotsLeftForPending <= 0}
                    onClick={() => setPhotoMenuOpen((open) => !open)}
                  >
                    <CameraIcon />
                  </button>
                  {photoMenuOpen && (
                    <div
                      className="absolute bottom-full left-0 z-20 mb-2 min-w-[12.5rem] overflow-hidden rounded-xl border border-line bg-white py-1 shadow-[0_12px_32px_rgba(31,51,68,0.18)]"
                      role="menu"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full min-h-11 items-center gap-3 px-4 text-left text-sm text-charcoal hover:bg-cream-deep"
                        onClick={openCameraPicker}
                      >
                        <CameraIcon className="h-4 w-4 shrink-0" />
                        {isMobile ? "Tomar una foto" : "Tomar foto"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full min-h-11 items-center gap-3 px-4 text-left text-sm text-charcoal hover:bg-cream-deep"
                        onClick={openGalleryPicker}
                      >
                        <ImageIcon className="h-4 w-4 shrink-0" />
                        {isMobile ? "Elegir una fotografía" : "Adjuntar imagen"}
                      </button>
                    </div>
                  )}
                </div>
                <input
                  ref={cameraRef}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  capture="environment"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onFileSelected(file, replacePhotoIdRef.current);
                    event.target.value = "";
                  }}
                />
                <input
                  ref={galleryRef}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onFileSelected(file, replacePhotoIdRef.current);
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
                  placeholder={pendingPhotos.length ? "Añade un mensaje..." : "Cuéntame qué necesitas"}
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
          </footer>
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
