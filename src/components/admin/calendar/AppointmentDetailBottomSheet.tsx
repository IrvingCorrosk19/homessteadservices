"use client";

import { useEffect, useId, useRef, useState } from "react";

const SHEET_MQ = "(max-width: 1279px)";

/** Tailwind `xl` breakpoint — bottom sheet is only shown below this width. */
export function useMobileSheetViewport() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(SHEET_MQ);
    const update = () => setActive(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return active;
}

type AppointmentDetailBottomSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function AppointmentDetailBottomSheet({ open, title, onClose, children }: AppointmentDetailBottomSheetProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia(SHEET_MQ);
    let previous = document.body.style.overflow;

    const lockIfSheetVisible = () => {
      if (!mq.matches) {
        document.body.style.overflow = previous;
        return;
      }
      previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      closeRef.current?.focus({ preventScroll: true });
    };

    lockIfSheetVisible();
    mq.addEventListener("change", lockIfSheetVisible);
    return () => {
      mq.removeEventListener("change", lockIfSheetVisible);
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] xl:hidden" aria-hidden={false}>
      <button
        type="button"
        className="absolute inset-0 bg-navy/40 backdrop-blur-[1px] transition-opacity"
        aria-label="Cerrar detalle"
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute bottom-0 left-0 right-0 flex max-h-[70vh] min-h-[55vh] flex-col rounded-t-[28px] border border-navy/10 bg-white shadow-[0_-20px_60px_rgba(31,51,68,0.18)] motion-safe:animate-[hsSheetUp_0.28s_ease-out] pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-3">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-navy/15" aria-hidden />
        </div>
        <div className="flex shrink-0 items-center justify-between border-b border-navy/8 px-5 py-3">
          <p id={titleId} className="font-display text-lg text-navy">
            {title}
          </p>
          <button
            ref={closeRef}
            type="button"
            className="min-h-11 min-w-11 rounded-full border border-navy/10 text-lg leading-none text-navy"
            aria-label="Cerrar detalle de cita"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      </section>
    </div>
  );
}
