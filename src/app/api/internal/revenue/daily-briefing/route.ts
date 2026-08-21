import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { formatHoy } from "@/lib/revenue-telegram";
import { backfillFromServiceRequests } from "@/lib/revenue-store";
import { sendTelegramMessage, adminChatIds } from "@/lib/content-telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  backfillFromServiceRequests();
  const text = formatHoy();
  const send = process.env.REVENUE_BRIEFING_SEND === "true";
  if (send) {
    const chat = adminChatIds()[0];
    if (chat) await sendTelegramMessage({ chatId: chat, text: `BRIEFING\n\n${text}` });
  }
  return NextResponse.json({ ok: true, sent: send, preview: text.slice(0, 500) });
}
