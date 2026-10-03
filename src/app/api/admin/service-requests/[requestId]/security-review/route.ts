import { NextResponse } from "next/server";
import { controlActor, requireAdminMutation } from "@/lib/control-auth";
import { setSecurityReview } from "@/lib/service-request-disposition";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, { params }: Params) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { requestId } = await params;
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    action?: "set" | "resolve";
    reason?: string;
    confirm?: boolean;
  };
  if (body.action !== "set" && body.action !== "resolve") {
    return NextResponse.json({ ok: false, error: "action_required" }, { status: 400 });
  }
  const result = setSecurityReview({
    requestId,
    actor: controlActor(request),
    action: body.action,
    reason: body.reason,
    confirm: Boolean(body.confirm),
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status || 400 });
  }
  return NextResponse.json(result);
}
