import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { dismissLead, markEntityContacted, snoozeEntity } from "@/lib/ops-store";
import { enqueueDailyBrief, runOpsEngine } from "@/lib/ops-engine";
import { drainAutomationOutbox } from "@/lib/automation-dispatch";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const action = String(payload.action || "");
  const entityId = String(payload.entityId || "");
  if (action === "tick") {
    const ops = runOpsEngine();
    const drain = await drainAutomationOutbox(24);
    return NextResponse.json({ ok: true, ops, drain });
  }
  if (action === "brief") {
    const n = enqueueDailyBrief(true);
    await drainAutomationOutbox();
    return NextResponse.json({ ok: true, enqueued: n });
  }
  if (!entityId) return NextResponse.json({ ok: false, error: "missing_entity" }, { status: 400 });
  if (action === "contacted") return NextResponse.json(markEntityContacted(entityId, "api"));
  if (action === "snooze") {
    const minutes = Number(payload.minutes || 15);
    return NextResponse.json({ ok: true, until: snoozeEntity(entityId, minutes, "api") });
  }
  if (action === "dismiss") return NextResponse.json(dismissLead(entityId, "api"));
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
