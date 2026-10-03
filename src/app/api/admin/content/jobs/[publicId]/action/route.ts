import { NextResponse } from "next/server";
import { controlActor, requireAdminMutation } from "@/lib/control-auth";
import { runControlJobAction, type ControlJobAction } from "@/lib/control-service";
import { logInfo } from "@/lib/log";

export const runtime = "nodejs";

const ACTIONS = new Set<ControlJobAction>([
  "approve",
  "approve_and_schedule",
  "reschedule",
  "reject",
  "publish_now",
  "retry_platform",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const { publicId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    version?: number;
    confirm?: boolean;
    idempotencyKey?: string;
  } | null;
  const action = body?.action as ControlJobAction;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }
  const result = await runControlJobAction({
    publicId,
    action,
    version: Number(body?.version || 0),
    actor: controlActor(request),
    confirm: Boolean(body?.confirm),
    idempotencyKey: String(body?.idempotencyKey || request.headers.get("idempotency-key") || ""),
  });
  logInfo("ControlJobAction", {
    contentJobId: publicId,
    stage: action,
  });
  const status = result.ok ? 200 : result.error === "stale_version" ? 409 : 400;
  return NextResponse.json(result, { status });
}
