import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { getConversation } from "@/lib/concierge-store";
import { homesteadDataDir } from "@/lib/service-requests";
import { CONCIERGE_STORED_PHOTO_PATTERN, sniffImage } from "@/lib/photos";

export const runtime = "nodejs";

function cookieId(request: Request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(/(?:^|; )hs_cid=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function readConciergePhoto(conversationId: string, storedAs: string) {
  if (!CONCIERGE_STORED_PHOTO_PATTERN.test(storedAs) || storedAs.includes("..")) return null;
  const path = join(homesteadDataDir(), "concierge", conversationId, storedAs);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  const sniffed = sniffImage(bytes);
  if (!sniffed) return null;
  return { bytes, mime: sniffed.mime };
}

type Params = { params: Promise<{ storedAs: string }> };

export async function GET(request: Request, { params }: Params) {
  const { storedAs } = await params;
  const safeName = decodeURIComponent(storedAs || "");
  const conversationId = cookieId(request);
  if (!conversationId || !getConversation(conversationId)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const photo = readConciergePhoto(conversationId, safeName);
  if (!photo) return NextResponse.json({ ok: false }, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.mime,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
