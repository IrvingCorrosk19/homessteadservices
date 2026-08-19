import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminCookieName,
  isValidAdminSessionToken,
  safeAdminReturnUrl,
} from "@/lib/admin-auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/admin/login";
  const isLoginApi = pathname === "/api/admin/login";
  if (isLoginPage || isLoginApi) return NextResponse.next();

  const token = request.cookies.get(adminCookieName())?.value;
  const valid = await isValidAdminSessionToken(token);
  if (valid) return NextResponse.next();

  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/admin/login";
  login.search = "";
  login.searchParams.set("returnUrl", safeAdminReturnUrl(pathname + request.nextUrl.search));
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
