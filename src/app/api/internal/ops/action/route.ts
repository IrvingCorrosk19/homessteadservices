import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { dismissLead, markEntityContacted, snoozeEntity } from "@/lib/ops-store";
import { enqueueDailyBrief, runOpsEngine } from "@/lib/ops-engine";
import { markRecoveryContacted, recordSatisfaction } from "@/lib/post-service";
import { createContentFromJob } from "@/lib/job-content";
import { drainAutomationOutbox } from "@/lib/automation-dispatch";
import { approveMarketingUsage, completeServiceJob, startServiceJob } from "@/lib/job-store";

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
  if (action === "job.satisfaction") {
    return NextResponse.json(recordSatisfaction(String(payload.token || ""), String(payload.response || "")));
  }
  if (!entityId) return NextResponse.json({ ok: false, error: "missing_entity" }, { status: 400 });
  if (action === "contacted") return NextResponse.json(markEntityContacted(entityId, "api"));
  if (action === "snooze") {
    const minutes = Number(payload.minutes || 15);
    return NextResponse.json({ ok: true, until: snoozeEntity(entityId, minutes, "api") });
  }
  if (action === "dismiss") return NextResponse.json(dismissLead(entityId, "api"));
  if (action === "job.start") return NextResponse.json(startServiceJob(entityId, "api"));
  if (action === "job.complete") return NextResponse.json(completeServiceJob(entityId, "api"));
  if (action === "job.recovery") return NextResponse.json(markRecoveryContacted(entityId, "api"));
  if (action === "job.marketing") return NextResponse.json({ ok: approveMarketingUsage(entityId, "api") });
  if (action === "job.content") {
    const chatId = String(payload.chatId || "");
    return NextResponse.json(createContentFromJob({ jobId: entityId, chatId, userId: chatId, actor: "api" }));
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
