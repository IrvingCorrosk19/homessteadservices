import { NextResponse } from "next/server";
import { requireAdminMutation } from "@/lib/control-auth";
import { replayAndDrain } from "@/lib/automation-dispatch";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => ({}))) as { eventId?: string };
  const eventId = String(body.eventId || "").trim();
  if (!eventId) return NextResponse.json({ ok: false, error: "missing_event" }, { status: 400 });
  const result = await replayAndDrain(eventId);
  if (!result.ok) return NextResponse.json({ ok: false, reason: "reason" in result ? result.reason : "failed" }, { status: 409 });
  return NextResponse.json({ ok: true, correlationId: result.correlationId, status: "status" in result ? result.status : "" });
}
