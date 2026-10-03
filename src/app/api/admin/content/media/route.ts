import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/control-auth";
import { getAssetById, readAssetBytes } from "@/lib/content-catalog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireAdminSession(request);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }
  const assetId = Number(new URL(request.url).searchParams.get("asset") || 0);
  const asset = getAssetById(assetId);
  if (!asset) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  const bytes = readAssetBytes(asset);
  if (!bytes) return NextResponse.json({ ok: false, error: "missing" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType || "image/jpeg",
      // BRANDED can be overwritten in place (same asset id) after reprocess — do not cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ETag: `"${asset.id}-${asset.size}-${asset.width || 0}x${asset.height || 0}"`,
    },
  });
}
