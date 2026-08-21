import { NextResponse } from "next/server";
import { listAppointments } from "@/lib/revenue-store";
import { isAppointmentStatus } from "@/lib/appointment-time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const service = url.searchParams.get("service") || undefined;
  if (status && status !== "ALL" && !isAppointmentStatus(status)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const appointments = listAppointments({ from, to, status, service }).map((item) => ({
    appointmentId: item.appointmentId,
    leadId: item.leadId,
    date: item.date,
    startTime: item.startTime,
    status: item.status,
    serviceLabel: item.serviceLabel,
    customerFirst: item.customerFirst,
    zone: item.zone,
    assignedTo: item.assignedTo,
  }));
  return NextResponse.json({ ok: true, appointments });
}
