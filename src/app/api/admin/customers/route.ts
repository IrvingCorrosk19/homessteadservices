import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { getCustomer360, listCustomers } from "@/lib/customer-360";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id") || 0);
  if (id > 0) {
    const customer = getCustomer360(id);
    if (!customer) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
    return NextResponse.json({ ok: true, customer });
  }
  const page = Math.max(Number(url.searchParams.get("page") || "0") || 0, 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "40") || 40, 1), 100);
  const result = listCustomers({
    q: url.searchParams.get("q") || undefined,
    segment: url.searchParams.get("segment") || undefined,
    includeTest: false,
    limit,
    offset: page * limit,
  });
  return NextResponse.json({
    ok: true,
    total: result.total,
    page,
    limit,
    customers: result.rows,
  });
}
