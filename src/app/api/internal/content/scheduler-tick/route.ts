import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { runContentScheduler } from "@/lib/content-scheduler";
import { runHotLeadReminders, runAppointmentReminders } from "@/lib/revenue-telegram";
import { drainAutomationOutbox } from "@/lib/automation-dispatch";
import { setEngineState } from "@/lib/automation-outbox";
import { inspectTelegramWebhook } from "@/lib/content-telegram";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    setEngineState("last_scheduler_at", new Date().toISOString());
    try {
      await inspectTelegramWebhook();
    } catch (error) {
      logError("TelegramWebhookIntegrityCheck", {
        cause: error instanceof Error ? error.name : "unknown",
      });
    }
    try {
      await drainAutomationOutbox();
    } catch (error) {
      logError("AutomationDispatchFailed", {
        cause: error instanceof Error ? error.name : "unknown",
      });
    }
    const result = await runContentScheduler();
    let reminders: { sent: number } = { sent: 0 };
    try {
      reminders = await runHotLeadReminders();
    } catch (error) {
      logError("HotLeadReminderFailed", {
        cause: error instanceof Error ? error.name : "unknown",
      });
    }
    let appointments: { sent: number } = { sent: 0 };
    try {
      appointments = await runAppointmentReminders();
    } catch (error) {
      logError("AppointmentReminderFailed", {
        cause: error instanceof Error ? error.name : "unknown",
      });
    }
    return NextResponse.json({ ...result, reminders, appointments });
  } catch (error) {
    logError("ContentSchedulerFailed", {
      cause: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
