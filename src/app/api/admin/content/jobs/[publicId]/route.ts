import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { getControlJobDetail } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const { publicId } = await context.params;
  const job = getControlJobDetail(publicId);
  if (!job) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  return NextResponse.json({ ok: true, job });
}
