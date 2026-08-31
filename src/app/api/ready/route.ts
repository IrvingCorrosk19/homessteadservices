import { NextResponse } from "next/server";
import { readinessPayload } from "@/lib/production-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = readinessPayload();
  const status = payload.ready ? 200 : 503;
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
