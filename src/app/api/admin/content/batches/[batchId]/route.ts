import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { getControlBatch } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const { batchId } = await context.params;
  const batch = getControlBatch(batchId);
  if (!batch) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  return NextResponse.json({ ok: true, batch });
}
