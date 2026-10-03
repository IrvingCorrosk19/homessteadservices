import { NextResponse } from "next/server";
import { controlActor, requireAdminMutation, requireAdminSession } from "@/lib/control-auth";
import {
  applyServiceRequestDisposition,
  getServiceRequestDispositionView,
  setSecurityReview,
  type DispositionAction,
} from "@/lib/service-request-disposition";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, { params }: Params) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { requestId } = await params;
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const view = getServiceRequestDispositionView(requestId);
  if (!view) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  return NextResponse.json({ ok: true, request: view });
}

export async function POST(request: Request, { params }: Params) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { requestId } = await params;
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    action?: DispositionAction;
    reasonCategory?: string;
    reason?: string;
    internalNote?: string;
    customerMessage?: string;
    sendCustomerMessage?: boolean;
    confirm?: boolean;
    idempotencyKey?: string;
  };
  if (!body.action) {
    return NextResponse.json({ ok: false, error: "action_required" }, { status: 400 });
  }
  const result = await applyServiceRequestDisposition({
    requestId,
    action: body.action,
    actor: controlActor(request),
    reasonCategory: body.reasonCategory || "",
    reason: body.reason,
    internalNote: body.internalNote,
    customerMessage: body.customerMessage,
    sendCustomerMessage: Boolean(body.sendCustomerMessage),
    confirm: Boolean(body.confirm),
    idempotencyKey: body.idempotencyKey,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status || 400 });
  }
  return NextResponse.json(result);
}
