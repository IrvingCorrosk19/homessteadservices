"use client";

import { formatAppointmentClock, formatAppointmentDay } from "@/lib/appointment-time";
import type { CalendarItem } from "@/components/admin/AppointmentCalendar";
import { customerDisplay } from "@/components/admin/calendar/AppointmentCard";

type RescheduleModalProps = {
  item: CalendarItem;
  newDate: string;
  newTime: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RescheduleModal({ item, newDate, newTime, busy, onCancel, onConfirm }: RescheduleModalProps) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-navy/35 p-4 md:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hs-reschedule-title"
        className="w-full max-w-md rounded-[28px] border border-navy/10 bg-white p-6 shadow-[0_24px_60px_rgba(31,51,68,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[0.68rem] tracking-[0.18em] uppercase text-accent">Reprogramar cita</p>
        <h2 id="hs-reschedule-title" className="mt-1 font-display text-2xl text-navy">
          {item.serviceLabel}
        </h2>
        <p className="mt-1 text-sm text-mist">Cliente: {customerDisplay(item)}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-navy/8 bg-cream-deep/40 p-4">
            <p className="text-[0.62rem] tracking-[0.14em] uppercase text-mist">Antes</p>
            <p className="mt-2 text-sm font-medium text-navy">{formatAppointmentDay(item.date)}</p>
            <p className="text-sm text-charcoal">{formatAppointmentClock(item.startTime)}</p>
          </div>
          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
            <p className="text-[0.62rem] tracking-[0.14em] uppercase text-accent">Nueva fecha</p>
            <p className="mt-2 text-sm font-medium text-navy">{formatAppointmentDay(newDate)}</p>
            <p className="text-sm text-charcoal">{formatAppointmentClock(newTime)}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl border border-navy/15 px-5 text-xs tracking-[0.12em] uppercase disabled:opacity-50"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl bg-navy px-5 text-xs tracking-[0.12em] uppercase text-cream disabled:opacity-50"
            onClick={onConfirm}
          >
            {busy ? "Reprogramando…" : "Confirmar reprogramación"}
          </button>
        </div>
      </section>
    </div>
  );
}
