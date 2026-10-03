import { parseAdminSessionNonce } from "@/lib/admin-auth";
import { isValidAdminSessionToken } from "@/lib/admin-auth";
import { getHomesteadDb } from "@/lib/service-requests";

export function persistAdminSession(token: string) {
  const parsed = parseAdminSessionNonce(token);
  if (!parsed) return;
  getHomesteadDb()
    .prepare(
      `INSERT OR IGNORE INTO admin_sessions (nonce, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, NULL)`,
    )
    .run(parsed.nonce, parsed.expiresAt, new Date().toISOString());
}

export function revokeAdminSession(token: string | undefined | null) {
  const parsed = parseAdminSessionNonce(token || "");
  if (!parsed) return { ok: false as const };
  const result = getHomesteadDb()
    .prepare(
      `UPDATE admin_sessions SET revoked_at = ?
       WHERE nonce = ? AND revoked_at IS NULL`,
    )
    .run(new Date().toISOString(), parsed.nonce);
  return { ok: result.changes === 1 };
}

export async function isActiveAdminSession(token: string | undefined | null) {
  if (!(await isValidAdminSessionToken(token))) return false;
  const parsed = parseAdminSessionNonce(token || "");
  if (!parsed) return false;
  const now = Math.floor(Date.now() / 1000);
  if (parsed.expiresAt < now) return false;
  const row = getHomesteadDb()
    .prepare("SELECT revoked_at, expires_at FROM admin_sessions WHERE nonce = ?")
    .get(parsed.nonce) as { revoked_at: string | null; expires_at: number } | undefined;
  if (!row) return false;
  if (row.revoked_at) return false;
  if (Number(row.expires_at) < now) return false;
  return true;
}
