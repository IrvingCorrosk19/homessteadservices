"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  businessYmd,
  formatAppointmentClock,
  formatAppointmentDay,
  type AppointmentStatus,
} from "@/lib/appointment-time";

export type CalendarItem = {
  appointmentId: string;
  leadId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  service: string;
  serviceLabel: string;
  customerName: string;
  customerFirst: string;
  zone: string;
  assignedTo: string;
  conversationId: string;
  quoteId: string;
  problem: string;
  phone: string;
  notes: string;
};

type View = "month" | "week" | "day";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function addDays(ymd: string, days: number) {
  const utc = Date.parse(`${ymd}T12:00:00Z`) + days * 86400000;
  return new Date(utc).toISOString().slice(0, 10);
}

function startOfWeek(ymd: string) {
  const date = new Date(`${ymd}T12:00:00Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(ymd, offset);
}

function startOfMonth(ymd: string) {
  return `${ymd.slice(0, 7)}-01`;
}

function monthGrid(ymd: string) {
  const start = startOfWeek(startOfMonth(ymd));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function statusClass(status: string) {
  if (status === "CONFIRMED") return "border-navy bg-navy text-cream";
  if (status === "RESCHEDULED") return "border-accent bg-accent/15 text-navy";
  if (status === "PROPOSED" || status === "REQUESTED") return "border-navy/20 bg-white text-navy";
  if (status === "CANCELLED") return "border-mist/40 bg-cream-deep text-mist line-through";
  if (status === "COMPLETED") return "border-navy/20 bg-cream-deep text-navy-soft";
  return "border-line bg-white text-charcoal";
}

export function AppointmentCalendar({
  appointments,
  selectedId,
}: {
  appointments: CalendarItem[];
  selectedId?: string;
}) {
  const today = businessYmd();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(selectedId ? appointments.find((item) => item.appointmentId === selectedId)?.date || today : today);
  const [status, setStatus] = useState("ALL");
  const [service, setService] = useState("ALL");
  const [openId, setOpenId] = useState(selectedId || "");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [reschedule, setReschedule] = useState({ date: "", time: "" });
  const [items, setItems] = useState(appointments);

  const services = useMemo(
    () => Array.from(new Set(items.map((item) => item.service).filter(Boolean))),
    [items],
  );
  const filtered = items.filter((item) => {
    if (status !== "ALL" && item.status !== status) return false;
    if (service !== "ALL" && item.service !== service) return false;
    return true;
  });
  const open = items.find((item) => item.appointmentId === openId) || null;

  const days = view === "month" ? monthGrid(cursor) : view === "week" ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index)) : [cursor];

  async function mutate(action: string, payload: Record<string, string> = {}) {
    if (!open) return;
    setBusy(action);
    setNotice("");
    const response = await fetch(`/api/admin/appointments/${open.appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setNotice("No se pudo actualizar la cita.");
      return;
    }
    if (data.appointment) {
      setItems((current) => current.map((item) => (item.appointmentId === data.appointment.appointmentId ? { ...item, ...data.appointment } : item)));
    }
    setNotice("Cita actualizada.");
  }

  function shift(direction: number) {
    if (view === "month") setCursor(addDays(startOfMonth(cursor), direction * 32).slice(0, 7) + "-01");
    else if (view === "week") setCursor(addDays(cursor, direction * 7));
    else setCursor(addDays(cursor, direction));
  }

  const upcoming = filtered
    .filter((item) => item.date >= today && !["CANCELLED", "COMPLETED"].includes(item.status))
    .slice(0, 12);

  const groupedUpcoming = {
    today: upcoming.filter((item) => item.date === today),
    tomorrow: upcoming.filter((item) => item.date === addDays(today, 1)),
    week: upcoming.filter((item) => item.date > addDays(today, 1) && item.date <= addDays(today, 7)),
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 rounded-[28px] border border-navy/8 bg-white p-4 shadow-[0_18px_40px_rgba(31,51,68,0.06)] md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.68rem] tracking-[0.18em] uppercase text-accent">Calendario operativo</p>
            <h1 className="mt-1 font-display text-3xl text-navy md:text-4xl">Citas</h1>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Vista del calendario">
            {(["month", "week", "day"] as View[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={view === item}
                className={`min-h-11 rounded-full px-4 text-xs tracking-[0.14em] uppercase ${view === item ? "bg-navy text-cream" : "border border-navy/15 text-navy"}`}
                onClick={() => setView(item)}
              >
                {item === "month" ? "Mes" : item === "week" ? "Semana" : "Día"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" className="min-h-11 min-w-11 rounded-lg border border-navy/15" aria-label="Periodo anterior" onClick={() => shift(-1)}>
            ‹
          </button>
          <p className="min-w-40 text-center font-display text-xl text-navy">{formatAppointmentDay(cursor)}</p>
          <button type="button" className="min-h-11 min-w-11 rounded-lg border border-navy/15" aria-label="Periodo siguiente" onClick={() => shift(1)}>
            ›
          </button>
          <button type="button" className="min-h-11 rounded-lg px-3 text-xs tracking-[0.12em] uppercase text-accent" onClick={() => setCursor(today)}>
            Hoy
          </button>
          <label className="sr-only" htmlFor="hs-cal-status">Filtrar por estado</label>
          <select id="hs-cal-status" className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">Todos los estados</option>
            {APPOINTMENT_STATUSES.map((item) => (
              <option key={item} value={item}>{APPOINTMENT_STATUS_LABELS[item]}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="hs-cal-service">Filtrar por servicio</label>
          <select id="hs-cal-service" className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm" value={service} onChange={(event) => setService(event.target.value)}>
            <option value="ALL">Todos los servicios</option>
            {services.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className={`mt-6 grid gap-2 ${view === "day" ? "grid-cols-1" : "grid-cols-7"} overflow-x-auto`}>
          {view !== "day" && WEEKDAYS.slice(0, view === "week" ? 7 : 7).map((label) => (
            <p key={label} className="px-1 text-[0.68rem] tracking-[0.12em] uppercase text-mist">{label}</p>
          ))}
          {days.map((day) => {
            const dayItems = filtered.filter((item) => item.date === day);
            const outside = view === "month" && day.slice(0, 7) !== cursor.slice(0, 7);
            return (
              <div key={day} className={`min-h-28 rounded-2xl border p-2 ${day === today ? "border-accent" : "border-navy/8"} ${outside ? "opacity-40" : ""}`}>
                <p className="text-xs text-mist">{Number(day.slice(8))}</p>
                <div className="mt-2 space-y-1">
                  {dayItems.map((item) => (
                    <button
                      key={item.appointmentId}
                      type="button"
                      onClick={() => {
                        setOpenId(item.appointmentId);
                        setReschedule({ date: item.date, time: item.startTime });
                      }}
                      className={`block w-full rounded-lg border px-2 py-1 text-left ${statusClass(item.status)}`}
                      aria-label={`${formatAppointmentClock(item.startTime)} ${item.serviceLabel} ${item.customerFirst} ${APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatus] || item.status}`}
                    >
                      <span className="block text-[0.7rem] font-medium">{formatAppointmentClock(item.startTime)}</span>
                      <span className="block truncate text-[0.7rem]">{item.serviceLabel}</span>
                      <span className="block truncate text-[0.65rem] opacity-80">Cliente: {item.customerFirst}</span>
                      <span className="block text-[0.62rem] tracking-[0.08em] uppercase">{APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatus] || item.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[28px] border border-navy/8 bg-white p-5">
          <h2 className="font-display text-2xl text-navy">Próximas citas</h2>
          {[
            ["Hoy", groupedUpcoming.today],
            ["Mañana", groupedUpcoming.tomorrow],
            ["Esta semana", groupedUpcoming.week],
          ].map(([label, list]) => (
            <div key={String(label)} className="mt-4">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{String(label)}</p>
              {(list as CalendarItem[]).length === 0 ? (
                <p className="mt-2 text-sm text-mist">Sin citas.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(list as CalendarItem[]).map((item) => (
                    <li key={item.appointmentId}>
                      <button type="button" className="w-full rounded-xl border border-navy/8 px-3 py-2 text-left" onClick={() => setOpenId(item.appointmentId)}>
                        <span className="block text-sm text-navy">{formatAppointmentClock(item.startTime)} · {item.customerFirst}</span>
                        <span className="block text-xs text-mist">{item.serviceLabel} · {APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatus] || item.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>

        {open && (
          <section className="rounded-[28px] border border-navy/8 bg-white p-5" role="dialog" aria-label="Detalle de cita">
            <p className="text-[0.68rem] tracking-[0.14em] uppercase text-accent">{APPOINTMENT_STATUS_LABELS[open.status as AppointmentStatus] || open.status}</p>
            <h2 className="mt-1 font-display text-3xl text-navy">{open.serviceLabel}</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="text-mist">Cliente</dt><dd>{open.customerName}</dd></div>
              <div><dt className="text-mist">Fecha</dt><dd>{formatAppointmentDay(open.date)}</dd></div>
              <div><dt className="text-mist">Hora</dt><dd>{formatAppointmentClock(open.startTime)}</dd></div>
              <div><dt className="text-mist">Zona</dt><dd>{open.zone || "Por confirmar"}</dd></div>
              {open.assignedTo ? <div><dt className="text-mist">Responsable</dt><dd>{open.assignedTo}</dd></div> : null}
              {open.problem ? <div><dt className="text-mist">Notas</dt><dd className="leading-6">{open.problem.slice(0, 280)}</dd></div> : null}
              <div><dt className="text-mist">Lead</dt><dd><Link className="text-accent" href={`/admin/solicitudes/${open.leadId}`}>{open.leadId}</Link></dd></div>
              {open.quoteId ? <div><dt className="text-mist">Cotización</dt><dd>{open.quoteId}</dd></div> : null}
            </dl>
            <div className="mt-5 grid gap-2">
              {open.phone ? (
                <a className="min-h-11 rounded-xl border border-navy/15 px-3 py-3 text-center text-xs tracking-[0.12em] uppercase" href={`tel:${open.phone}`}>Contactar</a>
              ) : null}
              {["REQUESTED", "PROPOSED"].includes(open.status) ? (
                <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl bg-navy text-xs tracking-[0.12em] uppercase text-cream disabled:opacity-50" onClick={() => void mutate("confirm")}>Confirmar</button>
              ) : null}
              {!["CANCELLED", "COMPLETED"].includes(open.status) ? (
                <>
                  <label className="text-xs text-mist" htmlFor="hs-reschedule-date">Reprogramar</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input id="hs-reschedule-date" type="date" className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm" value={reschedule.date || open.date} onChange={(event) => setReschedule((current) => ({ ...current, date: event.target.value }))} />
                    <input type="time" aria-label="Nueva hora" className="min-h-11 rounded-xl border border-navy/10 px-3 text-sm" value={reschedule.time || open.startTime} onChange={(event) => setReschedule((current) => ({ ...current, time: event.target.value }))} />
                  </div>
                  <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl border border-navy/15 text-xs tracking-[0.12em] uppercase disabled:opacity-50" onClick={() => void mutate("reschedule", { date: reschedule.date || open.date, time: reschedule.time || open.startTime })}>Reprogramar</button>
                  <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl border border-navy/15 text-xs tracking-[0.12em] uppercase disabled:opacity-50" onClick={() => void mutate("complete")}>Completar</button>
                  <button type="button" disabled={Boolean(busy)} className="min-h-11 rounded-xl text-xs tracking-[0.12em] uppercase text-accent disabled:opacity-50" onClick={() => void mutate("cancel")}>Cancelar</button>
                </>
              ) : null}
            </div>
            {notice ? <p className="mt-3 text-sm text-mist" role="status">{notice}</p> : null}
          </section>
        )}
      </aside>
    </div>
  );
}
