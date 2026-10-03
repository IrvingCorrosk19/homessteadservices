import { NextResponse } from "next/server";
import { adminCookieName, adminCsrfCookieName } from "@/lib/admin-auth";
import { revokeAdminSession } from "@/lib/admin-session-store";

function sessionFromRequest(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim())?.[1]?.trim();
  if (bearer) return bearer;
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${adminCookieName()}=`))
      ?.slice(adminCookieName().length + 1) || ""
  );
}

export async function POST(request: Request) {
  const token = decodeURIComponent(sessionFromRequest(request));
  revokeAdminSession(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminCookieName(), "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(adminCsrfCookieName(), "", {
    httpOnly: false,
    path: "/",
    maxAge: 0,
  });
  return response;
}
