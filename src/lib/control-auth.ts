import { cookies } from "next/headers";
import {
  adminCookieName,
  sameAdminOrigin,
  verifyAdminCsrfToken,
} from "@/lib/admin-auth";
import { isActiveAdminSession } from "@/lib/admin-session-store";

export const CONTROL_MOBILE_CLIENT = "control-mobile";

export function isControlMobileClient(request: Request) {
  return (request.headers.get("x-homestead-client") || "").trim() === CONTROL_MOBILE_CLIENT;
}

export function controlActor(request: Request) {
  return isControlMobileClient(request) ? "admin-mobile" : "admin-web";
}

function bearerSessionToken(request: Request | null | undefined) {
  if (!request) return "";
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || "";
}

export async function readAdminSessionToken(request?: Request) {
  const fromHeader = bearerSessionToken(request);
  if (fromHeader) return fromHeader;
  const jar = await cookies();
  return jar.get(adminCookieName())?.value || "";
}

export async function requireAdminSession(request?: Request) {
  const token = await readAdminSessionToken(request);
  if (!(await isActiveAdminSession(token))) {
    return { ok: false as const, status: 401 as const, error: "unauthorized" };
  }
  return { ok: true as const, token };
}

export async function requireAdminMutation(request: Request) {
  const session = await requireAdminSession(request);
  if (!session.ok) return session;
  // Browser Origin must match. Native mobile clients typically omit Origin.
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
