import { NextResponse } from "next/server";
import { requireAdminMutation, requireAdminSession } from "@/lib/control-auth";
import { getContentSettings } from "@/lib/content-catalog";
import { setStudioPaused } from "@/lib/control-service";
import { logInfo } from "@/lib/log";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireAdminSession();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const settings = getContentSettings();
  return NextResponse.json({
    ok: true,
    paused: settings.paused,
    dryRun: settings.dryRun,
    timezone: settings.timezone,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const body = (await request.json().catch(() => null)) as { paused?: boolean } | null;
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const result = setStudioPaused(body.paused, "admin-web");
  logInfo("ControlStudioPause", { stage: body.paused ? "paused" : "resumed" });
  return NextResponse.json(result);
}
