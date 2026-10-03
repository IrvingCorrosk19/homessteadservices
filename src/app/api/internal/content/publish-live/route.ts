import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { CONTENT_ID_PATTERN } from "@/lib/content-types";
import { getContentSettings, getJobByPublicId, latestVersion, updateJob } from "@/lib/content-catalog";
import { getPieceByJobId } from "@/lib/campaign-store";
import { scanCommercialClaims } from "@/lib/campaign-claims";
import { publishJob } from "@/lib/content-publish";
import { contentPublishGloballyBlocked } from "@/lib/content-publish-policy";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (payload.confirm !== "LIVE" || payload.source !== "live") {
    return NextResponse.json({ ok: false, error: "live_confirm_required" }, { status: 403 });
  }
  const publicId = String(payload.publicId || "").trim();
  if (!CONTENT_ID_PATTERN.test(publicId)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const settings = getContentSettings();
  if (settings.paused || contentPublishGloballyBlocked()) {
    return NextResponse.json({ ok: false, error: "publish_blocked" }, { status: 403 });
  }
  const job = getJobByPublicId(publicId);
  if (!job) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  const piece = getPieceByJobId(publicId);
  if (piece && (piece.approvedVersion === null || piece.approvedVersion !== piece.version)) {
    return NextResponse.json({ ok: false, error: "stale_version" }, { status: 409 });
  }
  const claims = scanCommercialClaims(job.selectedCaption || "");
  if (!claims.ok) {
    return NextResponse.json({ ok: false, error: "unconfirmed_claims", hits: claims.hits }, { status: 409 });
  }
  const version = job.approvedVersion || latestVersion(publicId)?.version || 1;
  updateJob(publicId, {
    liveOnce: 1,
    approvedAt: job.approvedAt || new Date().toISOString(),
    approvedVersion: version,
  });
  const result = await publishJob(publicId, "live");
  return NextResponse.json({
    ok: Boolean(result.ok),
    dryRun: "dryRun" in result ? result.dryRun : true,
    cause: "cause" in result ? result.cause : "",
    results: "results" in result ? result.results : [],
  });
}
