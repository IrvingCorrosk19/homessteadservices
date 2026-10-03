import { NextResponse } from "next/server";
import { verifyInternalHomesteadRequest } from "@/lib/internal-auth";
import { getContentSettings, getJobByPublicId, listAssets, updateJob } from "@/lib/content-catalog";
import { getHomesteadDb } from "@/lib/service-requests";
import {
  approveCampaign,
  createDigitalLocksmithCampaign,
  editPieceCopy,
  pauseCampaign,
  cancelCampaign,
  repairApprovedFeedImage,
} from "@/lib/campaign-engine";
import { campaignReport } from "@/lib/campaign-funnel";
import { getCampaignByPublicId, getPieceByPublicId, listCampaignPieces } from "@/lib/campaign-store";
import { publishJob } from "@/lib/content-publish";
import { buildContentMediaUrl } from "@/lib/content-media-url";
import { campaignDestination, instagramCaptionFooter } from "@/lib/campaign-attribution";
import { scanCommercialClaims } from "@/lib/campaign-claims";
import { withCanonicalCta } from "@/lib/content-copy";
import { site } from "@/lib/site";

export const runtime = "nodejs";

function dryRunRequired() {
  const settings = getContentSettings();
  return settings.dryRun && process.env.CONTENT_DRY_RUN !== "false";
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyInternalHomesteadRequest(request, payload)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!dryRunRequired()) {
    return NextResponse.json({ ok: false, error: "live_blocked" }, { status: 403 });
  }
  if (payload.source === "live" || payload.liveOnce === true) {
    return NextResponse.json({ ok: false, error: "live_blocked" }, { status: 403 });
  }

  const action = String(payload.action || "");
  try {
    if (action === "guard") {
      getHomesteadDb().prepare("UPDATE content_jobs SET live_once = 0").run();
      const settings = getContentSettings();
      return NextResponse.json({
        ok: true,
        dryRun: settings.dryRun,
        paused: settings.paused,
        liveOnceCleared: true,
      });
    }
    if (action === "create") {
      const created = await createDigitalLocksmithCampaign({
        chatId: String(payload.chatId || "campaign-canary"),
        userId: String(payload.userId || "campaign-canary"),
        requestedDays: Number(payload.days || 7) || 7,
        reuseOpen: false,
        isTest: true,
      });
      const feed = created.pieces.filter((piece) => piece.format === "SINGLE_IMAGE");
      return NextResponse.json({
        ok: true,
        campaignId: created.campaign.publicId,
        pieceIds: feed.map((piece) => piece.publicId),
        jobIds: feed.map((piece) => piece.contentJobId),
        scheduleNote: created.campaign.scheduleNote,
        scheduledDays: created.campaign.scheduledHorizonDays,
        maxGeneration: created.campaign.maxGeneration,
      });
    }
    if (action === "approve") {
      const campaignId = String(payload.campaignId || "");
      const result = approveCampaign(campaignId, "canary");
      return NextResponse.json(result);
    }
    if (action === "edit") {
      const pieceId = String(payload.pieceId || "");
      const copy = String(payload.copy || "");
      const result = editPieceCopy(pieceId, copy);
      return NextResponse.json(result);
    }
    if (action === "pause") {
      return NextResponse.json(pauseCampaign(String(payload.campaignId || ""), "canary"));
    }
    if (action === "cancel") {
      return NextResponse.json(cancelCampaign(String(payload.campaignId || ""), "canary"));
    }
    if (action === "publish-sim") {
      const publicId = String(payload.publicId || "");
      updateJob(publicId, { liveOnce: 0 });
      const first = await publishJob(publicId, "now");
      const second = await publishJob(publicId, "now");
      return NextResponse.json({ ok: true, first, second });
    }
    if (action === "publish-concurrent") {
      const publicId = String(payload.publicId || "");
      updateJob(publicId, { liveOnce: 0 });
      const [a, b] = await Promise.all([publishJob(publicId, "now"), publishJob(publicId, "now")]);
      return NextResponse.json({ ok: true, a, b });
    }
    if (action === "repair-feed") {
      const pieceId = String(payload.pieceId || "");
      const campaignId = String(payload.campaignId || "");
      const ids = pieceId
        ? [pieceId]
        : listCampaignPieces(campaignId)
            .filter((piece) => piece.format === "SINGLE_IMAGE")
            .map((piece) => piece.publicId);
      const results = [];
      for (const id of ids) {
        results.push({ pieceId: id, ...(await repairApprovedFeedImage(id)) });
      }
      return NextResponse.json({ ok: results.every((row) => row.ok), results });
    }
    if (action === "media-url") {
      const publicId = String(payload.publicId || "");
      const branded = listAssets(publicId, "BRANDED").at(-1);
      if (!branded) return NextResponse.json({ ok: false, error: "no_asset" }, { status: 404 });
      const signed = buildContentMediaUrl({
        siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || site.url).replace(/\/$/, ""),
        publicId,
        assetId: branded.id,
      });
      return NextResponse.json({ ok: signed.ok, assetId: branded.id, url: signed.ok ? signed.url : "", cause: signed.ok ? "" : signed.cause });
    }
    if (action === "preview-piece") {
      const pieceId = String(payload.pieceId || "");
      const piece = getPieceByPublicId(pieceId);
      if (!piece) return NextResponse.json({ ok: false, error: "missing_piece" }, { status: 404 });
      const campaign = getCampaignByPublicId(piece.campaignId);
      if (!campaign) return NextResponse.json({ ok: false, error: "missing_campaign" }, { status: 404 });
      const job = piece.contentJobId ? getJobByPublicId(piece.contentJobId) : null;
      const branded = piece.contentJobId ? listAssets(piece.contentJobId, "BRANDED").at(-1) : undefined;
      const signed = branded
        ? buildContentMediaUrl({
            siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || site.url).replace(/\/$/, ""),
            publicId: piece.contentJobId,
            assetId: branded.id,
          })
        : { ok: false as const, cause: "no_asset" };
      const destFb = campaignDestination({ campaignId: campaign.publicId, pieceId: piece.publicId, channel: "fb" });
      const destIg = campaignDestination({ campaignId: campaign.publicId, pieceId: piece.publicId, channel: "ig" });
      const destWeb = campaignDestination({ campaignId: campaign.publicId, pieceId: piece.publicId, channel: "web" });
      const caption = withCanonicalCta(job?.selectedCaption || piece.copy);
      const claims = scanCommercialClaims(`${caption}\n${piece.overlayText}`);
      const settings = getContentSettings();
      return NextResponse.json({
        ok: true,
        dryRun: settings.dryRun,
        paused: settings.paused,
        publishBlocked: process.env.CONTENT_PUBLISH_ENABLED === "false",
        live: false,
        campaignId: campaign.publicId,
        campaignStatus: campaign.status,
        campaignIsTest: Boolean(campaign.isTest),
        piece: {
          id: piece.publicId,
          jobId: piece.contentJobId,
          format: piece.format,
          pillar: piece.pillar,
          status: piece.status,
          version: piece.version,
          approvedVersion: piece.approvedVersion,
          scheduledAt: piece.scheduledAt,
          overlayText: piece.overlayText,
          cta: piece.cta,
          altText: piece.altText,
        },
        jobStatus: job?.status || "",
        liveOnce: job?.liveOnce || 0,
        image: {
          assetId: branded?.id || "",
          mime: branded?.mimeType || "",
          width: branded?.width || 0,
          height: branded?.height || 0,
          url: signed.ok ? signed.url : "",
          cause: signed.ok ? "" : signed.cause,
        },
        caption,
        destinations: {
          facebook: { page: "Homestead Services", conversion: destFb.web, click: destFb.click, whatsapp: destFb.whatsapp },
          instagram: {
            conversion: destIg.web,
            click: destIg.click,
            whatsapp: destIg.whatsapp,
            note: destIg.instagramNote,
            profileHint: instagramCaptionFooter(destIg.web),
          },
          web: destWeb.web,
        },
        claimsOk: claims.ok,
        claimsHits: claims.ok ? [] : claims.hits,
      });
    }
    if (action === "report") {
      const campaignId = String(payload.campaignId || "");
      return NextResponse.json({
        ok: true,
        live: campaignReport(campaignId),
        withTests: campaignReport(campaignId, { includeTests: true }),
        campaign: getCampaignByPublicId(campaignId),
        pieces: listCampaignPieces(campaignId).map((piece) => ({
          id: piece.publicId,
          version: piece.version,
          approvedVersion: piece.approvedVersion,
          status: piece.status,
          job: piece.contentJobId,
          scheduledAt: piece.scheduledAt,
        })),
      });
    }
    if (action === "create-review") {
      const { eligibleOperatorChatIds } = await import("@/lib/telegram-operators");
      const chats = [
        ...new Set(
          [...eligibleOperatorChatIds("content"), process.env.HOMESTEAD_TELEGRAM_CHAT_ID?.trim() || ""].filter(Boolean),
        ),
      ];
      const created = await createDigitalLocksmithCampaign({
        chatId: chats[0] || "campaign-review",
        userId: "operator-review",
        requestedDays: Number(payload.days || 7) || 7,
        reuseOpen: false,
        isTest: false,
      });
      const feed = created.pieces.filter((piece) => piece.format === "SINGLE_IMAGE");
      let notified = 0;
      let notifyError = "";
      if (!chats.length) {
        notifyError = "no_operator_chat";
      } else {
        try {
          const { sendCampaignBundle } = await import("@/lib/campaign-telegram");
          for (const chatId of chats) {
            await sendCampaignBundle(chatId, created.campaign.publicId);
            notified += 1;
          }
        } catch (error) {
          notifyError = error instanceof Error ? error.name : "notify_failed";
        }
      }
      return NextResponse.json({
        ok: true,
        campaignId: created.campaign.publicId,
        pieceIds: feed.map((piece) => piece.publicId),
        jobIds: feed.map((piece) => piece.contentJobId),
        scheduleNote: created.campaign.scheduleNote,
        scheduledDays: created.campaign.scheduledHorizonDays,
        status: created.campaign.status,
        notified,
        notifyError,
      });
    }
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message.slice(0, 160) : "failed" },
      { status: 500 },
    );
  }
}
