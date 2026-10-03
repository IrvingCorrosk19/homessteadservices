import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { getHomesteadDb } from "@/lib/service-requests";
import { getControlBatch } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const rows = getHomesteadDb()
    .prepare("SELECT public_id FROM content_photo_batches ORDER BY created_at DESC")
    .all() as Array<{ public_id: string }>;
  const batches = rows.map((row) => getControlBatch(row.public_id)).filter(Boolean);
  return NextResponse.json({ ok: true, batches });
}
