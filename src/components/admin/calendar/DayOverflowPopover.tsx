"use client";

import type { CalendarItem } from "@/components/admin/AppointmentCalendar";
import { AppointmentCard } from "@/components/admin/calendar/AppointmentCard";

type DayOverflowPopoverProps = {
  day: string;
  items: CalendarItem[];
  onOpen: (id: string) => void;
  onClose: () => void;
};

export function DayOverflowPopover({ day, items, onOpen, onClose }: DayOverflowPopoverProps) {
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-navy/25 p-4 md:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-label={`Citas del ${day}`}
        className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-[24px] border border-navy/10 bg-white p-4 shadow-[0_20px_50px_rgba(31,51,68,0.16)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-lg text-navy">{day.slice(8)}/{day.slice(5, 7)}</p>
          <button type="button" className="min-h-10 rounded-lg px-3 text-xs uppercase text-mist" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <AppointmentCard
              key={item.appointmentId}
              item={item}
              compact
              dragEnabled={false}
              onOpen={() => {
                onOpen(item.appointmentId);
                onClose();
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
