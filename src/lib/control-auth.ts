import { cookies } from "next/headers";
import {
  adminCookieName,
  sameAdminOrigin,
  verifyAdminCsrfToken,
} from "@/lib/admin-auth";
import { isActiveAdminSession } from "@/lib/admin-session-store";

export async function readAdminSessionToken() {
  const jar = await cookies();
  return jar.get(adminCookieName())?.value || "";
}

export async function requireAdminSession() {
  const token = await readAdminSessionToken();
  if (!(await isActiveAdminSession(token))) {
    return { ok: false as const, status: 401 as const, error: "unauthorized" };
  }
  return { ok: true as const, token };
}

export async function requireAdminMutation(request: Request) {
  const session = await requireAdminSession();
  if (!session.ok) return session;
  if (!sameAdminOrigin(request)) {
    return { ok: false as const, status: 403 as const, error: "origin" };
  }
  const csrf =
    request.headers.get("x-csrf-token") ||
    request.headers.get("x-homestead-csrf") ||
    "";
  if (!(await verifyAdminCsrfToken(session.token, csrf))) {
    return { ok: false as const, status: 403 as const, error: "csrf" };
  }
  return session;
}
