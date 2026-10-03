import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readAdminSessionToken } from "@/lib/control-auth";
import { isActiveAdminSession } from "@/lib/admin-session-store";

const PUBLIC = new Set(["/admin/login", "/admin/offline"]);

export async function AdminSessionGate({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-admin-pathname") || "";
  if (PUBLIC.has(pathname) || pathname.endsWith("/login") || pathname.endsWith("/offline")) {
    return children;
  }
  const token = await readAdminSessionToken();
  if (await isActiveAdminSession(token)) return children;
  if (!pathname) return children;
  redirect("/admin/login");
}
