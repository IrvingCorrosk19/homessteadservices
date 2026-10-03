import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { isRequestStatus, type RequestStatus } from "@/lib/admin-format";
import { listServiceRequestsForOps } from "@/lib/service-requests";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }
  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status") || "ALL";
  if (statusRaw !== "ALL" && !isRequestStatus(statusRaw)) {
    return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
  }
  const status = statusRaw as RequestStatus | "ALL";
  const requests = listServiceRequestsForOps({
    q: url.searchParams.get("q") || undefined,
    status,
    service: url.searchParams.get("service") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  }).map((row) => ({
    publicId: row.publicId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    service: row.service,
    status: row.status,
    property: row.property,
    message: row.message,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    slaFirstAlertedAt: row.slaFirstAlertedAt,
    slaEscalatedAt: row.slaEscalatedAt,
  }));
  return NextResponse.json({ ok: true, requests });
}
