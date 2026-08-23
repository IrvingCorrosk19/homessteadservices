"use client";

import {
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentClock,
  type AppointmentStatus,
} from "@/lib/appointment-time";
import type { CalendarItem } from "@/components/admin/AppointmentCalendar";

type UpcomingSectionProps = {
  grouped: {
    today: CalendarItem[];
    tomorrow: CalendarItem[];
    week: CalendarItem[];
  };
  onOpen: (item: CalendarItem) => void;
  compact?: boolean;
};

export function UpcomingSection({ grouped, onOpen, compact = false }: UpcomingSectionProps) {
  const sections = [
    ["Hoy", grouped.today],
    ["Mañana", grouped.tomorrow],
    ["Esta semana", grouped.week],
  ] as const;

  return (
    <section className={`rounded-[28px] border border-navy/8 bg-white ${compact ? "p-4" : "p-5"}`}>
      <h2 className={`font-display text-navy ${compact ? "text-xl" : "text-2xl"}`}>Próximas citas</h2>
      {sections.map(([label, list]) => (
        <div key={label} className="mt-3">
          <p className="text-[0.68rem] tracking-[0.14em] uppercase text-mist">{label}</p>
          {list.length === 0 ? (
            <p className="mt-2 text-sm text-mist">Sin visitas en este periodo.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {list.map((item) => (
                <li key={item.appointmentId}>
                  <button
                    type="button"
                    className="min-h-12 w-full rounded-xl border border-navy/8 px-3 py-2.5 text-left active:bg-cream-deep/60"
                    onClick={() => onOpen(item)}
                  >
                    <span className="block truncate text-sm font-medium text-navy">
                      {formatAppointmentClock(item.startTime)} · {item.customerFirst || "Cliente pendiente"}
                    </span>
                    <span className="block truncate text-xs text-mist">
                      {item.serviceLabel} · {APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatus] || item.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
