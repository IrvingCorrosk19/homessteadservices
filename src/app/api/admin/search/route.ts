import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { adminGlobalSearch } from "@/lib/admin-search";

export async function GET(request: Request) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const results = adminGlobalSearch(q, 6);
  return NextResponse.json({ results });
}
