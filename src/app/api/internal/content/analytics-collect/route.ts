import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { logInfo } from "@/lib/log";
import { platformConfigured } from "@/lib/content-meta";
import { listJobsByStatus } from "@/lib/content-catalog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const instagram = platformConfigured("instagram");
  const facebook = platformConfigured("facebook");
  const published = listJobsByStatus(["PUBLISHED"]).length;
  logInfo("MarketingAnalyticsCollect", {
    stage: instagram || facebook ? "api" : "unavailable",
    contentJobId: String(published),
  });
  return NextResponse.json({
    ok: true,
    instagram: instagram ? "AVAILABLE" : "NOT AVAILABLE",
    facebook: facebook ? "AVAILABLE" : "NOT AVAILABLE",
    collected: 0,
    reason: instagram || facebook ? "ok" : "meta_not_configured",
    note: "Missing metrics are unknown, not zero.",
  });
}
