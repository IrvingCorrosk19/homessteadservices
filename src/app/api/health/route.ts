import { NextResponse } from "next/server";
import { livenessPayload } from "@/lib/production-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(livenessPayload(), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
