import { createHmac, timingSafeEqual } from "crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function signHomesteadPayload(secret: string, timestamp: string, payload: unknown) {
  const body = canonicalJson(payload);
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signaturesMatch(expectedHex: string, provided: string) {
  const normalized = provided.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(normalized, "hex");
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
