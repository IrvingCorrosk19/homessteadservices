import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { marketingBaseline } from "@/lib/marketing-engine";
import { latestRecommendation, leadCount } from "@/lib/marketing-store";
import { sendTelegramMessage, adminChatIds } from "@/lib/content-telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const base = marketingBaseline();
  const rec = latestRecommendation();
  const leads = leadCount();
  const text = [
    "HOMESTEAD WEEKLY MARKETING",
    "",
    `Posts publicados: ${base.published}`,
    `Listos en cola: ${base.ready}`,
    `Alcance: NOT AVAILABLE`,
    `Contactos atribuibles (/lead): ${leads}`,
    "",
    `Etapa de aprendizaje: ${base.learningStage}`,
    base.withAnalytics < 1
      ? "Todavía no hay métricas de Instagram/Facebook. No hay un 'mejor horario' propio."
      : `Publicaciones con analytics: ${base.withAnalytics}`,
    "",
    rec
      ? `Siguiente recomendación: ${rec.publicId} (${rec.confidence})`
      : "Sin recomendación vigente. Usa /recomendar.",
  ].join("\n");
  const chat = adminChatIds()[0];
  if (chat) await sendTelegramMessage({ chatId: chat, text });
  return NextResponse.json({ ok: true, sent: Boolean(chat) });
}
