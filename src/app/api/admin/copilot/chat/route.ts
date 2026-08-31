import { NextResponse } from "next/server";
import { handleWebOperationsTurn } from "@/lib/operations/operations-ai-service";
import type { OperationsPageContext } from "@/lib/operations/context";

export const runtime = "nodejs";

type ChatBody = {
  message?: string;
  conversationId?: string;
  pageContext?: OperationsPageContext;
  confirmation?: { token: string; accept: boolean };
};

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const message = body.message?.trim() || "";
  if (!message && !body.confirmation?.token) {
    return NextResponse.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  try {
    const result = await handleWebOperationsTurn({
      message: message || (body.confirmation?.accept ? "Sí" : "No"),
      conversationId: body.conversationId,
      pageContext: body.pageContext,
      confirmation: body.confirmation,
    });
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, error: "ops_ai_failed", detail }, { status: 500 });
  }
}
