import { NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/content-handler";
import type { TelegramUpdate } from "@/lib/content-telegram";
import {
  telegramWebhookSecret,
  verifyInternalHomesteadRequest,
} from "@/lib/internal-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

function extractUpdate(payload: Record<string, unknown>): TelegramUpdate | null {
  const body = payload.body;
  if (body && typeof body === "object" && "update_id" in (body as object)) {
    return body as TelegramUpdate;
  }
  if ("update_id" in payload) return payload as unknown as TelegramUpdate;
  return null;
}

function forwardedTelegramSecret(payload: Record<string, unknown>, request: Request) {
  const headers = (payload.headers || {}) as Record<string, string>;
  return (
    headers["x-telegram-bot-api-secret-token"] ||
    headers["X-Telegram-Bot-Api-Secret-Token"] ||
    request.headers.get("x-telegram-bot-api-secret-token") ||
    ""
  );
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const expectedTelegram = telegramWebhookSecret();
  if (expectedTelegram && forwardedTelegramSecret(payload, request) !== expectedTelegram) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const update = extractUpdate(payload);
  if (!update?.update_id) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  try {
    const result = await handleTelegramUpdate(update);
    logInfo("ContentTelegramUpdateHandled", {
      contentJobId: String(update.update_id),
      stage: result.denied ? "denied" : "ok",
    });
    return NextResponse.json(result);
  } catch (error) {
    logError("ContentTelegramUpdateFailed", {
      cause: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
