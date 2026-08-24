"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  businessYmd,
  formatAppointmentClock,
  formatAppointmentDay,
  DEFAULT_APPOINTMENT_SLOT_TIMES,
} from "@/lib/appointment-time";
import { useToast } from "@/components/ui/Toast";
import { AppointmentCard, canDragAppointment } from "@/components/admin/calendar/AppointmentCard";
import {
  AppointmentDetailBottomSheet,
  useMobileSheetViewport,
} from "@/components/admin/calendar/AppointmentDetailBottomSheet";
import { AppointmentDetailContent } from "@/components/admin/calendar/AppointmentDetailContent";
import { DayOverflowPopover } from "@/components/admin/calendar/DayOverflowPopover";
import { RescheduleModal } from "@/components/admin/calendar/RescheduleModal";
import { UpcomingSection } from "@/components/admin/calendar/UpcomingSection";

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
  email: string;
  notes: string;
  originLabel: string;
  version: number;
};

type View = "month" | "week" | "day";

type PendingReschedule = {
  item: CalendarItem;
  newDate: string;
  newTime: string;
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_VISIBLE = 3;
const DRAG_MIME = "application/x-hs-appointment";

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

export function AppointmentCalendar({
  appointments,
  selectedId,
}: {
  appointments: CalendarItem[];
  selectedId?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = businessYmd();
  const initialView = searchParams.get("view");
  const initialDate = searchParams.get("date");
  const [view, setView] = useState<View>(
    initialView === "week" || initialView === "day" ? initialView : "month",
  );
  const [cursor, setCursor] = useState(
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)
      ? initialDate
      : selectedId
        ? appointments.find((item) => item.appointmentId === selectedId)?.date || today
        : today,
  );
  const [status, setStatus] = useState("ALL");
  const [service, setService] = useState("ALL");
  const [openId, setOpenId] = useState(selectedId || "");
  const [busy, setBusy] = useState("");
  const [reschedule, setReschedule] = useState({ date: "", time: "" });
  const [items, setItems] = useState(appointments);
  const [dragId, setDragId] = useState("");
  const [dropDay, setDropDay] = useState("");
  const [dropTime, setDropTime] = useState("");
  const [pending, setPending] = useState<PendingReschedule | null>(null);
  const [savingId, setSavingId] = useState("");
  const [overflowDay, setOverflowDay] = useState<string | null>(null);
  const [dragEnabled, setDragEnabled] = useState(false);
  const [showMobileReschedule, setShowMobileReschedule] = useState(false);
  const sheetViewport = useMobileSheetViewport();
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "month") params.set("view", view);
    if (cursor !== today) params.set("date", cursor);
    if (openId) params.set("id", openId);
    const next = params.toString();
    const current = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
    if (next !== current) {
      router.replace(next ? `/admin/citas?${next}` : "/admin/citas", { scroll: false });
    }
  }, [view, cursor, openId, router, today]);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const update = () => setDragEnabled(mq.matches && window.innerWidth >= 768);
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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

  const patchItem = useCallback((appointmentId: string, patch: Partial<CalendarItem>) => {
    setItems((current) =>
      current.map((item) => (item.appointmentId === appointmentId ? { ...item, ...patch } : item)),
    );
  }, []);

  async function mutate(action: string, payload: Record<string, string | number> = {}) {
    if (!open) return;
    setBusy(action);
    const response = await fetch(`/api/admin/appointments/${open.appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      toast.push({ kind: "error", title: "No pudimos realizar el cambio", body: messageForReason(data.reason) });
      return;
    }
    if (data.appointment) {
      patchItem(data.appointment.appointmentId, mapApiAppointment(data.appointment));
    }
    toast.push({ kind: "success", title: "Listo", body: "Cita actualizada." });
  }

  async function confirmReschedule() {
    if (!pending) return;
    const { item, newDate, newTime } = pending;
    const key = item.appointmentId;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setSavingId(key);
    setBusy("reschedule");

    const snapshot = { ...item };
    patchItem(key, { date: newDate, startTime: newTime, status: item.status === "CONFIRMED" || item.status === "RESCHEDULED" ? "RESCHEDULED" : item.status });

    const response = await fetch(`/api/admin/appointments/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reschedule",
        date: newDate,
        time: newTime,
        version: item.version,
      }),
    });
    const data = await response.json().catch(() => ({}));
    inflight.current.delete(key);
    setSavingId("");
    setBusy("");
    setPending(null);

    if (!response.ok) {
      patchItem(key, snapshot);
      if (data.reason === "stale_version" || data.reason === "conflict") {
        if (data.appointment) patchItem(key, mapApiAppointment(data.appointment));
        toast.push({
          kind: "error",
          title: "Cita modificada",
          body: "Esta cita cambió mientras estabas trabajando. Actualizamos el calendario con la información más reciente.",
        });
      } else {
        toast.push({ kind: "error", title: "Horario no disponible", body: messageForReason(data.reason) });
      }
      return;
    }
    if (data.appointment) {
      patchItem(key, mapApiAppointment(data.appointment));
      setOpenId(key);
      setReschedule({ date: data.appointment.date, time: data.appointment.startTime });
    }
    toast.push({ kind: "success", title: "Cita reprogramada", body: "✓ La visita quedó en el nuevo horario." });
  }

  function openDetail(item: CalendarItem) {
    setOpenId(item.appointmentId);
    setReschedule({ date: item.date, time: item.startTime });
    setShowMobileReschedule(false);
  }

  function closeDetail() {
    setOpenId("");
    setShowMobileReschedule(false);
  }

  function handleDragStart(event: React.DragEvent<HTMLButtonElement>, item: CalendarItem) {
    if (!dragEnabled || !canDragAppointment(item.status)) {
      event.preventDefault();
      return;
    }
    setDragId(item.appointmentId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      DRAG_MIME,
      JSON.stringify({ appointmentId: item.appointmentId, version: item.version, date: item.date, time: item.startTime }),
    );
  }

  function handleDrop(day: string, time?: string) {
    setDropDay("");
    setDropTime("");
    if (!dragId) return;
    const item = items.find((entry) => entry.appointmentId === dragId);
    setDragId("");
    if (!item || !canDragAppointment(item.status)) return;
    const newTime = time || item.startTime;
    if (item.date === day && item.startTime === newTime) return;
    setPending({ item, newDate: day, newTime });
  }

  function renderDayCell(day: string, outside = false) {
    const dayItems = filtered
      .filter((item) => item.date === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const visible = dayItems.slice(0, MAX_VISIBLE);
    const hidden = dayItems.length - visible.length;
    const isDrop = dropDay === day;

    return (
      <div
        key={day}
        className={`min-h-28 min-w-0 rounded-2xl border p-2 transition-colors duration-200 ${day === today ? "border-accent" : "border-navy/8"} ${outside ? "opacity-40" : ""} ${isDrop ? "border-accent bg-accent/10 ring-2 ring-accent/25" : ""}`}
        onDragOver={(event) => {
          if (!dragId) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropDay(day);
        }}
        onDragLeave={() => setDropDay((current) => (current === day ? "" : current))}
        onDrop={(event) => {
          event.preventDefault();
          handleDrop(day);
        }}
      >
        <p className="text-xs text-mist">{Number(day.slice(8))}</p>
        <div className="mt-2 space-y-1">
          {visible.map((item) => (
            <AppointmentCard
              key={item.appointmentId}
              item={item}
              dragging={dragId === item.appointmentId}
              saving={savingId === item.appointmentId}
              dragEnabled={dragEnabled}
              selected={openId === item.appointmentId}
              onOpen={() => openDetail(item)}
              onDragStart={(event) => handleDragStart(event, item)}
              onDragEnd={() => setDragId("")}
            />
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              className="w-full rounded-lg border border-dashed border-navy/15 px-2 py-1 text-left text-[0.65rem] text-accent"
              onClick={() => setOverflowDay(day)}
            >
              +{hidden} citas
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderDayView() {
    const dayItems = filtered.filter((item) => item.date === cursor);
    return (
      <div className="mt-6 space-y-2">
        {DEFAULT_APPOINTMENT_SLOT_TIMES.map((slot) => {
          const slotItems = dayItems.filter((item) => item.startTime === slot);
          const isDrop = dropDay === cursor && dropTime === slot;
          return (
            <div
              key={slot}
              className={`grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-start gap-3 rounded-xl border p-2 transition-colors ${isDrop ? "border-accent bg-accent/10" : "border-navy/8"}`}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                setDropDay(cursor);
                setDropTime(slot);
              }}
              onDragLeave={() => {
                setDropDay("");
                setDropTime("");
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(cursor, slot);
              }}
            >
              <p className="pt-1 text-xs text-mist">{formatAppointmentClock(slot)}</p>
              <div className="min-w-0 space-y-1">
                {slotItems.map((item) => (
                  <AppointmentCard
                    key={item.appointmentId}
                    item={item}
                    dragging={dragId === item.appointmentId}
                    saving={savingId === item.appointmentId}
                    dragEnabled={dragEnabled}
                    selected={openId === item.appointmentId}
                    onOpen={() => openDetail(item)}
                    onDragStart={(event) => handleDragStart(event, item)}
                    onDragEnd={() => setDragId("")}
                  />
                ))}
                {slotItems.length === 0 ? (
                  <p className="py-1 text-[0.65rem] text-mist/70">Disponible</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
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

  const detailProps = open
    ? {
        item: open,
        busy,
        reschedule,
        showRescheduleFields: showMobileReschedule,
        onRescheduleChange: setReschedule,
        onToggleReschedule: () => setShowMobileReschedule((current) => !current),
        onConfirm: () => void mutate("confirm"),
        onCancelAppointment: () => void mutate("cancel"),
        onComplete: () => void mutate("complete"),
        onRescheduleSubmit: () =>
          setPending({
            item: open,
            newDate: reschedule.date || open.date,
            newTime: reschedule.time || open.startTime,
          }),
      }
    : null;

  return (
    <div className="space-y-4 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6 xl:space-y-0">
      <div className="space-y-4 xl:hidden">
        <UpcomingSection grouped={groupedUpcoming} onOpen={openDetail} compact />
      </div>

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

        {view === "day" ? (
          renderDayView()
        ) : view === "week" ? (
          <div className="mt-6 overflow-x-auto md:overflow-visible">
            <div className="flex gap-2 snap-x snap-mandatory pb-1 md:grid md:grid-cols-7 md:gap-2 md:snap-none">
              {days.map((day, index) => (
                <div key={day} className="w-[min(44vw,168px)] shrink-0 snap-start md:w-auto md:shrink">
                  <p className="mb-1 px-1 text-[0.68rem] tracking-[0.12em] uppercase text-mist">{WEEKDAYS[index]}</p>
                  {renderDayCell(day, false)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto md:overflow-visible">
            <div className="min-w-[640px] md:min-w-0">
              <div className="grid grid-cols-7 gap-2">
                {WEEKDAYS.map((label) => (
                  <p key={label} className="px-1 text-[0.68rem] tracking-[0.12em] uppercase text-mist">{label}</p>
                ))}
                {days.map((day) => renderDayCell(day, day.slice(0, 7) !== cursor.slice(0, 7)))}
              </div>
            </div>
          </div>
        )}
      </section>

      <aside className="hidden space-y-6 xl:block">
        <div className="sticky top-6 space-y-6">
          <UpcomingSection grouped={groupedUpcoming} onOpen={openDetail} />
          {open && detailProps ? (
            <section className="rounded-[28px] border border-navy/8 bg-white p-5" aria-label="Detalle de cita">
              <AppointmentDetailContent {...detailProps} mobile={false} />
            </section>
          ) : null}
        </div>
      </aside>

      {open && detailProps && sheetViewport ? (
        <AppointmentDetailBottomSheet open title={open.serviceLabel} onClose={closeDetail}>
          <AppointmentDetailContent {...detailProps} mobile />
        </AppointmentDetailBottomSheet>
      ) : null}

      {pending ? (
        <RescheduleModal
          item={pending.item}
          newDate={pending.newDate}
          newTime={pending.newTime}
          busy={busy === "reschedule"}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmReschedule()}
        />
      ) : null}

      {overflowDay ? (
        <DayOverflowPopover
          day={overflowDay}
          items={filtered.filter((item) => item.date === overflowDay).sort((a, b) => a.startTime.localeCompare(b.startTime))}
          onOpen={(id) => {
            const item = items.find((entry) => entry.appointmentId === id);
            if (item) openDetail(item);
          }}
          onClose={() => setOverflowDay(null)}
        />
      ) : null}
    </div>
  );
}

function mapApiAppointment(raw: Record<string, unknown>): Partial<CalendarItem> {
  return {
    appointmentId: String(raw.appointmentId || ""),
    date: String(raw.date || ""),
    startTime: String(raw.startTime || ""),
    endTime: String(raw.endTime || ""),
    status: String(raw.status || ""),
    version: Number(raw.version || 1),
    serviceLabel: String(raw.serviceLabel || raw.service || ""),
  };
}

function messageForReason(reason?: string) {
  if (reason === "slot_taken") return "Ese horario ya está ocupado. Selecciona otro horario disponible.";
  if (reason === "stale_version" || reason === "conflict") {
    return "Esta cita cambió mientras estabas trabajando.";
  }
  if (reason === "invalid_status") return "Esta cita ya no puede reprogramarse.";
  if (reason === "past_slot") return "Ese horario ya pasó. Elige una fecha futura.";
  if (reason === "same_slot") return "La cita ya está en ese horario.";
  return "No pudimos realizar el cambio. Intenta de nuevo.";
}
