import { NextResponse } from "next/server";
import { attachConciergePhoto, conciergeTurn, isConciergeEnabled } from "@/lib/concierge-engine";
import { getConversation } from "@/lib/concierge-store";
import { normalizeConciergePhoto } from "@/lib/concierge-photo-process";
import { isAllowedDeclaredType, MAX_PHOTO_INPUT_BYTES } from "@/lib/photos";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

function cookieId(request: Request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(/(?:^|; )hs_cid=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function humanPhotoError(code: string) {
  if (code === "heic_unsupported") {
    return "Esta foto está en un formato que todavía no podemos procesar. Prueba enviarla como JPG, PNG o WebP.";
  }
  if (code === "size") return "Esta foto es demasiado grande después de prepararla. Intenta con otra más liviana.";
  if (code === "dimension") return "Esta foto tiene dimensiones demasiado grandes. Intenta con otra imagen.";
  if (code === "limit") return "Ya recibimos el máximo de fotos para esta conversación.";
  if (code === "type" || code === "invalid_image") {
    return "No pudimos leer esa imagen. Usa JPG, PNG o WebP.";
  }
  return "No pudimos enviar esta foto.";
}

export async function POST(request: Request) {
  if (!isConciergeEnabled()) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const conversationId = cookieId(request);
  if (!conversationId || !getConversation(conversationId)) {
    return NextResponse.json({ ok: false, error: "session" }, { status: 400 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  const caption = String(form?.get("caption") || "").trim().slice(0, 500);
  if (!(file instanceof File)) return NextResponse.json({ ok: false }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_PHOTO_INPUT_BYTES) {
    return NextResponse.json({ ok: false, error: "size", message: humanPhotoError("size") }, { status: 400 });
  }
  const declared = file.type.trim().toLowerCase();
  if (declared && !isAllowedDeclaredType(declared)) {
    return NextResponse.json({ ok: false, error: "type", message: humanPhotoError("type") }, { status: 400 });
  }

  logInfo("ConciergePhotoProcessingStarted", {
    stage: "upload",
    contentJobId: conversationId.slice(0, 8),
    bytes: file.size,
  });

  const raw = Buffer.from(await file.arrayBuffer());
  let normalized;
  try {
    normalized = await normalizeConciergePhoto(raw, declared, file.name);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_image";
    logError("ConciergePhotoProcessingFailed", {
      stage: reason,
      contentJobId: conversationId.slice(0, 8),
    });
    return NextResponse.json(
      { ok: false, error: reason, message: humanPhotoError(reason) },
      { status: 400 },
    );
  }

  logInfo("ConciergePhotoNormalized", {
    stage: "stored",
    contentJobId: conversationId.slice(0, 8),
    originalBytes: normalized.originalBytes,
    outputBytes: normalized.bytes.length,
    width: normalized.width,
    height: normalized.height,
  });

  const saved = attachConciergePhoto(conversationId, normalized.bytes, normalized.sniffed, caption);
  if (!saved || "error" in saved) {
    const code = saved?.error || "fail";
    logError("ConciergePhotoStorageFailed", {
      stage: code,
      contentJobId: conversationId.slice(0, 8),
    });
    return NextResponse.json({ ok: false, error: code, message: humanPhotoError(code) }, { status: 400 });
  }

  logInfo("ConciergePhotoStored", {
    stage: "associated",
    contentJobId: conversationId.slice(0, 8),
    photoId: saved.stored,
  });

  return NextResponse.json({
    ok: true,
    photoId: saved.stored,
    width: normalized.width,
    height: normalized.height,
    bytes: normalized.bytes.length,
    originalBytes: normalized.originalBytes,
  });
}

export async function PUT(request: Request) {
  if (!isConciergeEnabled()) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const conversationId = cookieId(request);
  if (!conversationId || !getConversation(conversationId)) {
    return NextResponse.json({ ok: false, error: "session" }, { status: 400 });
  }
  const payload = (await request.json().catch(() => null)) as { caption?: string } | null;
  const caption = String(payload?.caption || "").trim();
  const result = await conciergeTurn({
    conversationId,
    message: caption || "Comparto esta foto para orientar el servicio.",
    skipUserMessage: true,
  });
  return NextResponse.json(result);
}
