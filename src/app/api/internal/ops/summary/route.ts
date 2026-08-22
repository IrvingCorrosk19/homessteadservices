import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { commandCenterSummary, todayMetrics, opsEventCounts } from "@/lib/ops-store";
import { getEngineState } from "@/lib/automation-outbox";
import { failedWaveCOutbox, jobMetrics } from "@/lib/job-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = { source: "ops-summary" };
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const includeTest = url.searchParams.get("test") === "1";
  return NextResponse.json({
    ok: true,
    summary: commandCenterSummary(includeTest),
    today: todayMetrics(includeTest),
    events: opsEventCounts(),
    jobs: jobMetrics(includeTest),
    waveCOutboxFailed: failedWaveCOutbox(),
    freshness: {
      ops: getEngineState("last_ops_engine_at"),
      brief: getEngineState("last_daily_brief_at"),
      scheduler: getEngineState("last_scheduler_at"),
    },
  });
}
