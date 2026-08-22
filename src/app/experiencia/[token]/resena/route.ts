import { NextResponse } from "next/server";
import { recordReviewLinkOpened } from "@/lib/post-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = recordReviewLinkOpened(token);
  if (!result.ok || !result.url) {
    return NextResponse.redirect(new URL("/experiencia/no-disponible", _request.url), 302);
  }
  return NextResponse.redirect(result.url, 302);
}
