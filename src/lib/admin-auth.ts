const COOKIE_NAME = "hs_admin";
const SESSION_DAYS = 7;

function encoder() {
  return new TextEncoder();
}

function hexFromBuffer(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder().encode(value));
  return hexFromBuffer(signature);
}

function timingSafeEqual(left: string, right: string) {
  const a = encoder().encode(left);
  const b = encoder().encode(right);
  if (a.length !== b.length) return false;
  let out = 0;
  for (let index = 0; index < a.length; index += 1) out |= a[index] ^ b[index];
  return out === 0;
}

export function isAdminAuthConfigured() {
  return Boolean(
    process.env.ADMIN_PASSWORD?.trim() && process.env.ADMIN_SESSION_SECRET?.trim(),
  );
}

export function adminCookieName() {
  return COOKIE_NAME;
}

export function safeAdminReturnUrl(value: string | null | undefined) {
  const fallback = "/admin/solicitudes";
  if (!value) return fallback;
  if (!value.startsWith("/admin")) return fallback;
  if (value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return fallback;
  }
  if (value.includes("..")) return fallback;
  return value;
}

export async function verifyAdminPassword(password: string) {
  const expected = process.env.ADMIN_PASSWORD?.trim() || "";
  if (!expected || !password) return false;
  if (expected.length !== password.length) {
    await hmacHex("length-check", password);
    return false;
  }
  return timingSafeEqual(expected, password);
}

export async function createAdminSessionToken() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() || "";
  if (!secret) throw new Error("admin_session_unconfigured");
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60);
  const nonce = hexFromBuffer(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `${exp}.${nonce}`;
  const signature = await hmacHex(secret, payload);
  return `${payload}.${signature}`;
}

export async function isValidAdminSessionToken(token: string | undefined | null) {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() || "";
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, signature] = parts;
  if (!/^\d+$/.test(exp) || !/^[a-f0-9]+$/i.test(nonce) || !/^[a-f0-9]+$/i.test(signature)) {
    return false;
  }
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(secret, `${exp}.${nonce}`);
  return timingSafeEqual(expected.toLowerCase(), signature.toLowerCase());
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
