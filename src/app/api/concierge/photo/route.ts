import { NextResponse } from "next/server";
import { attachConciergePhoto, isConciergeEnabled } from "@/lib/concierge-engine";
import { getConversation } from "@/lib/concierge-store";
import { MAX_PHOTO_BYTES, isAllowedDeclaredType, sniffImage } from "@/lib/photos";

export const runtime = "nodejs";

function cookieId(request: Request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(/(?:^|; )hs_cid=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
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
  if (!(file instanceof File)) return NextResponse.json({ ok: false }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ ok: false, error: "size" }, { status: 400 });
  }
  if (file.type && !isAllowedDeclaredType(file.type)) {
    return NextResponse.json({ ok: false, error: "type" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) return NextResponse.json({ ok: false, error: "type" }, { status: 400 });
  const saved = attachConciergePhoto(conversationId, bytes, sniffed);
  if (!saved || "error" in saved) {
    return NextResponse.json({ ok: false, error: saved?.error || "fail" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
