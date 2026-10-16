/**
 * Authenticated internal tool API for n8n (remote mode).
 * Header: x-homestead-internal-secret
 * Never accepts browser-chosen foreign conversation IDs without secret.
 */
import { NextResponse } from "next/server";
import { dispatchBusinessTool, verifyInternalAuth, type BusinessToolName } from "@/lib/concierge/business-tools";
import { getTurn, updateTurn, shouldAcceptTurnResult } from "@/lib/concierge/turn-store";
import { logInfo } from "@/lib/log";

export const runtime = "nodejs";

const ALLOWED = new Set<BusinessToolName>([
  "get_context",
  "interpret",
  "save_facts",
  "upsert_request",
  "check_availability",
  "book_appointment",
  "reschedule",
  "cancel",
  "business_contact",
  "human_handoff",
  "list_services",
  "reconcile_request",
  "route_decision",
  "second_service",
  "cancel_all_ask",
  "cancel_all_confirm",
  "finalize_turn",
  "compose_ask",
]);

export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  if (!verifyInternalAuth(request.headers.get("x-homestead-internal-secret"))) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }
  const { action } = await ctx.params;
  const tool = action as BusinessToolName;
  if (!ALLOWED.has(tool)) {
    return NextResponse.json({ ok: false, code: "unknown_tool" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_json" }, { status: 400 });

  // Optional turn binding — reject stale results
  const turnId = String(body.turnId || "");
  if (turnId) {
    const turn = getTurn(turnId);
    if (!turn) return NextResponse.json({ ok: false, code: "turn_not_found" }, { status: 404 });
    if (!shouldAcceptTurnResult(turnId)) {
      updateTurn(turnId, { status: "SUPERSEDED", completed: true });
      return NextResponse.json({ ok: false, code: "turn_superseded" }, { status: 409 });
    }
    if (body.conversationId && turn.conversationId !== body.conversationId) {
      return NextResponse.json({ ok: false, code: "conversation_mismatch" }, { status: 403 });
    }
    body.conversationId = turn.conversationId;
    // Prefer turn-bound user text so n8n need not re-supply PII in every hop.
    if (!body.text && turn.userText) body.text = turn.userText;
  }

  logInfo("CONCIERGE_INTERNAL_TOOL", {
    contentJobId: String(body.conversationId || "").slice(0, 8),
    stage: tool,
  });
  const result = await dispatchBusinessTool(tool, body);
  // Business-tool failures stay HTTP 200 with ok:false so n8n Code nodes
  // can branch without aborting the whole coordination execution.
  return NextResponse.json(result, { status: 200 });
}
