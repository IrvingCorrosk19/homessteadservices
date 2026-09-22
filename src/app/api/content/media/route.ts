import { NextResponse } from "next/server";
import { getAssetById, readAssetBytes } from "@/lib/content-catalog";
import { verifyContentMediaToken } from "@/lib/content-media-url";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

function readParams(request: Request) {
  const url = new URL(request.url);
  return {
    publicId: url.searchParams.get("id") || "",
    assetId: url.searchParams.get("asset") || "",
    exp: url.searchParams.get("exp") || "",
    sig: url.searchParams.get("sig") || "",
  };
}

function serve(request: Request) {
  const params = readParams(request);
  const verified = verifyContentMediaToken(params);
  if (!verified.ok) {
    const status = verified.reason === "expired" ? 410 : 401;
    return NextResponse.json({ ok: false, error: verified.reason }, { status });
  }
  const asset = getAssetById(verified.assetId);
  if (!asset || asset.publicId !== verified.publicId || asset.assetType !== "BRANDED") {
    logError("ContentMediaMissing", { contentJobId: verified.publicId, cause: "asset_missing" });
    return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  }
  const bytes = readAssetBytes(asset);
  if (!bytes) {
    return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  }
  logInfo("ContentMediaServed", {
    contentJobId: verified.publicId,
    stage: String(asset.id),
  });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType || "image/jpeg",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  return serve(request);
}

export async function HEAD(request: Request) {
  const response = serve(request);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}
