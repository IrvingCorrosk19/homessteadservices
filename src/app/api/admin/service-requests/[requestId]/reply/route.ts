import { NextResponse } from "next/server";
import { PUBLIC_ID_PATTERN } from "@/lib/admin-format";
import { logError, logInfo } from "@/lib/log";
import { sendAdminReply } from "@/lib/mail";
import { getRequestByPublicId } from "@/lib/service-requests";

type Params = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  if (!PUBLIC_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as {
    subject?: string;
    body?: string;
  } | null;
  const result = await sendAdminReply({
    publicId: requestId,
    subject: String(body?.subject ?? ""),
    body: String(body?.body ?? ""),
  });
  if (!result.ok) {
    const status =
      result.error === "not_found"
        ? 404
        : result.error === "in_progress"
          ? 409
          : result.error === "invalid_message"
            ? 400
            : 500;
    logError("AdminReplyFailed", { requestId, cause: result.error });
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  const updated = getRequestByPublicId(requestId);
  logInfo("AdminReplySent", { requestId });
  return NextResponse.json({
    ok: true,
    status: updated?.status ?? "CONTACTED",
    updatedAt: updated?.updatedAt ?? new Date().toISOString(),
  });
}
