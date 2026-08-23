import { NextResponse } from "next/server";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import { getRequestByPublicId } from "@/lib/service-requests";
import { markEntityContacted } from "@/lib/ops-store";
import { logInfo } from "@/lib/log";

type Params = { params: Promise<{ requestId: string }> };

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: Params) {
  const { requestId } = await params;
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const current = getRequestByPublicId(requestId);
  if (!current) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });

  const result = markEntityContacted(requestId, "admin");
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });

  const request = getRequestByPublicId(requestId);
  logInfo("ServiceRequestMarkedContacted", { requestId, already: result.already });
  return NextResponse.json({
    ok: true,
    already: result.already,
    request: request
      ? {
          publicId: request.publicId,
          status: request.status,
          updatedAt: request.updatedAt,
        }
      : null,
  });
}
