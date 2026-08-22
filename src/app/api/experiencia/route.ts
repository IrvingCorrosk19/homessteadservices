import { NextResponse } from "next/server";
import { recordSatisfaction } from "@/lib/post-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: string; response?: string } | null;
  const token = String(body?.token || "");
  const response = String(body?.response || "");
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const result = recordSatisfaction(token, response);
  if (!result.ok) {
    const status = result.reason === "invalid" ? 404 : result.reason === "expired" ? 410 : 400;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }
  return NextResponse.json({
    ok: true,
    already: result.already,
    response: result.response,
    reviewUrl: result.reviewUrl,
    needsHelp: result.needsHelp,
  });
}
