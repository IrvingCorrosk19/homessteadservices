import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { AppointmentCalendar } from "@/components/admin/AppointmentCalendar";
import { listAppointments } from "@/lib/revenue-store";
import { businessYmd } from "@/lib/appointment-time";

export const dynamic = "force-dynamic";

export default async function CitasPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const params = await searchParams;
  const from = businessYmd(new Date(), -40);
  const to = businessYmd(new Date(), 90);
  const appointments = listAppointments({ from, to }).map((item) => ({
    appointmentId: item.appointmentId,
    leadId: item.leadId,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    status: item.status,
    service: item.service,
    serviceLabel: item.serviceLabel,
    customerName: item.customerName,
    customerFirst: item.customerFirst,
    zone: item.zone,
    assignedTo: item.assignedTo,
    conversationId: item.conversationId,
    quoteId: item.quoteId,
    problem: item.problem,
    phone: item.phone,
    notes: item.notes,
  }));

  return (
    <>
      <AdminTopBar />
      <main className="mx-auto w-[min(1200px,calc(100%-1.5rem))] py-8 md:w-[min(1200px,calc(100%-4rem))] md:py-12">
        <AppointmentCalendar appointments={appointments} selectedId={params.id} />
      </main>
    </>
  );
}
