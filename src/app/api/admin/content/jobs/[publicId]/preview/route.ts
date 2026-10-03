import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { previewPublishNow } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const { publicId } = await context.params;
  return NextResponse.json(previewPublishNow(publicId));
}
