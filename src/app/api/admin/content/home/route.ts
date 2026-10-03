import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { controlHomeSummary } from "@/lib/control-service";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireAdminSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  return NextResponse.json({ ok: true, ...controlHomeSummary() });
}
