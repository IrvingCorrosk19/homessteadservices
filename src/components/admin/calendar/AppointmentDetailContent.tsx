"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentClock,
  formatAppointmentDay,
  type AppointmentStatus,
} from "@/lib/appointment-time";
import type { CalendarItem } from "@/components/admin/AppointmentCalendar";
import { customerDisplay } from "@/components/admin/calendar/AppointmentCard";

type AppointmentDetailContentProps = {
  item: CalendarItem;
  busy: string;
  reschedule: { date: string; time: string };
  mobile?: boolean;
  showRescheduleFields: boolean;
  onRescheduleChange: (next: { date: string; time: string }) => void;
  onToggleReschedule: () => void;
  onConfirm: () => void;
  onCancelAppointment: () => void;
  onComplete: () => void;
  onRescheduleSubmit: () => void;
};

export function AppointmentDetailContent({
  item,
  busy,
  reschedule,
  mobile = false,
  showRescheduleFields,
  onRescheduleChange,
  onToggleReschedule,
  onConfirm,
  onCancelAppointment,
  onComplete,
  onRescheduleSubmit,
}: AppointmentDetailContentProps) {
  const statusLabel = APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatus] || item.status;
  const customer = item.customerName?.trim() || customerDisplay(item);
  const canEdit = !["CANCELLED", "COMPLETED"].includes(item.status);
  const contactHref = item.phone ? `tel:${item.phone.replace(/[^\d+]/g, "")}` : "";
  const whatsappHref = item.phone ? `https://wa.me/${item.phone.replace(/\D/g, "")}` : "";

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl text-navy md:text-3xl">{item.serviceLabel}</h2>
        </div>
        <span className="shrink-0 rounded-full border border-navy/10 bg-cream-deep px-3 py-1 text-[0.62rem] font-medium uppercase tracking-[0.1em] text-navy">
          {statusLabel}
        </span>
      </div>

      <dl className={`mt-4 grid gap-3 text-sm ${mobile ? "grid-cols-1" : ""}`}>
        <DetailRow label="Cliente" value={customer} prominent={mobile} />
        <DetailRow label="Fecha" value={formatAppointmentDay(item.date)} prominent={mobile} />
        <DetailRow label="Hora" value={formatAppointmentClock(item.startTime)} prominent={mobile} />
        {item.phone ? <DetailRow label="Teléfono" value={item.phone} prominent={mobile} /> : null}
        {!mobile ? (
          <>
            <DetailRow label="Folio" value={<Link className="text-accent underline-offset-2 hover:underline" href={`/admin/solicitudes/${item.leadId}`}>{item.leadId}</Link>} />
            <DetailRow label="Origen" value={item.originLabel || "Homestead"} />
            <DetailRow label="Zona" value={item.zone || "Por confirmar"} />
            {item.email ? <DetailRow label="Email" value={item.email} /> : null}
            {item.assignedTo ? <DetailRow label="Responsable" value={item.assignedTo} /> : null}
            {item.problem ? <DetailRow label="Problema" value={item.problem.slice(0, 280)} /> : null}
            {item.notes ? <DetailRow label="Notas" value={item.notes.slice(0, 280)} /> : null}
            {item.quoteId ? <DetailRow label="Cotización" value={item.quoteId} /> : null}
          </>
        ) : null}
      </dl>

      {mobile ? (
        <div className="mt-4 space-y-2 border-t border-navy/8 pt-4 text-sm">
          <DetailRow label="Folio" value={<Link className="text-accent" href={`/admin/solicitudes/${item.leadId}`}>{item.leadId}</Link>} />
          <DetailRow label="Origen" value={item.originLabel || "Homestead"} />
          {item.zone ? <DetailRow label="Zona" value={item.zone} /> : null}
          {item.problem ? <DetailRow label="Problema" value={item.problem.slice(0, 280)} /> : null}
          {item.notes ? <DetailRow label="Notas" value={item.notes.slice(0, 280)} /> : null}
          {item.quoteId ? <DetailRow label="Cotización" value={item.quoteId} /> : null}
        </div>
      ) : null}

      <div className="mt-5 grid gap-2">
        {mobile && canEdit ? (
          <div className="grid grid-cols-2 gap-2">
            {contactHref ? (
              <a className="min-h-12 rounded-xl bg-navy px-3 py-3 text-center text-xs tracking-[0.12em] uppercase text-cream" href={contactHref}>
                Contactar
              </a>
            ) : (
              <span className="min-h-12 rounded-xl border border-navy/10 px-3 py-3 text-center text-xs text-mist">Sin teléfono</span>
            )}
            <button
              type="button"
              disabled={Boolean(busy)}
              className="min-h-12 rounded-xl border border-navy/15 px-3 text-xs tracking-[0.12em] uppercase disabled:opacity-50"
              onClick={onToggleReschedule}
            >
              Reprogramar
            </button>
          </div>
        ) : null}

        {!mobile && item.phone ? (
          <a className="min-h-11 rounded-xl border border-navy/15 px-3 py-3 text-center text-xs tracking-[0.12em] uppercase" href={contactHref}>
            📞 Llamar
          </a>
        ) : null}
        {!mobile && whatsappHref ? (
          <a className="min-h-11 rounded-xl border border-navy/15 px-3 py-3 text-center text-xs tracking-[0.12em] uppercase" href={whatsappHref} target="_blank" rel="noopener noreferrer">
            💬 WhatsApp
          </a>
        ) : null}
        {!mobile && item.email ? (
          <a className="min-h-11 rounded-xl border border-navy/15 px-3 py-3 text-center text-xs tracking-[0.12em] uppercase" href={`mailto:${item.email}`}>
            ✉️ Email
          </a>
        ) : null}

        {["REQUESTED", "PROPOSED"].includes(item.status) ? (
          <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl bg-navy text-xs tracking-[0.12em] uppercase text-cream disabled:opacity-50" onClick={onConfirm}>
            Confirmar
          </button>
        ) : null}

        {canEdit && !mobile ? (
          <>
            <label className="text-xs text-mist" htmlFor="hs-reschedule-date">Reprogramar</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                id="hs-reschedule-date"
                type="date"
                className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm"
                value={reschedule.date || item.date}
                onChange={(event) => onRescheduleChange({ ...reschedule, date: event.target.value })}
              />
              <input
                type="time"
                aria-label="Nueva hora"
                className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm"
                value={reschedule.time || item.startTime}
                onChange={(event) => onRescheduleChange({ ...reschedule, time: event.target.value })}
              />
            </div>
            <button
              type="button"
              disabled={Boolean(busy)}
              className="min-h-11 rounded-xl border border-navy/15 text-xs tracking-[0.12em] uppercase disabled:opacity-50"
              onClick={onRescheduleSubmit}
            >
              Reprogramar
            </button>
            <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl border border-navy/15 text-xs tracking-[0.12em] uppercase disabled:opacity-50" onClick={onComplete}>
              Completar
            </button>
            <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl text-xs tracking-[0.12em] uppercase text-accent disabled:opacity-50" onClick={onCancelAppointment}>
              Cancelar cita
            </button>
          </>
        ) : null}

        {canEdit && mobile && showRescheduleFields ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <input
                id="hs-reschedule-date-mobile"
                type="date"
                className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm"
                value={reschedule.date || item.date}
                onChange={(event) => onRescheduleChange({ ...reschedule, date: event.target.value })}
              />
              <input
                type="time"
                aria-label="Nueva hora"
                className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm"
                value={reschedule.time || item.startTime}
                onChange={(event) => onRescheduleChange({ ...reschedule, time: event.target.value })}
              />
            </div>
            <button
              type="button"
              disabled={Boolean(busy)}
              className="min-h-11 rounded-xl bg-navy text-xs tracking-[0.12em] uppercase text-cream disabled:opacity-50"
              onClick={onRescheduleSubmit}
            >
              Confirmar reprogramación
            </button>
            <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl border border-navy/15 text-xs tracking-[0.12em] uppercase disabled:opacity-50" onClick={onComplete}>
              Completar
            </button>
            <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl text-xs tracking-[0.12em] uppercase text-accent disabled:opacity-50" onClick={onCancelAppointment}>
              Cancelar cita
            </button>
          </>
        ) : null}

        {mobile && whatsappHref ? (
          <a className="min-h-11 rounded-xl border border-navy/15 px-3 py-3 text-center text-xs tracking-[0.12em] uppercase" href={whatsappHref} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
        ) : null}
        {mobile ? (
          <Link className="min-h-11 rounded-xl border border-navy/15 px-3 py-3 text-center text-xs tracking-[0.12em] uppercase" href={`/admin/solicitudes/${item.leadId}`}>
            Ver solicitud
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: ReactNode;
  prominent?: boolean;
}) {
  return (
    <div className={prominent ? "rounded-xl border border-navy/8 bg-cream-deep/30 px-3 py-2" : ""}>
      <dt className="text-[0.62rem] tracking-[0.12em] uppercase text-mist">{label}</dt>
      <dd className={`mt-0.5 min-w-0 break-words ${prominent ? "text-base font-medium text-navy" : "text-charcoal"}`}>{value}</dd>
    </div>
  );
}
