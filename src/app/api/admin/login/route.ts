import { NextResponse } from "next/server";
import {
  adminCookieName,
  adminCookieOptions,
  createAdminSessionToken,
  isAdminAuthConfigured,
  safeAdminReturnUrl,
  verifyAdminPassword,
} from "@/lib/admin-auth";
import { logError, logInfo } from "@/lib/log";

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function tooMany(ip: string) {
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || current.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

export async function POST(request: Request) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });
  }
  const ip = clientIp(request);
  if (tooMany(ip)) {
    return NextResponse.json({ ok: false, error: "locked" }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as {
    password?: string;
    returnUrl?: string;
  } | null;
  const password = String(body?.password ?? "");
  const valid = await verifyAdminPassword(password);
  if (!valid) {
    logError("AdminLoginFailed", { ip: ip.slice(0, 40) });
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }
  const token = await createAdminSessionToken();
  const redirectTo = safeAdminReturnUrl(body?.returnUrl);
  const response = NextResponse.json({ ok: true, redirect: redirectTo });
  response.cookies.set(adminCookieName(), token, adminCookieOptions());
  logInfo("AdminLoginSucceeded", {});
  return response;
}
