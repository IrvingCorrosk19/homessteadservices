import { NextResponse } from "next/server";
import { campaignDestination, parseCampaignRef } from "@/lib/campaign-attribution";
import { getCampaignByPublicId, getPieceByPublicId, recordCampaignClick } from "@/lib/campaign-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const parsed = parseCampaignRef(code);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "invalid_ref" }, { status: 400 });
  }
  const campaign = getCampaignByPublicId(parsed.campaignId);
  const piece = getPieceByPublicId(parsed.pieceId);
  if (!campaign || !piece || piece.campaignId !== campaign.publicId) {
    return NextResponse.json({ ok: false, error: "unknown_ref" }, { status: 404 });
  }
  const isTest = campaign.isTest === 1 || /test=1/.test(request.url);
  recordCampaignClick({
    campaignId: parsed.campaignId,
    pieceId: parsed.pieceId,
    channel: parsed.channel,
    ref: code,
    isTest,
  });
  const dest = campaignDestination({
    campaignId: parsed.campaignId,
    pieceId: parsed.pieceId,
    channel: parsed.channel,
  });
  const target = parsed.channel === "wa" ? dest.whatsapp : dest.web;
  return NextResponse.redirect(target, 302);
}
