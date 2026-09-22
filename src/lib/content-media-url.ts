import { createHmac, timingSafeEqual } from "crypto";
import { CONTENT_ID_PATTERN } from "@/lib/content-types";

/** Meta needs time to fetch + retry. Keep shorter than typical operator review. */
export const CONTENT_MEDIA_TTL_SECONDS = 45 * 60;
export const CONTENT_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const CONTENT_MEDIA_HMAC_PREFIX = "content-media";

export type ContentMediaTokenInput = {
  publicId: string;
  assetId: number;
  exp: number;
};

function mediaSecret() {
  return (
    process.env.CONTENT_MEDIA_SIGNING_SECRET?.trim() ||
    process.env.N8N_HOMESTEAD_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

export function contentMediaSecretConfigured() {
  return Boolean(mediaSecret());
}

export function signContentMediaAccess(
  secret: string,
  publicId: string,
  assetId: number,
  exp: string,
) {
  return createHmac("sha256", secret)
    .update(`${CONTENT_MEDIA_HMAC_PREFIX}.${publicId}.${assetId}.${exp}`)
    .digest("hex");
}

export function signaturesMatchHex(expectedHex: string, provided: string) {
  const normalized = provided.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(normalized, "hex");
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function buildContentMediaUrl(input: {
  siteUrl: string;
  publicId: string;
  assetId: number;
  nowSeconds?: number;
  ttlSeconds?: number;
  secret?: string;
}) {
  const secret = input.secret ?? mediaSecret();
  if (!secret) return { ok: false as const, cause: "media_signing_unconfigured" };
  if (!CONTENT_ID_PATTERN.test(input.publicId) || !Number.isInteger(input.assetId) || input.assetId < 1) {
    return { ok: false as const, cause: "invalid_asset" };
  }
  const ttl = input.ttlSeconds ?? CONTENT_MEDIA_TTL_SECONDS;
  const exp = String((input.nowSeconds ?? Math.floor(Date.now() / 1000)) + ttl);
  const sig = signContentMediaAccess(secret, input.publicId, input.assetId, exp);
  const base = input.siteUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    id: input.publicId,
    asset: String(input.assetId),
    exp,
    sig,
  });
  return {
    ok: true as const,
    url: `${base}/api/content/media?${params.toString()}`,
    exp: Number(exp),
  };
}

export function verifyContentMediaToken(input: {
  publicId: string;
  assetId: string;
  exp: string;
  sig: string;
  nowSeconds?: number;
  secret?: string;
}) {
  const secret = input.secret ?? mediaSecret();
  if (!secret) return { ok: false as const, reason: "unconfigured" as const };
  if (!CONTENT_ID_PATTERN.test(input.publicId)) {
    return { ok: false as const, reason: "invalid" as const };
  }
  const assetId = Number(input.assetId);
  if (!Number.isInteger(assetId) || assetId < 1) {
    return { ok: false as const, reason: "invalid" as const };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expires = Number(input.exp);
  if (!Number.isFinite(expires)) return { ok: false as const, reason: "invalid" as const };
  if (expires < now) return { ok: false as const, reason: "expired" as const };
  if (expires > now + CONTENT_MEDIA_TTL_SECONDS + 120) {
    return { ok: false as const, reason: "invalid" as const };
  }
  const expected = signContentMediaAccess(secret, input.publicId, assetId, input.exp);
  if (!signaturesMatchHex(expected, input.sig)) {
    return { ok: false as const, reason: "invalid" as const };
  }
  return { ok: true as const, publicId: input.publicId, assetId };
}

/** Instagram feed stills: JPEG, ≤8 MB, aspect 4:5–1.91:1. */
export function validatePublishImage(input: {
  bytes: Buffer;
  mime: string;
  width: number | null;
  height: number | null;
}) {
  if (!input.bytes?.length) return { ok: false as const, cause: "image_missing" };
  if (input.bytes.length > CONTENT_MEDIA_MAX_BYTES) {
    return { ok: false as const, cause: "image_too_large" };
  }
  const jpeg = input.bytes[0] === 0xff && input.bytes[1] === 0xd8 && input.bytes[2] === 0xff;
  if (!jpeg || (input.mime && input.mime !== "image/jpeg" && input.mime !== "image/jpg")) {
    return { ok: false as const, cause: "image_not_jpeg" };
  }
  const width = input.width || 0;
  const height = input.height || 0;
  if (width < 320 || height < 320) {
    return { ok: false as const, cause: "image_too_small" };
  }
  const ratio = width / height;
  if (ratio < 0.8 - 0.01 || ratio > 1.91 + 0.01) {
    return { ok: false as const, cause: "image_aspect_unsupported" };
  }
  return { ok: true as const, width, height, mime: "image/jpeg" as const };
}

export type PlatformAttempt =
  | "skip_published"
  | "retry_failed"
  | "reconcile_uncertain"
  | "publish"
  | "already_simulated";

export function nextPlatformAttempt(existing: { status: string } | null | undefined, live: boolean): PlatformAttempt {
  if (!existing) return "publish";
  if (existing.status === "PUBLISHED") return "skip_published";
  if (existing.status === "UNCERTAIN" || existing.status === "PUBLISHING") return "reconcile_uncertain";
  if (existing.status === "SIMULATED") return live ? "publish" : "already_simulated";
  if (existing.status === "FAILED" || existing.status === "PENDING") return "retry_failed";
  return "publish";
}
