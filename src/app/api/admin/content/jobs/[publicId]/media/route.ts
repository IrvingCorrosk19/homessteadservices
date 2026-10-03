import { NextResponse } from "next/server";
import { controlActor, requireAdminMutation, requireAdminSession } from "@/lib/control-auth";
import {
  getJobByPublicId,
  listAssets,
  recordContentEvent,
  updateJob,
} from "@/lib/content-catalog";
import { CONTENT_ID_PATTERN } from "@/lib/content-types";
import { listOrderedBrandedFeeds } from "@/lib/content-multi-photo";
import { getHomesteadDb } from "@/lib/service-requests";

export const runtime = "nodejs";

type Params = { params: Promise<{ publicId: string }> };

export async function GET(request: Request, { params }: Params) {
  const gate = await requireAdminSession(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { publicId } = await params;
  if (!CONTENT_ID_PATTERN.test(publicId)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const job = getJobByPublicId(publicId);
  if (!job) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  const version = job.approvedVersion || 1;
  const media = listOrderedBrandedFeeds(publicId, version, job.mediaOrderJson).map((asset, index) => ({
    assetId: asset.id,
    index,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    sha256: asset.sha256,
    role: asset.role,
    filename: asset.storedFilename,
  }));
  return NextResponse.json({
    ok: true,
    publicId,
    format: job.format,
    publishMode: job.publishMode || (job.format === "CAROUSEL" ? "album" : "separate"),
    mediaOrderJson: job.mediaOrderJson,
    media,
    approvedVersion: job.approvedVersion,
  });
}

/**
 * Reorder / remove branded slides. Any media change clears approval (version pin).
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await requireAdminMutation(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const { publicId } = await params;
  if (!CONTENT_ID_PATTERN.test(publicId)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const job = getJobByPublicId(publicId);
  if (!job) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    order?: number[];
    remove?: number[];
  };
  const version = job.approvedVersion || listAssets(publicId, "BRANDED").at(-1)?.version || 1;
  const current = listOrderedBrandedFeeds(publicId, version, job.mediaOrderJson);
  const remove = new Set((body.remove || []).map(Number).filter((n) => n > 0));
  let next = current.filter((a) => !remove.has(a.id));
  if (Array.isArray(body.order) && body.order.length) {
    const byId = new Map(next.map((a) => [a.id, a]));
    const ordered: typeof next = [];
    for (const id of body.order.map(Number)) {
      const hit = byId.get(id);
      if (hit) {
        ordered.push(hit);
        byId.delete(id);
      }
    }
    for (const rest of byId.values()) ordered.push(rest);
    next = ordered;
  }
  if (remove.size) {
    for (const id of remove) {
      getHomesteadDb().prepare(`DELETE FROM content_assets WHERE id = ? AND public_id = ?`).run(id, publicId);
    }
  }
  const isAlbum = next.length >= 2;
  updateJob(publicId, {
    mediaOrderJson: JSON.stringify(next.map((a) => a.id)),
    format: isAlbum ? "CAROUSEL" : "SINGLE_IMAGE",
    publishMode: isAlbum ? "album" : "separate",
    approvedVersion: null,
    approvedAt: null,
    status: "AWAITING_APPROVAL",
    lastError: "media_changed",
  });
  recordContentEvent(publicId, "CONTENT_MEDIA_CHANGED", controlActor(request).slice(0, 80));
  return NextResponse.json({
    ok: true,
    publicId,
    mediaCount: next.length,
    approvalCleared: true,
    publishMode: isAlbum ? "album" : "separate",
    order: next.map((a) => a.id),
  });
}
