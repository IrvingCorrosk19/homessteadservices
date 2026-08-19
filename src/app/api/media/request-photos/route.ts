import { NextResponse } from "next/server";
import { signaturesMatch } from "@/lib/homestead-signature";
import { logError, logInfo } from "@/lib/log";
import {
  PHOTO_URL_TTL_SECONDS,
  signPhotoAccess,
  STORED_PHOTO_PATTERN,
} from "@/lib/photos";
import { readStoredPhoto } from "@/lib/service-requests";

const REQUEST_ID_PATTERN = /^HS-\d{4}-\d{6}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId") ?? "";
  const file = url.searchParams.get("file") ?? "";
  const exp = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const secret = process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim() || "";

  if (!secret || !REQUEST_ID_PATTERN.test(requestId) || !STORED_PHOTO_PATTERN.test(file)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < now || expires > now + PHOTO_URL_TTL_SECONDS + 60) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const expected = signPhotoAccess(secret, requestId, file, exp);
  if (!signaturesMatch(expected, sig)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const photo = readStoredPhoto(requestId, file);
  if (!photo) {
    logError("TelegramPhotoNotificationFailed", {
      requestId,
      cause: "photo_missing",
    });
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  logInfo("ServiceRequestPhotoServed", { requestId, file, bytes: photo.bytes.length });
  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
