import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { listSignalsForInbox } from "@/lib/autonomous/signal-store";
import { deliverAutonomousSignalToOpsCenter } from "@/lib/autonomous/notification-router";
import { getAutonomousExecutiveView } from "@/lib/autonomous/engine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const signals = listSignalsForInbox(30).map(deliverAutonomousSignalToOpsCenter);
  const executive = getAutonomousExecutiveView();
  return NextResponse.json({ ok: true, signals, executive });
}
