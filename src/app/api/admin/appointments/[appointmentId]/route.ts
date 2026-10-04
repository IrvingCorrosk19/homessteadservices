import { NextResponse } from "next/server";
import { requireAdminMutation, requireAdminSession } from "@/lib/control-auth";
import { APPOINTMENT_ID_PATTERN } from "@/lib/appointment-time";
import { getAppointment, rescheduleAppointment, setAppointmentStatus } from "@/lib/revenue-store";
import { notifyAppointmentEvent } from "@/lib/revenue-telegram";
import { assertSecurityReviewAllowsBooking } from "@/lib/service-request-disposition";
import { logInfo } from "@/lib/log";

type Params = { params: Promise<{ appointmentId: string }> };

export const runtime = "nodejs";

const RESCHEDULE_STATUS: Record<string, number> = {
  not_found: 404,
  invalid_status: 409,
  invalid_time: 400,
  past_slot: 400,
  slot_taken: 409,
  stale_version: 409,
  same_slot: 400,
  conflict: 409,
};

export async function GET(request: Request, { params }: Params) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { appointmentId } = await params;
  if (!APPOINTMENT_ID_PATTERN.test(appointmentId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const appointment = getAppointment(appointmentId);
  if (!appointment) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, appointment });
}

export async function PATCH(request: Request, { params }: Params) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { appointmentId } = await params;
  if (!APPOINTMENT_ID_PATTERN.test(appointmentId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    date?: string;
    time?: string;
    version?: number;
    assignedTo?: string;
  } | null;
  const action = String(body?.action || "");
  const current = getAppointment(appointmentId);
  if (!current) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

  if (action === "confirm" || action === "reschedule") {
    const security = assertSecurityReviewAllowsBooking(current.leadId);
    if (!security.ok) {
      return NextResponse.json(
        { ok: false, error: "security_review_required", reason: "security_review_required" },
        { status: 409 },
      );
    }
  }

  if (action === "confirm") {
    setAppointmentStatus(appointmentId, "CONFIRMED");
    await notifyAppointmentEvent(appointmentId, "CONFIRMED");
    void import("@/lib/control-push").then((m) => m.syncAppointmentPushReminder(appointmentId));
  } else if (action === "cancel") {
    setAppointmentStatus(appointmentId, "CANCELLED");
    await notifyAppointmentEvent(appointmentId, "CANCELLED");
    void import("@/lib/control-push").then((m) => m.cancelAppointmentPushReminders(appointmentId, "cancelled"));
  } else if (action === "complete") {
    setAppointmentStatus(appointmentId, "COMPLETED");
    void import("@/lib/control-push").then((m) => m.cancelAppointmentPushReminders(appointmentId, "completed"));
  } else if (action === "reschedule") {
    const date = String(body?.date || "");
    const time = String(body?.time || "");
    const expectedVersion =
      body?.version !== undefined && Number.isFinite(Number(body.version)) ? Number(body.version) : undefined;
    const moved = rescheduleAppointment(appointmentId, date, time, {
      expectedVersion,
      actor: "admin",
    });
    if (!moved.ok) {
      const latest = getAppointment(appointmentId);
      return NextResponse.json(
        { ok: false, reason: moved.reason, appointment: latest || undefined },
        { status: RESCHEDULE_STATUS[moved.reason] || 409 },
      );
    }
    if (moved.status === "RESCHEDULED" || current.status === "CONFIRMED") {
      await notifyAppointmentEvent(appointmentId, "RESCHEDULED", {
        previousDate: moved.previousDate,
        previousTime: moved.previousTime,
      });
    }
    void import("@/lib/control-push").then((m) => m.syncAppointmentPushReminder(appointmentId));
  } else if (action === "assign") {
    const assignedTo = String((body as { assignedTo?: string })?.assignedTo || "");
    const { setAppointmentAssignee } = await import("@/lib/control-push");
    const assigned = setAppointmentAssignee(appointmentId, assignedTo);
    if (!assigned.ok) {
      return NextResponse.json({ ok: false, reason: assigned.reason }, { status: 409 });
    }
  } else {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const appointment = getAppointment(appointmentId);
  logInfo("AppointmentUpdated", { contentJobId: appointmentId, stage: action });
  return NextResponse.json({ ok: true, appointment });
}
