import { NextResponse } from "next/server";
import { getSignalById, acknowledgeSignal, recordSignalFeedback } from "@/lib/autonomous/signal-store";
import { deliverAutonomousSignalToOpsCenter } from "@/lib/autonomous/notification-router";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ signalId: string }> }) {
  const { signalId } = await ctx.params;
  const signal = getSignalById(signalId);
  if (!signal) return NextResponse.json({ ok: false, detail: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, signal: deliverAutonomousSignalToOpsCenter(signal), raw: signal });
}

export async function POST(req: Request, ctx: { params: Promise<{ signalId: string }> }) {
  const { signalId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; feedback?: string };
  const signal = getSignalById(signalId);
  if (!signal) return NextResponse.json({ ok: false, detail: "not_found" }, { status: 404 });

  if (body.action === "acknowledge") {
    acknowledgeSignal(signalId);
    return NextResponse.json({ ok: true, status: "ACKNOWLEDGED" });
  }
  if (body.feedback) {
    recordSignalFeedback(signalId, body.feedback);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, detail: "invalid_action" }, { status: 400 });
}
