import { NextResponse } from "next/server";
import { controlActor, requireAdminMutation } from "@/lib/control-auth";
import { setControlCampaignPaused } from "@/lib/control-service";
import { logInfo } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { campaignId } = await context.params;
  const body = (await request.json().catch(() => null)) as { paused?: boolean } | null;
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const result = setControlCampaignPaused(campaignId, body.paused, controlActor(request));
  logInfo("ControlCampaignPause", { contentJobId: campaignId, stage: body.paused ? "paused" : "resumed" });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
