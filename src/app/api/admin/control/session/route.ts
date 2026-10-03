import { NextResponse } from "next/server";
import {
  adminCookieOptions,
  adminCsrfCookieName,
  createAdminCsrfToken,
} from "@/lib/admin-auth";
import { requireAdminSession } from "@/lib/control-auth";
import { isControlIsolated } from "@/lib/control-isolation";
import { getContentSettings } from "@/lib/content-catalog";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireAdminSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const csrf = await createAdminCsrfToken(session.token);
  const response = NextResponse.json({
    ok: true,
    csrf,
    isolated: isControlIsolated(),
    settings: getContentSettings(),
  });
  response.cookies.set(adminCsrfCookieName(), csrf, { ...adminCookieOptions(), httpOnly: false });
  return response;
}
