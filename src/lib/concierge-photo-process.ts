import sharp from "sharp";
import type { SniffedImage } from "@/lib/photos";
import { MAX_PHOTO_BYTES, MAX_PHOTO_DIMENSION, sniffImage } from "@/lib/photos";

export const CONCIERGE_PHOTO_LONG_EDGE = 1920;
export const CONCIERGE_PHOTO_QUALITY = 85;

export type NormalizedPhoto = {
  bytes: Buffer;
  sniffed: SniffedImage;
  width: number;
  height: number;
  originalBytes: number;
};

export function isHeicLike(declaredMime: string, fileName = "") {
  const mime = declaredMime.trim().toLowerCase();
  const name = fileName.trim().toLowerCase();
  return mime.includes("heic") || mime.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
}

export async function normalizeConciergePhoto(
  input: Buffer,
  declaredMime = "",
  fileName = "",
): Promise<NormalizedPhoto> {
  const originalBytes = input.length;
  let meta;
  try {
    meta = await sharp(input, { failOn: "none", limitInputPixels: MAX_PHOTO_DIMENSION * MAX_PHOTO_DIMENSION }).rotate().metadata();
  } catch {
    if (isHeicLike(declaredMime, fileName)) {
      throw new Error("heic_unsupported");
    }
    throw new Error("invalid_image");
  }
  if (!meta.width || !meta.height) {
    if (isHeicLike(declaredMime, fileName)) throw new Error("heic_unsupported");
    throw new Error("invalid_image");
  }
  if (meta.width > MAX_PHOTO_DIMENSION || meta.height > MAX_PHOTO_DIMENSION) {
    throw new Error("dimension");
  }

  const longEdge = Math.max(meta.width, meta.height);
  let pipeline = sharp(input, { failOn: "none" }).rotate();
  if (longEdge > CONCIERGE_PHOTO_LONG_EDGE) {
    pipeline = pipeline.resize(CONCIERGE_PHOTO_LONG_EDGE, CONCIERGE_PHOTO_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const output = await pipeline
    .jpeg({ quality: CONCIERGE_PHOTO_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  if (output.data.length > MAX_PHOTO_BYTES) {
    throw new Error("size");
  }

  const sniffed = sniffImage(output.data);
  if (!sniffed) throw new Error("invalid_image");

  return {
    bytes: output.data,
    sniffed,
    width: output.info.width,
    height: output.info.height,
    originalBytes,
  };
}
