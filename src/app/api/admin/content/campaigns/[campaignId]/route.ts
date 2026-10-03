import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { getControlCampaign } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const { campaignId } = await context.params;
  const campaign = getControlCampaign(campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  return NextResponse.json({ ok: true, campaign });
}
