import { isBrandedFeedFilename, listAssets, readAssetBytes } from "@/lib/content-catalog";
import { validatePublishImage } from "@/lib/content-media-url";
import {
  MAX_CONTENT_PHOTOS,
  MAX_CONTENT_PHOTO_BYTES,
  type ContentAsset,
} from "@/lib/content-types";

export const CONTENT_PUBLISH_MODES = ["separate", "album"] as const;
export type ContentPublishMode = (typeof CONTENT_PUBLISH_MODES)[number];

export const MIN_CAROUSEL_ITEMS = 2;
export const MAX_CAROUSEL_ITEMS = Math.min(10, MAX_CONTENT_PHOTOS);

export function isContentPublishMode(value: unknown): value is ContentPublishMode {
  return value === "separate" || value === "album";
}

export function parseMediaOrderJson(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * All BRANDED feed rows for a job (any content_version), including soft-excluded ones.
 * Soft-remove only drops IDs from mediaOrderJson; assets remain here for historial.
 */
export function listAllBrandedFeeds(publicId: string): ContentAsset[] {
  return listAssets(publicId, "BRANDED")
    .filter((asset) => isBrandedFeedFilename(asset.storedFilename))
    .sort((a, b) => a.id - b.id);
}

/**
 * Ordered BRANDED feeds for preview/publish.
 * When mediaOrderJson is present, ONLY listed IDs are returned (removed slides stay out).
 * Asset rows are resolved by id across brand versions so copy bumps do not orphan images.
 */
export function listOrderedBrandedFeeds(publicId: string, version: number, mediaOrderJson?: string): ContentAsset[] {
  const order = parseMediaOrderJson(mediaOrderJson);
  const all = listAllBrandedFeeds(publicId);
  if (!all.length) return [];

  const byId = new Map(all.map((a) => [a.id, a]));
  if (order.length) {
    const ordered: ContentAsset[] = [];
    for (const id of order) {
      const hit = byId.get(id);
      if (hit) ordered.push(hit);
    }
    return ordered;
  }

  // No explicit order: prefer assets stamped with the requested version, else all by id.
  const atVersion = all.filter((a) => a.version === version);
  return (atVersion.length ? atVersion : all).sort((a, b) => a.id - b.id);
}

export function validateCarouselAssets(assets: ContentAsset[]): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (assets.length < MIN_CAROUSEL_ITEMS) {
    errors.push(`carousel_min_${MIN_CAROUSEL_ITEMS}`);
  }
  if (assets.length > MAX_CAROUSEL_ITEMS) {
    errors.push(`carousel_max_${MAX_CAROUSEL_ITEMS}`);
  }
  for (const asset of assets) {
    if (asset.size > MAX_CONTENT_PHOTO_BYTES) errors.push(`too_large:${asset.id}`);
    if (!asset.mimeType.includes("jpeg") && !asset.mimeType.includes("jpg") && asset.mimeType !== "image/jpeg") {
      if (!/\.jpe?g$/i.test(asset.storedFilename)) errors.push(`not_jpeg:${asset.id}`);
    }
    if (asset.width && asset.height) {
      const ratio = asset.width / asset.height;
      if (ratio < 0.8 || ratio > 1.91) errors.push(`aspect:${asset.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateLivePublishImages(assets: ContentAsset[]): {
  ok: boolean;
  cause?: string;
} {
  for (const asset of assets) {
    const bytes = readAssetBytes(asset);
    if (!bytes) return { ok: false, cause: `image_missing:${asset.id}` };
    const check = validatePublishImage({
      bytes,
      mime: asset.mimeType,
      width: asset.width,
      height: asset.height,
    });
    if (!check.ok) return { ok: false, cause: `${check.cause}:${asset.id}` };
  }
  return { ok: true };
}

export function mediaFingerprint(assets: ContentAsset[], caption: string): string {
  const ids = assets.map((a) => `${a.id}:${a.sha256}`).join("|");
  return `${ids}#${caption.trim().slice(0, 400)}`;
}
