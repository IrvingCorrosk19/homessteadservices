import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import { readStoredPhoto } from "@/lib/service-requests";

type Params = { params: Promise<{ requestId: string; file: string }> };

export async function GET(request: Request, { params }: Params) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { requestId, file } = await params;
  const safeFile = decodeURIComponent(file);
  if (
    !PUBLIC_ID_PATTERN.test(requestId) ||
    !safeFile ||
    safeFile.includes("..") ||
    safeFile.includes("/") ||
    safeFile.includes("\\")
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const photo = readStoredPhoto(requestId, safeFile);
  if (!photo) return NextResponse.json({ ok: false }, { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    status: 200,
    headers: {
      "Content-Type": photo.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
