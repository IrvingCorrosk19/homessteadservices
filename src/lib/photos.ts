import { createHmac } from "crypto";

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_URL_TTL_SECONDS = 20 * 60;
export const STORED_PHOTO_PATTERN = /^photo-0[1-6]\.(jpg|png|webp)$/;

const ALLOWED_DECLARED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export type SniffedImage = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
};

export function sniffImage(bytes: Buffer): SniffedImage | null {
  if (bytes.length < 12 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export function isAllowedDeclaredType(type: string) {
  return ALLOWED_DECLARED.has(type.trim().toLowerCase());
}

export function storedPhotoName(index: number, ext: SniffedImage["ext"]) {
  return `photo-${String(index + 1).padStart(2, "0")}.${ext}`;
}

export function signPhotoAccess(
  secret: string,
  requestId: string,
  file: string,
  exp: string,
) {
  return createHmac("sha256", secret)
    .update(`photo.${requestId}.${file}.${exp}`)
    .digest("hex");
}

export function buildSignedPhotoUrl(input: {
  siteUrl: string;
  secret: string;
  requestId: string;
  file: string;
  nowSeconds?: number;
}) {
  const exp = String((input.nowSeconds ?? Math.floor(Date.now() / 1000)) + PHOTO_URL_TTL_SECONDS);
  const sig = signPhotoAccess(input.secret, input.requestId, input.file, exp);
  const base = input.siteUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    requestId: input.requestId,
    file: input.file,
    exp,
    sig,
  });
  return `${base}/api/media/request-photos?${params.toString()}`;
}
