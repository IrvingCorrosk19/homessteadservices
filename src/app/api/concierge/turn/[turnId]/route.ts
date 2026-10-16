/**
 * Pollable turn status for async / slow n8n turns.
 * Scoped to the hs_cid cookie conversation — no cross-conversation reads.
 */
import { NextResponse } from "next/server";
import { isConciergeEnabled } from "@/lib/concierge-flags";
import { getConversation } from "@/lib/concierge-store";
import { getTurn } from "@/lib/concierge/turn-store";

export const runtime = "nodejs";

function cookieId(request: Request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(/(?:^|; )hs_cid=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export async function GET(request: Request, ctx: { params: Promise<{ turnId: string }> }) {
  if (!isConciergeEnabled()) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { turnId } = await ctx.params;
  const turn = getTurn(turnId);
  if (!turn) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });

  const cid = cookieId(request);
  if (!cid || cid !== turn.conversationId || !getConversation(cid)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let reply = null;
  if (turn.status === "DONE" && turn.replyJson) {
    try {
      reply = JSON.parse(turn.replyJson);
    } catch {
      reply = null;
    }
  }

  return NextResponse.json({
    ok: true,
    turnId: turn.turnId,
    status: turn.status,
    stateVersion: turn.stateVersion,
    processing: !["DONE", "FAILED", "TIMED_OUT", "SUPERSEDED"].includes(turn.status),
    errorCode: turn.errorCode || undefined,
    result: reply,
  });
}
