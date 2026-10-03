import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { listControlCampaigns } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  return NextResponse.json({ ok: true, campaigns: listControlCampaigns() });
}
