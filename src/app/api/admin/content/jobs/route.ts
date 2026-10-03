import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { listControlJobs } from "@/lib/control-service";
import type { ControlDisplayState } from "@/lib/control-status";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const url = new URL(request.url);
  const state = (url.searchParams.get("state") || "all") as ControlDisplayState | "all";
  const jobs = listControlJobs({
    state,
    platform: url.searchParams.get("platform") || undefined,
    batchId: url.searchParams.get("batchId") || undefined,
    campaignId: url.searchParams.get("campaignId") || undefined,
    q: url.searchParams.get("q") || undefined,
  });
  return NextResponse.json({ ok: true, jobs });
}
