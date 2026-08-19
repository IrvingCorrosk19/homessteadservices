import { NextResponse } from "next/server";
import { isRequestStatus, PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import { logInfo } from "@/lib/log";
import { updateRequestStatus } from "@/lib/service-requests";

type Params = { params: Promise<{ requestId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { requestId } = await params;
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as { status?: string } | null;
  const status = String(body?.status ?? "");
  if (!isRequestStatus(status)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const updated = updateRequestStatus(requestId, status);
  if (!updated) return NextResponse.json({ ok: false }, { status: 404 });
  logInfo("ServiceRequestStatusChanged", { requestId, status });
  return NextResponse.json({ ok: true, status: updated.status, updatedAt: updated.updatedAt });
}
