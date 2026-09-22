import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { inspectMetaConnections } from "@/lib/content-meta";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const inspection = await inspectMetaConnections();
  return NextResponse.json({ ok: true, meta: inspection });
}
