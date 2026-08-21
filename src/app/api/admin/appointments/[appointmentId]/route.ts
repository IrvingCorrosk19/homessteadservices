import { NextResponse } from "next/server";
import { APPOINTMENT_ID_PATTERN } from "@/lib/appointment-time";
import { getAppointment, rescheduleAppointment, setAppointmentStatus } from "@/lib/revenue-store";
import { notifyAppointmentEvent } from "@/lib/revenue-telegram";
import { logInfo } from "@/lib/log";

type Params = { params: Promise<{ appointmentId: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: Params) {
  const { appointmentId } = await params;
  if (!APPOINTMENT_ID_PATTERN.test(appointmentId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const appointment = getAppointment(appointmentId);
  if (!appointment) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, appointment });
}

export async function PATCH(request: Request, { params }: Params) {
  const { appointmentId } = await params;
  if (!APPOINTMENT_ID_PATTERN.test(appointmentId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    date?: string;
    time?: string;
  } | null;
  const action = String(body?.action || "");
  const current = getAppointment(appointmentId);
  if (!current) return NextResponse.json({ ok: false }, { status: 404 });

  if (action === "confirm") {
    setAppointmentStatus(appointmentId, "CONFIRMED");
    await notifyAppointmentEvent(appointmentId, "CONFIRMED");
  } else if (action === "cancel") {
    setAppointmentStatus(appointmentId, "CANCELLED");
    await notifyAppointmentEvent(appointmentId, "CANCELLED");
  } else if (action === "complete") {
    setAppointmentStatus(appointmentId, "COMPLETED");
  } else if (action === "reschedule") {
    const date = String(body?.date || "");
    const time = String(body?.time || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const moved = rescheduleAppointment(appointmentId, date, time);
    if (!moved) return NextResponse.json({ ok: false }, { status: 409 });
    if (moved.status === "RESCHEDULED" || current.status === "CONFIRMED") {
      await notifyAppointmentEvent(appointmentId, "RESCHEDULED", {
        previousDate: current.date,
        previousTime: current.startTime,
      });
    }
  } else {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const appointment = getAppointment(appointmentId);
  logInfo("AppointmentUpdated", { contentJobId: appointmentId, stage: action });
  return NextResponse.json({ ok: true, appointment });
}
