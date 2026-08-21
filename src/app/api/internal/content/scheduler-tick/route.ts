import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { runContentScheduler } from "@/lib/content-scheduler";
import { logError } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runContentScheduler();
    return NextResponse.json(result);
  } catch (error) {
    logError("ContentSchedulerFailed", {
      cause: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
