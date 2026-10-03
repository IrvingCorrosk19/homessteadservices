import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminCookieName,
  isValidAdminSessionToken,
  safeAdminReturnUrl,
} from "@/lib/admin-auth";

function isPublicAdminAsset(pathname: string) {
  return (
    pathname === "/admin/login" ||
    pathname === "/admin/offline" ||
    pathname === "/admin/sw.js" ||
    pathname === "/admin/manifest.webmanifest" ||
    pathname.startsWith("/admin/icons/")
  );
}

function withAdminPath(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-admin-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginApi = pathname === "/api/admin/login";
  if (isPublicAdminAsset(pathname) || isLoginApi) return withAdminPath(request);

  const token = request.cookies.get(adminCookieName())?.value;
  const valid = await isValidAdminSessionToken(token);
  if (valid) return withAdminPath(request);

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
